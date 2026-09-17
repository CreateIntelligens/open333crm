## Context

系統目前無任何券的概念。但發券所需的周邊能力幾乎都已就緒——實查結果：

| 能力 | 狀態 | 位置 |
|---|---|---|
| 發送層（`push`/`reply`/`multicast`/`broadcast`/`narrowcast`） | 現成 | `packages/channel-plugins/src/line/index.ts:315` |
| SafeReply 降級（reply 失敗自動改 push） | 現成 | `conversation.service.ts:651` |
| `replyToken` 傳遞鏈路 | 現成 | webhook → `message.received` → automation worker |
| 貼標 | 現成 | `tagging.service.ts`（已被 5 模組跨模組呼叫） |
| 短網址 + 點擊歸因 + QR | 現成 | `modules/shortlink/` |
| 關鍵字觸發 | 現成 | `keyword.matched` + 專屬管理頁 |
| 圖文選單 | 現成 | Rich Menu 完整管理 |
| 卡片訊息版型 | 現成 | 16 種（LINE 6 / FB 9） |
| 外部 API 呼叫 | 現成 | `executeApiFetchNode`（canvas） |
| LINE 身分驗證（LIFF） | 現成但**前置卡關** | `line-login` 的 `verifyIdToken`；需 LINE Login channel（見 D11） |
| Account Link 發 token／收事件 | 現成 | `channel-plugins/src/line/index.ts:613`／`:282` |
| 粉絲端前端 | **零** | `apps/web/src/app/liff/` 僅 callback／redirect 兩支導流頁 |

因此本 change 的實作重心是**券本身的資料模型、狀態機與 LIFF 前端**，而非發送或觸發機制。

## Goals / Non-Goals

**Goals**
- 券的完整生命週期：建立 → 發放 → 領取 → 核銷，狀態不可逆且防重複。
- 客服可在對話中發券並歸戶該聯絡人（差異化主場）。
- 顧客在 LIFF 內看券夾、出示券、完成核銷。
- 會員綁定的產品層介面：設定驅動，不為單一客戶寫死。

**Non-Goals**
- 跨渠道券夾統一（LIFF 主場架構下不需要）。
- 對接特定客戶的會員 API（客製層）。
- 互動遊戲、POS API 核銷、點數換券。

## Decisions

### D1：LINE 為唯一主場，FB／IG 導流

**理由**：LIFF `id_token` 是平台簽發的可信身分，FB／IG 沒有等價機制（Messenger Extensions SDK 已淡出，IG 完全沒有）。若為 FB／IG 另做簽章連結換 token，會引入「連結被轉發＝身分被轉移」的安全弱點——而券帶金錢價值，這個取捨不划算。

**替代方案（否決）**
- *三渠道各自券夾*：需要跨渠道歸戶才能讓同一人看到同一份券，而歸戶本身是獨立的大題目（見 D6）。
- *簽章連結*：安全強度低於 LIFF id_token，且需額外做短效、一次性、綁定該券等緩解措施。

**代價**：FB／IG 使用者多一次跳轉，且必須是 LINE 用戶。台灣市場此假設多半成立，但客群集中在 IG 且不常用 LINE 的商家會流失轉換——提案時需確認客戶渠道組成。

**但導流本身留下一個洞**（D10 補齊）：FB 使用者在系統中有自己的 `contactId`，跳進 LIFF 後系統看到的卻是 LINE 身分對應的**另一個 `contactId`**，兩者對不起來，券夾會是空的。

### D10：FB／IG 發券走「待領取券 + 一次性領取憑證」

**問題**：發券當下不知道 FB／IG 使用者的 LINE 身分，而 D6 已決定不做跨渠道歸戶，無從以身分比對找回券。

**做法**：券建立時帶 `claimToken`（一次性、短效），狀態為 `issued`；`contactId` 先記發放對象（FB 聯絡人）以保留歸因。顧客點連結進 LIFF、完成 id_token 驗證後，以憑證換券——在交易內條件式更新（`WHERE claimToken = ? AND status = 'issued' AND claimTokenExpiresAt > now()`）把 `contactId` 改為 LINE 聯絡人、狀態轉 `claimed`、憑證清空。受影響列數為 0 即回報憑證已用過或已過期。

