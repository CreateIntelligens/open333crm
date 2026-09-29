## Context

平台 ID 各自有範圍：LINE userId 以 provider 為範圍，FB PSID 以粉專為範圍，IG IGSID 以 IG 帳號為範圍，三者無法互相換算。要歸戶，必須有一個「同一人同時握有」的憑證。本 change 採用一次性綁定代碼：顧客在 A 渠道取得代碼，在 B 渠道送回，即證明 A、B 兩個身分由同一人操作。

現況（main，2026-09-29 盤點）：
- **入站管線統一**：LINE/FB/IG/webchat 都走 `webhook.service.ts` 的 `processInboundMessage`，順序為：解析聯絡人（首次進站即建立 Contact）→ 落地訊息 → `sendFirstContactGreeting` → `runInboundPostbackInterceptors`（CSAT/KB 回饋/轉真人，命中即 return，不發 `message.received`）→ socket + `message.received`（AI/關鍵字/自動化都掛在這之後）。
- **FB/IG 丟棄 referral**：`facebook/index.ts` 只處理 `message`/`postback`；`threads.ts` 跳過沒有 `message.mid` 的事件。`m.me`/`ig.me` 帶 `?ref=` 產生的 referral 事件目前完全進不來。
- **合併有四套**：`contact.service.mergeContacts`（手動，封存）、`packages/core` `approveMerge`（建議，用全域 prisma、無 tenant 檢查、tag updateMany 會撞唯一鍵）、`line-login`/`fb-login` 的 `mergeContactIntoTarget`（硬刪，遇 Restrict FK 會失敗）、`packages/core` `ContactService.mergeContacts`（死程式碼）。
- **渠道導流識別未儲存**：LINE Basic ID（verify 時 `/v2/bot/info` 有回但沒存）、IG username 都沒存；FB 只有選填 `pageId`。
- **發送**：`deliverToChannel(prisma, conversationId, payload)` 不拋錯；`sendFirstContactGreeting` 是系統訊息的範本（寫 SYSTEM message → socket → 送出）。
- **一次性 token 範本**：`auth/passkey.service.ts` 用 Redis `SET … PX ttl NX` + `GETDEL`，介面可注入（方便測試）。
- `POST /api/v1/fan/auth` 無任何呼叫者。

## Goals / Non-Goals

**Goals:**
- 任一渠道（LINE/FB/IG/webchat）都能發出綁定代碼；LINE/FB/IG 都能兌換代碼。
- 兌換成功即自動合併，雙邊確認，可解除（LINE 規範要求可解除）。
- 單一合併引擎，資料完整搬移、可稽核、可拆回。
- 堵住 `fan/auth` 漏洞。

**Non-Goals:**
- 會員登入頁、客戶會員 API 比對（P2，另開 change；本 change 的代碼引擎設計成可由登入頁作為發碼方）。
- 簡訊/Email OTP、LIFF、手機重複合併建議、衝突清單（P3）。
- FB 24 小時訊息視窗的全面處理（見 Risks）。

## Decisions

### D1 代碼存 Redis，合併紀錄存 DB
代碼是 30 分鐘就失效的短期狀態，用 Redis `SET bindcode:{code} {json} PX 1800000 NX` 儲存、`GETDEL` 兌換，天然原子、單次使用，沿用 passkey 模式（可注入介面以利測試）。值內容：`{ tenantId, contactId, channelIdentityId, channelId, issuedAt }`。
長期要留的只有「合併這件事」→ 新表 `ContactMergeLog`（見 D5）。
*替代方案*：DB 表存代碼——要自己處理過期清理與兌換競態（需 `UPDATE … WHERE consumedAt IS NULL`），且代碼本身沒有稽核價值。不採用。

### D2 代碼格式與比對
格式 `BIND-` + 10 碼 Crockford base32（約 50 bit）。顧客不需手打（LINE 預填、FB/IG 走 ref），所以長度以安全為準。
- LINE 預填文字：`我要綁定帳號，代碼 BIND-XXXXXXXXXX（請直接送出）`。攔截用 regex 在全文**搜尋** `BIND-[0-9A-HJKMNP-TV-Z]{10}`（不要求整句相符），顧客改動前後文字仍可兌換。
- FB/IG：`ref` 值即為代碼本身。
- 比對不分大小寫，兌換前正規化為大寫。