**認券不認人**，因此不需要歸戶機制，與 D6 一致。

**取捨**：**領取憑證即所有權**——連結被轉發，別人就能領走。這正是 D1 否決「簽章連結」時所指的弱點，這裡以最小範圍接受它：僅用於領取（不用於核銷或查看他人券夾）、一次性、短效（建議 24–72 小時）、訊息明示勿轉發。**高價值券建議只在 LINE 發放。**

**附帶效果**：公開領券（海報 QR、官網連結、廣告導流）自然成立——同樣是一張待領券，只是憑證不綁特定對象。原規劃對此沒有明確路徑。

**LINE 原生發券不走此路**：座席已知對方 LINE 身分，直接建 `claimed` 券，省去領取步驟。

### D2：不使用 LINE 原生優惠券 API

LINE 已有 `POST /v2/bot/coupon` 等四支端點（建立／停用／列表／詳情），且內建抽獎機率。但**沒有任何端點能取得領取者或核銷名單**，官方文件明載成效只能在 LINE 官方帳號管理後台查看。

自建的理由因此要精確表述為：**不是「LINE 沒有券 API」，而是「有發券 API 但拿不回資料」**。既然核心價值是歸戶與成效追蹤，混合模式（用原生 API 發、自己記發送紀錄）只能拿到發券歸因、拿不到核銷，無法支撐「證明哪則訊息帶來核銷」的定位。

**註**：官方文件的券範例皆為日圓（`currency: JPY`、`timezone: ASIA_TOKYO`），該 API 在台灣 LINE OA 的開放狀況與幣別支援未經實測。此為不採用的次要原因，非主因。

### D3：三張表，狀態機集中在 `CouponInstance`

```
Coupon          券主檔（設定）
CouponInstance  每張券的生命週期（核心表）
CouponCode      序號包庫存（僅 imported_codes 模式使用）
```

狀態流轉：`issued → claimed → opened → redeemed`，另有 `expired` / `revoked` 終態。

**核銷防重複**：核銷在 DB transaction 內以條件式更新搶狀態（`WHERE status = 'claimed'`），受影響列數為 0 即表示已被他人核銷，回報「此券已使用」。不依賴應用層檢查，避免併發下的競態。`TenantDb` 型別已含 `Prisma.TransactionClient`，交易可直接使用。

### D4：會員編號對應沿用 `ContactAttribute`，不新建表

`ContactAttribute` 已有 `key` / `value` / `dataType` 與 `@@unique([contactId, key])`，足以承載「此聯絡人對應的商家會員編號」。新建一張 `ContactExternalId` 只會重複既有能力。

### D5：會員綁定的對外 API 走設定驅動

綁定介面在後台以設定描述（端點位址、認證方式、請求／回應格式、欄位對應），由既有的 `executeApiFetchNode` 執行呼叫，而非為每個客戶寫轉接程式。

**理由**：這決定了日後每接一個客戶是「改設定」還是「改程式」。若寫死，核心程式會隨客戶數量腐化。

**限制**：格式特殊（如需簽章、多步驟 OAuth）的客戶仍需寫轉接程式，此為客製層工作。

### D6：不做跨渠道歸戶

系統已有 `IdentityMap`（含 `source`／`confidence`）與 `MergeSuggestion`（含人工審核流程），五種歸戶來源也已定義。但**實查 UAT 兩張表皆為 0 筆**，且四個歸戶函式中僅讀取用的 `resolveUidToContact` 有呼叫端，三個寫入函式（`stitchByPhone`／`stitchByLiffCookie`／`detectPhoneDuplicates`）**無任何呼叫端**——機制從未啟用。

LIFF 主場架構下券只活在 LINE，沒有跨渠道券夾要合併，故本 change 不需要歸戶。

**且歸戶不應埋在本 change**：它是整個 CRM 的會員識別地基（做起來後對話、標籤、消費歷程都能跨渠道整合），應獨立提案。另需注意**合併錯誤比不合併嚴重**——兩人共用公司電話、家人共用 email 都可能誤判，一旦合併 A 會看到 B 的券甚至能核銷。自動歸戶應只採強證據（OTP 驗證），弱證據走人工確認。

### D7：發券沿用既有發送層，依場景選策略

| 場景 | 策略 | 理由 |
|---|---|---|
| 關鍵字領券 | `reply` | 免費；`replyToken` 有效期短（約 1 分鐘、限用一次），須在收到訊息後立即送出 |
| 加好友禮 | `reply` | `follow` 事件亦帶 `replyToken`，免費 |
| 客服對話發券 | `push` | 座席主動挑券，當下通常已無有效 `replyToken` |
| 分眾群發 | `multicast` | service 層已處理 500/批切分 |

發券只需組出一則帶 LIFF 連結的 `OutboundPayload` 並指定 `strategy`，交給既有 `deliverToChannel`。**券的內容在 LIFF 頁，訊息本身只是入口**。SafeReply 降級已內建，reply 失敗自動改 push，不會漏發。

### D8：fan auth 必須補真實身分驗證（LIFF id_token）

現況 `POST /api/v1/fan/auth` 只收 `{ contactId, tenantId }`，查到 contact 存在就發 24 小時 token，**無任何身分驗證**。

目前僅服務活動與點數，風險尚可控；但**券帶金錢價值後屬上線阻斷**——取得或猜到他人 contactId 即可領走、核銷其券。必須與券夾同時完成，不可延後。

⚠️ **前置條件不成立**：LIFF app 須建於 LINE Login channel 之下，客戶短期內無法取得。過渡期改以 Account Link 驗證身分，見 **D11**；本決策於 channel 到位後生效。「不可僅憑 contactId 發 token」的要求兩階段皆適用。

### D9：使用條款支援有限 HTML，需伺服器端消毒

使用條款要能斷行、放連結（如完整規則頁、客服連結），純文字不敷使用。

**允許的標記**：斷行、段落、連結、粗體、項目清單。**不允許**：script、style、iframe、event handler 屬性（`onclick` 等）、`javascript:` 協議的連結。

**消毒在伺服器端做，不信任前端**。儲存時消毒一次（避免髒資料入庫），顧客端輸出時不再二次轉義。

⚠️ **這是系統的新安全面**：目前 codebase 對使用者輸入一律全 escape（`escapeHtml` 在四處各自實作），沒有「允許部分 HTML」的既有機制，也沒有引入消毒套件。實作時需選定並引入一套成熟的 HTML sanitizer，不可自行以正則實作白名單 —— 正則式的 HTML 過濾幾乎必然有繞過方式。

**顯示位置**：券詳情頁（LIFF 內）。這是條款唯一的呈現位置 —— 對話中的發券訊息只帶連結，不含條款內容。

### D11：LINE Login channel 不可得時，以 Account Link 作為過渡認證

**背景**：D8 要求 fan auth 以 LIFF `id_token` 驗證身分，而 LIFF app 必須建立在 **LINE Login channel** 之下。客戶告知短期內無法取得該 channel，D8 的前置條件不成立。

現況 `POST /api/v1/fan/auth`（`portal-auth.service.ts`）**僅憑 contactId 即簽發 24 小時 token，零驗證**，券帶金錢價值後屬上線阻斷，**不可作為過渡**。

**做法**：改用 LINE 官方的 **Account Link**，它只需 **Messaging API channel access token**，不需 LINE Login。

```
1. 顧客於 LINE 對話點「領取優惠券」
2. 後端以 Messaging API 發 linkToken（POST /v2/bot/user/{userId}/linkToken）
3. 產 nonce（CSPRNG、≥128 bit、Base64），存 nonce → contactId，回一則帶連結的訊息：
   https://access.line.me/dialog/bot/accountLink?linkToken={t}&nonce={n}
4. 顧客點擊 → LINE 平台驗證「開連結者即為發 token 的對象」
5. 驗證通過 → LINE 送 accountLink webhook（result=ok，帶 nonce）
6. 以 nonce 反查 contactId，簽發 fan token
7. 進券夾（一般網頁，非 LIFF）
```