### D3 攔截點：在打招呼訊息之前
在 `processInboundMessage` 中，於 `sendFirstContactGreeting` **之前**新增 `handleIdentityBinding(ctx)`；命中時：
1. 不發首次打招呼訊息（顧客是來綁定的，且帳號即將併入既有聯絡人）。
2. 不跑其他攔截器、不發 `message.received`（AI/關鍵字/自動化不處理代碼訊息）。
3. **仍然**發 socket 事件，讓客服在收件匣看得到綁定過程（與 CSAT 攔截不同，CSAT 攔截會吞掉 socket 事件）。

此時首次進站的顧客已被建立成新 Contact（`resolveInboundContact` 在前），合併即把這個新 Contact 併入。
同一函式也處理：顧客發出綁定請求（D6）、解除指令（D8）。

*替代方案*：加到既有 `runInboundPostbackInterceptors` 鏈。問題是打招呼訊息已經送出，顧客會先收到「歡迎加入」再收到「綁定成功」。不採用。

### D4 FB/IG referral 解析
`ParsedWebhookMessage` 新增選填欄位 `referralRef?: string`。
- FB：處理獨立的 `event.referral`（`messaging_referrals`）→ 產生 `contentType: 'referral'` 的事件；`message.referral` / `postback.referral` 也取出 `ref` 放進同一欄位。
- IG：`messaging_referral` 事件同樣處理（不再因缺 `message.mid` 被跳過）。
- `contentType: 'referral'` 的事件若 `ref` 不是綁定代碼，**只記錄不落地訊息**（避免收件匣出現空白訊息），保留給日後廣告歸因使用。
攔截時代碼來源為 `referralRef ?? textContent 中的 regex 結果`。

**Meta 官方文件查證（2026-09-29）**，ref 送達時機依「是否已有對話」而不同，三種位置都要解析：
| 情境 | FB（m.me） | IG（ig.me） |
|---|---|---|
| 已有對話 | 點連結即送 `messaging_referrals`，`referral = { ref, source: "SHORTLINK", type: "OPEN_THREAD" }` | 點連結即送 `messaging_referral`，`source: "SHORTLINKS"`，`type: "OPEN_THREAD"` |
| 新對話 | ref 附在「開始使用（Get Started）」按鈕的 `postback.referral`，**顧客要按開始使用才會送** | ref 附在顧客第一次互動（點 Icebreaker 的 `messaging_postback` 或傳第一則訊息的 `messages`）裡，**顧客不動作就不會送** |

- ref 只允許英數與 `-`、`_`、`=`：`BIND-` + Crockford base32 符合。
- IG：App 必須已發佈（Live）才收得到一般使用者的 ref（與 IG 渠道既有要求一致）；ig.me **不支援 Instagram 網頁版**。
- IG referral 會重置 24 小時訊息視窗，收到後可立即回覆確認訊息。
- 新對話的情境：FB 粉專須設定 Get Started 按鈕（渠道設定時檢查並提示）；IG 顧客若只開了對話不傳訊息，代碼不會送達 → 連結訊息的說明文字請顧客「開啟後傳送任一訊息或直接貼上代碼」。

### D5 統一合併引擎 `contact-merge.service.ts`
位置：`apps/api/src/modules/contact/contact-merge.service.ts`，簽章：
```ts
mergeContacts(tx: TenantTx, input: {
  tenantId: string; survivorId: string; mergedId: string;
  source: 'MANUAL' | 'SUGGESTION' | 'LINE_LOGIN' | 'FB_LOGIN' | 'BINDING_CODE';
  actorAgentId?: string;
}): Promise<{ mergeLogId: string }>
```
必須在呼叫端的 `withTenant` 交易（`tx`）內執行，且先驗證兩個 contact 都屬於 `tenantId`、都未封存、且不是同一筆。