**既有基礎**（實查結果）：

| 能力 | 狀態 | 位置 |
|---|---|---|
| 發 linkToken | **現成** | `channel-plugins/src/line/index.ts:613` `issueAccountLinkToken()` |
| webhook 解析 accountLink 事件（含 `nonce`／`result`） | **現成** | 同檔 `:282` |
| nonce → contactId 的對應與寫入 | **缺** | 本 change 實作 |

**安全性優於 D10 的 `claimToken`**：官方文件明載 LINE 平台會驗證「開啟連結者是否為當初發 token 的對象」，驗證失敗送 `result: failed`。因此**連結被轉發，他人開啟亦無法通過**——`claimToken` 的「憑證即所有權」弱點在此不存在。linkToken 規格為**10 分鐘、一次性**（官方註明效期可能變動，不應寫死假設）。

**代價**

| 項目 | 影響 |
|---|---|
| 多一次 LINE 原生「確認連動」畫面 | 體驗多一步 |
| 券夾在外部瀏覽器開啟，非 LINE webview 內 | 回 LINE 需自行返回 |
| 取不到 `displayName`／頭像 | accountLink 只給 userId；需另呼叫 profile 端點 |
| **FB／IG 不適用** | linkToken 綁 LINE userId；FB／IG 仍走 D10 的 `claimToken`，轉發風險依舊 |

**與 D10 的分工**：LINE 走 Account Link（強驗證），FB／IG 走 `claimToken`（弱驗證、限低價值券）。兩者皆不使用未驗證的舊 fan auth 路徑。

**遷移路徑**：Account Link 結果寫入 `ContactAttribute`（`@@unique([contactId, key])` 已就緒），與 D4 會員編號同一套機制。待 LINE Login channel 到位後改走 LIFF `id_token`，**`CouponInstance` 資料結構不變，僅替換認證入口**，非打掉重做。兩種認證可並存一段時間。

**未決**：客戶取得 LINE Login channel 的時程。若逾三個月，Account Link 應視為主力設計而非過渡，LIFF 轉為後續增強。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| FB／IG 使用者流失（需跳轉且須為 LINE 用戶） | 提案時確認客戶渠道組成；LIFF 可設定先引導加好友，將發券轉為獲客誘因 |
| 併發核銷造成重複使用 | DB transaction 條件式更新搶狀態，不依賴應用層檢查 |
| 新增權限點後既有租戶 403 | 部署後執行 reconcile 並清權限快取（列入 tasks） |
| 新表漏接 RLS | RLS policy migration 列為 A1 的一部分，並由 `check-tenant-scoping.mjs` 把關 |
| 設定驅動介面設計不足，客製仍需改程式 | 介面設計階段先蒐集 2–3 個真實客戶的 API 規格驗證涵蓋度 |
| LINE Login channel 遲遲未到位 | 過渡走 Account Link（僅需 Messaging API），認證入口可替換、資料結構不變（D11） |
| linkToken 效期由 LINE 決定且可能變動 | 不寫死 10 分鐘假設；過期以「請重新點選領取」引導重試 |
| 領取憑證被轉發，券遭他人領走 | 憑證一次性、短效、僅供領取；訊息明示勿轉發；高價值券限 LINE 發放 |
| 使用條款的 HTML 造成 XSS | 伺服器端以成熟 sanitizer 白名單消毒；禁 script/style/iframe/event handler 與 `javascript:` 連結；不自行以正則實作 |

## Migration Plan

新增三張表，皆為新表，無既有資料需回填。`CouponInstance` 含 `claimToken`（唯一、可為 null）與 `claimTokenExpiresAt`。`ContactAttribute` 沿用既有結構，不變更。

部署順序：migration → RLS policy → reconcile 權限 → 清快取。

## Open Questions

- 客戶取得 LINE Login channel 的時程？逾三個月則 Account Link 應視為主力設計（見 D11）。

- 券圖的儲存走既有 MinIO 或外部 CDN？（影響 A6 的上傳流程）
- 核銷台是否需要獨立登入（店員非系統座席）？目前假設用座席帳號，若商家不願為店員開帳號則需另設計。