搬移清單（依 schema 所有帶 `contactId` 的欄位）：
| 表 | 處理 |
|---|---|
| ChannelIdentity、Conversation、Case、LongTermMemory、PortalSubmission、PointTransaction、IdentityMap | `updateMany` 改指 survivor |
| ContactTag（唯一 `[contactId,tagId]`） | survivor 沒有的才搬，重複的刪 |
| ContactAttribute（唯一 `[contactId,key]`） | survivor 沒有的 key 才搬，**衝突時 survivor 優先** |
| ContactRelation | 兩端改指 survivor，刪除因此產生的自我關聯與重複 |
| BroadcastRecipient（唯一 `[broadcastId,contactId]`） | survivor 沒收過的才搬；雙方都收過的**留在原處不刪**（刪了會讓廣播送達統計少算） |
| ClickLog、FlowExecution、KbArticleFeedback | `updateMany`（無 FK，純欄位） |
| MergeSuggestion 涉及 merged 的 PENDING 建議 | 標為 `SUPERSEDED` |
| DataErasureRequest | 不動（稽核性質） |
| Contact 本身 | merged → `isArchived=true, mergedIntoId=survivor`；survivor 的 phone/email/displayName 為空時由 merged 補 |

每一步搬了哪些 id 記在 `ContactMergeLog.movedRecords`（JSON：`{ channelIdentity: [...], conversation: [...], case: [...], ... }`），作為解除綁定的依據。
新表：
```prisma
model ContactMergeLog {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @db.Uuid
  survivorId    String   @db.Uuid
  mergedId      String   @db.Uuid
  source        String   // MANUAL | SUGGESTION | LINE_LOGIN | FB_LOGIN | BINDING_CODE
  actorAgentId  String?  @db.Uuid
  movedRecords  Json
  revertedAt    DateTime?
  revertedBy    String?  // agentId 或 'customer'
  createdAt     DateTime @default(now())
  @@index([tenantId, survivorId])
  @@index([tenantId, mergedId])
}
```
需啟用 RLS（`tenant_isolation` policy），比照 `postgres-rls-tenant-isolation` skill 的新增表步驟。
合併完成後在交易外發 socket `contact.merged`（沿用現有事件名）並寫稽核。

**舊實作處置**：
- `contact.service.mergeContacts` → 改為薄包裝，呼叫新引擎（source `MANUAL`）。
- `approveMerge`（packages/core）→ 只負責驗證建議與更新狀態；實際合併由 API 路由在同一 `withTenant` 交易內呼叫新引擎（source `SUGGESTION`）。順便補上建議的 tenant 檢查。
- `line-login` / `fb-login` 的 `mergeContactIntoTarget` → 刪除，改呼叫新引擎（不再硬刪）。
- `packages/core` `ContactService.mergeContacts` 死程式碼 → 刪除。

*替代方案*：保留四套各自修補。每新增一張帶 contactId 的表都要改四處，這正是目前漏搬的根因。不採用。

### D6 發碼
觸發方式：
1. 顧客在對話中傳送綁定關鍵字（租戶設定 `TenantSettings.identityBinding.bindKeywords`，預設 `["綁定帳號"]`；新增 JSON 欄位 `identityBinding`）。關鍵字須**整句相符**（去頭尾空白、不分大小寫），避免一般對話提到「綁定帳號」就被攔截。
2. 客服在聯絡人頁按「傳送綁定連結」（需 `contact.update` 權限），系統在該對話送出。

發碼後回覆一則系統訊息，列出**其他**可綁定渠道的導流連結（排除顧客目前所在的這個 channel；只列 `isActive` 且已設定導流識別的 LINE/FB/IG 渠道）：
- LINE：`https://line.me/R/oaMessage/{percent-encoded basicId}/?{percent-encoded 預填文字}`
  - **非好友必須先加好友才能送出**（2026-09-29 使用者確認）。因此 LINE 的導流訊息分兩步呈現：①加好友連結 `https://line.me/R/ti/p/{percent-encoded basicId}` ②「加好友後點此送出代碼」的 oaMessage 連結；同時以純文字顯示代碼，讓顧客在預填文字遺失時可手動貼上（regex 搜尋本來就支援）。
  - 顧客加好友會觸發 `follow` 事件與首次打招呼訊息；綁定代碼稍後才送達，屬可接受行為（打招呼已送出，不回收）。
- 所有渠道的導流訊息都**同時以純文字顯示代碼**，作為 ref／預填文字失效時的退路。
- FB：`https://m.me/{pageUsername ?? pageId}?ref={code}`
- IG：`https://ig.me/m/{igUsername}?ref={code}`

一個代碼可兌換到任一列出的渠道，但只能兌換一次。
功能以租戶設定 `identityBinding.enabled` 控制，**預設關閉**，避免既有租戶的顧客突然被關鍵字攔截。

### D7 兌換規則
依序檢查，任一不通過即回覆對應訊息並結束（不合併）：
1. `GETDEL` 取不到 → 「代碼無效或已過期，請回原對話重新取得」。
2. 代碼 `tenantId` ≠ 收訊渠道的 `tenantId` → 視同無效（不洩漏代碼存在）。實作上 Redis key 為 `bindcode:{tenantId}:{code}`，他租戶根本查不到，也就不會誤耗掉原租戶的代碼。
3. 兌換方的 channelIdentity 就是發碼方 → 「請到其他渠道送出此代碼」。
4. 兩個身分已屬於同一聯絡人 → 「已完成綁定」。
5. 發碼方聯絡人已封存（中途被合併）→ 追 `mergedIntoId` 找到現存聯絡人再合併。

合併方向：**survivor = 發碼方聯絡人**，merged = 兌換方聯絡人。理由：發碼方是顧客主動發起綁定的那一端，通常是既有、資料較完整的一方；兌換方常常是剛因這則訊息被建立的新聯絡人。
合併後：`IdentityMap` upsert 兌換方身分（source `BINDING_CODE`，confidence 1.0）；雙邊對話各送確認訊息（以 `deliverToChannel` 送，失敗寫系統訊息，不靜默）。為此 `deliverToChannel` 改為回傳是否成功（`Promise<boolean>`，原呼叫端忽略回傳值不受影響）。
`revertMerge` 搬回渠道身分時，一併把該 uid 的 `IdentityMap` 指回被恢復的聯絡人（含合併後才寫入的 BINDING_CODE 紀錄），否則之後該 uid 進站會被解析回 survivor。

### D8 解除綁定
- **顧客端**：綁定後 7 天內，在任一邊對話回覆解除關鍵字（`identityBinding.unbindKeywords`，預設 `["解除綁定"]`）→ 撤銷最近一筆 `source=BINDING_CODE` 且未撤銷、涉及該顧客當前身分的 `ContactMergeLog`。超過 7 天回覆「請聯繫客服協助解除」，改由客服處理（避免久遠的合併被一句話拆掉，後續資料已混在一起）。
- **客服端**：聯絡人頁的合併紀錄可逐筆「解除」（需 `contact.merge`，任何 source 皆可）。既有 `POST /contacts/merge` 一併補上 `contact.merge` 守門（原本只驗登入；三個預設角色皆有此權限，不影響既有帳號）。

撤銷流程：將 merged 聯絡人取消封存，把 `movedRecords` 中仍指向 survivor 的 ChannelIdentity、Conversation、Case、PortalSubmission、PointTransaction、IdentityMap 搬回；tag/attribute **不回收**（無法判斷合併後是誰加的）；記 `revertedAt/revertedBy`；雙邊送出已解除訊息。
合併後才新建的資料（新對話、新案件）留在 survivor——會落在 `movedRecords` 以外，不追蹤。

### D9 濫用防護
- 發碼頻率：每個 channelIdentity 每小時最多 5 次（Redis `INCR` + TTL）。
- 兌換失敗：每個 channelIdentity 每小時 10 次失敗後，不再回覆失敗訊息（仍靜默記錄），防止以對話暴力猜碼。50 bit 代碼 + 30 分鐘時效下，猜中機率可忽略，此限制主要防止刷訊息。
- 轉傳風險：代碼即憑證，被轉給他人會被他人綁走。緩解：只在顧客主動要求（或客服主動發）時產生、30 分鐘時效、雙邊確認訊息含「非本人操作請回覆『解除綁定』」、7 天內自助解除。

### D10 渠道導流識別
`Channel.settings` 新增兩欄：驗證時自動取得的 `bindingHandleAuto`，與管理員手動填的 `bindingHandle`（優先使用）。分兩欄是因為渠道設定 API 整包覆寫 settings，重新驗證時不可蓋掉管理員填的值。FB 驗證時另檢查 `messenger_profile.get_started`，結果存 `fbGetStartedConfigured` 供後台提示（新對話的 ref 只隨「開始使用」送達）。
- LINE：`verifyChannel` 時將 `/v2/bot/info` 回傳的 `basicId` 寫入；既有渠道重新驗證即補齊。
- FB：`pageUsername`（選填，後台可填），沒有就用 `pageId`。
- IG：verify 時改呼叫 `/me?fields=id,username` 並寫入 `username`。
後台渠道設定頁顯示並可手動覆寫。

### D11 移除 fan/auth
直接刪除 `POST /api/v1/fan/auth` 路由（無呼叫者）。其他 `/api/v1/fan/*` 路由維持現狀，僅接受由既有 LINE/FB Login 流程簽發的 fan token。

## Risks / Trade-offs

- **FB 24 小時視窗**：確認訊息送往發碼方對話時，距發碼最多 30 分鐘，一定在視窗內；解除訊息在 7 天內可能超出視窗而送失敗 → 失敗寫入 SYSTEM 訊息讓客服看得到，不重試。全面的 24h 處理不在本 change。
- **FB/IG 新對話的 ref 要等顧客動作才送達**（官方文件已確認，見 D4）：FB 要按「開始使用」、IG 要傳第一則訊息或點 Icebreaker → 說明文字引導顧客動作；所有導流訊息同時顯示純文字代碼作退路（regex 攔截本來就支援）。實際體驗仍需在 UAT 真機驗證。
- **LINE 非好友須先加好友**（使用者確認）：導流訊息改為「加好友 → 點連結送出代碼」兩步（見 D6）；加好友時會先收到打招呼訊息，屬可接受行為。
- **ig.me 不支援 IG 網頁版**：用電腦版 IG 的顧客點不開 → 退路同上（貼代碼）。
- **合併方向固定為發碼方**：若兌換方其實是資料較多的一方，只影響 displayName 等單值欄位（survivor 空欄才補），關聯資料全數搬移不遺失 → 可接受。
- **解除無法完全還原**：tag/attribute 不回收、合併後新資料不搬回 → 在解除確認與後台說明中明示。
- **合併交易變大**：搬移表數增加，單次合併在同一交易中執行 → 單一顧客資料量小，可接受；觀察交易時間。

## Migration Plan

1. Migration：新增 `ContactMergeLog`（含 RLS policy + `app_tenant` grant）、`StitchSource` 加 `BINDING_CODE`、`SuggestionStatus` enum 加 `SUPERSEDED`。
2. 部署後既有 LINE/IG 渠道需重新驗證一次以寫入導流識別（或由一次性 script 補抓）。
3. 功能預設關閉，租戶在設定頁開啟。
4. 回滾：關閉 `identityBinding.enabled` 即停止攔截；統一合併引擎不可回滾到舊的硬刪實作（舊實作本身有 bug），合併紀錄表保留。

## Open Questions

- 7 天自助解除期限、30 分鐘代碼時效、每小時頻率上限，是否需要開放租戶調整？（本 change 先寫死常數，集中在一個設定檔。）
- 優惠券分支合併進 main 後，`CouponInstance` 也帶 `contactId`，需加入合併搬移清單（在該分支 rebase 時處理）。
