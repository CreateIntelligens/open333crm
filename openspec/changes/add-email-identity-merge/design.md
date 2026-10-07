# Design

## Context

動機見 proposal.md。現況與限制：

- 綁定代碼流程（change `add-cross-channel-one-id`，程式已在 main、change 尚未歸檔）已提供：入站關鍵字攔截、Redis 短效憑證與次數限制、合併前的同渠道衝突檢查、`mergeContacts()` 統一合併引擎、雙邊通知、7 天自助解除、客服從合併紀錄解除，以及 `ai-guard.ts` 讓 AI 看不到綁定訊息。
- `line-login`、`fb-login` 是現有唯一會依 email 合併的路徑，有 IDENT-02 的漏洞。UAT 沒有設定 `LINE_LOGIN_*`、`FB_LOGIN_*`，`contact_merge_logs` 沒有任何 `LINE_LOGIN`／`FB_LOGIN` 紀錄（2026-10-07 查詢）。
- `ContactMergeLog.source` 是字串；`IdentityMap.source` 的列舉 `StitchSource` 已有 `EMAIL_MATCH`。
- AI 讀對話紀錄的兩個函式 `loadKbHistory`（`kb-autoreply.service.ts`）與 `loadAgentHistory`（`agent.service.ts`）都只以 `conversationId` 查詢。
- 收件匣展開單一對話可沿用 `GET /api/v1/conversations/:id/messages`；聯絡人的對話清單 `GET /api/v1/contacts/:id/conversations` 已套用渠道可見性（CM-173）。

## Goals / Non-Goals

**Goals**

- 盡量沿用綁定代碼流程的元件，email 登記只新增「憑證是連結、比對依據是 email」這兩點。
- 跨渠道訊息在 API 層就依渠道可見性過濾，前端不需要自行判斷。

**Non-Goals**

- 不驗證 email 擁有權（不寄驗證信、不做 OTP）。
- 不產生或審核合併建議（IDENT-01 不在本 change 範圍）。
- 不改變綁定代碼流程的行為。

## Decisions

### D1：email 登記使用獨立的關鍵字與開關

租戶設定 `identityBinding` 新增 `emailEnabled`（預設 false）與 `emailKeywords`（預設 `['登記email']`），與綁定代碼的 `enabled`、`bindKeywords` 分開。

- **原因**：兩種方式的憑證與風險不同，租戶可能只想開其中一種。共用「綁定帳號」關鍵字需要改寫 `add-cross-channel-one-id` 的「顧客可在對話中取得綁定代碼」需求，讓兩個 change 的耦合變大。
- **替代方案**：「綁定帳號」的回覆同時列出代碼連結與 email 登記連結。顧客只需記一個關鍵字，但回覆變長、選項變多。可在上線後依實際使用再合併。

### D2：不驗證 email（2026-10-07 使用者決定）

顧客填入的 email 直接用於比對與合併。

- **原因**：降低顧客操作步驟；平台目前以單一 Gmail 寄信，量與寄件者名稱都不適合大量寄驗證信。
- **代價**：知道某人 email 的人可以把自己併入對方。緩解措施見「Risks」。

### D3：登記連結憑證

- token 為 32 bytes 隨機值的 base64url，存在 Redis `email-reg:{token}`，內容為 `{ tenantId, channelIdentityId, channelId, conversationId, issuedAt }`，TTL 30 分鐘。
- 成功送出時以 `GETDEL` 原子取出，同一個 token 只會成功一次；格式錯誤（400）不消耗 token。
- 每個渠道身分的發連結次數沿用綁定代碼的計數方式（每小時 5 次），但使用獨立的 Redis key。
- 連結為 `${WEB_BASE_URL}/bind/email/{token}`。

### D4：公開端點不使用 `prismaAdmin`

`GET /api/v1/public/email-registration/:token`（顯示渠道與名稱）與 `POST /api/v1/public/email-registration/:token`（送出 email）從 Redis 取得 `tenantId` 之後，以 `withTenant(fastify.prisma, tenantId, fn)` 執行全部查詢。

- **原因**：租戶已由 token 決定，不需要 BYPASSRLS，也不必把新檔案加進 `prismaAdmin` 白名單。
- 端點註冊 `@fastify/rate-limit`，每個 IP 每分鐘 20 次。
- token 不存在與過期都回 410，回應內容相同。

### D5：合併方向與比對

- 比對條件：同租戶、`isArchived = false`、`lower(email) = lower(輸入值)`、不是登記者目前的聯絡人。多筆時取 `createdAt` 最早的一位。
- 已經有這個 email 的聯絡人為 survivor，登記者的聯絡人被併入。
  - **原因**：email 已經在某位聯絡人身上，那位聯絡人代表這個 One ID；顧客在新渠道登記，是把新渠道加進去。與舊的 `line-login` 方向一致。
- 合併前的同渠道衝突檢查，從 `identity-binding.service.ts` 的 `checkBindable()` 抽出共用函式，綁定代碼與 email 登記都呼叫它。
- 合併以 `mergeContacts(tx, { source: 'EMAIL', meta })` 在 `withTenant` 的交易內執行，同一交易內 upsert `IdentityMap`（`source: 'EMAIL_MATCH'`，`confidence: 1`）。
- `meta` 記錄 `registrantChannelIdentityId` 與 `notifiedChannelIdentityId`，供自助解除判斷「目前的身分」與哪一筆有關。

### D6：自助解除沿用解除綁定

`findBindingForIdentity()` 改為查詢 `source in ('BINDING_CODE', 'EMAIL')`，比對 `meta.issuerChannelIdentityId` 或 `meta.notifiedChannelIdentityId`。解除關鍵字、7 天期限與搬回邏輯都不變。

### D7：系統訊息標記與 AI 過濾

登記連結、完成、衝突與通知訊息都以 `sendBindingMessage()` 送出，`metadata.source = 'identity_binding'`。`ai-guard.ts` 已經過濾這個來源，另外把 `/bind/email/` 連結加入遮蔽規則。

### D8：客服修改 email 的 409

- `PATCH /api/v1/contacts/:id` 的 email 與他人重複、且 body 沒有 `allowDuplicateEmail: true` 時，丟出 `AppError('此 email 已由其他聯絡人使用', 'EMAIL_IN_USE', 409, { contactId, displayName })`。
- 前端收到後開啟對話框，提供三個動作：
  - **合併**：開啟既有的 `ContactMergeModal` 並預先帶入對方。只有具 `contact.merge` 的客服看得到。
  - **仍要儲存**：重送並帶上 `allowDuplicateEmail: true`。
  - **取消**。
- 手動合併沿用 `POST /contacts/merge`，來源 `MANUAL`，不新增端點。

### D9：跨渠道訊息 API

- 新增 `GET /api/v1/contacts/:id/messages?before=<cursor>&limit=`，需要 `contact.view` 與 `inbox.view`。
- 先以 `resolveChannelVisibility(request)` 取得可見渠道，只查這些渠道的對話。看不到的對話只計數，以 `hiddenConversationCount` 回傳。
- 以 `(createdAt, id)` 作為游標，避免同一毫秒的訊息重複或遺漏。
- 收件匣的「其他渠道的對話」使用既有的 `GET /contacts/:id/conversations` 列出對話，展開時使用既有的 `GET /conversations/:id/messages`，不新增端點。

### D10：AI 的其他渠道訊息放在獨立區塊

- 新增共用函式 `loadOtherChannelContext(db, tenantId, contactId, currentConversationId)`，`kb-autoreply` 與 `agent` 兩條路徑都呼叫。
- 查詢條件：同租戶、屬於該聯絡人、不是目前對話、30 天內的文字訊息，取最新 10 則。
- 結果組成一段系統訊息「顧客在其他渠道的近期訊息」，每行格式為 `[渠道 相對時間] 顧客／客服：內容`，並附上「只用來理解問題，不主動複述其中的電話、地址、email、訂單或會員編號」的規則。
- **原因**：不和目前對話的 user／assistant turn 交錯。交錯會讓模型以為那些回覆是在這個渠道說的，也會讓既有的 `HISTORY_LIMIT` 語意改變。
- 查詢一律以聯絡人目前擁有的對話為準，所以解除合併後自動不再讀到。
- **替代方案**：交錯進 turn。實作較短，但有上述問題，不採用。

### D11：移除 LINE／FB 登入補 email

刪除 `apps/api/src/modules/line-login`、`fb-login`，在 `index.ts` 取消註冊，從 `env.ts` 與 `.env.*.example` 移除 `LINE_LOGIN_*`、`FB_LOGIN_*`。收件匣的「索取 email」按鈕改成「傳送 email 登記連結」。

`ContactMergeLog` 不刪除 `LINE_LOGIN`／`FB_LOGIN` 的歷史值（字串欄位，UAT 也沒有這些紀錄），前端的來源標籤保留對應文字。

### 歸戶順序與歸檔順序

`contact-management` 的「Contact Merging」現行版本在尚未歸檔的 change `add-cross-channel-one-id`。依 `openspec/config.yaml` 的規則，必須先歸檔 `add-cross-channel-one-id`，再歸檔本 change，否則 `openspec archive` 會以「MODIFIED failed ... not found」中止。

`add-cross-channel-one-id` 尚未勾選的項目多為 UAT 驗證與後續追蹤（tasks 9.x）。本 change 實作期間由負責人決定是否先歸檔它，並把未完成的追蹤項目移到 issue。

## Risks / Trade-offs

- **[知道別人 email 就能合併]** → 合併後雙邊通知；7 天內雙方都可自助解除；客服可從合併紀錄解除；同渠道衝突時拒絕合併；AI 指示不主動複述其他渠道的個資。
- **[可探測 email 是否被使用]** 合併成功的通知會透露對方渠道與名稱 → 每小時 5 個連結、每個連結只能成功一次、IP 速率限制，提高大量探測的成本。這是不驗證 email 的固有代價，已在 D2 接受。
- **[AI 讀到錯誤合併對象的對話]** → 解除合併後立即不再讀到（D10）；範圍限 30 天、10 則。
- **[AI 成本增加]** 每次回覆多約 10 則訊息 → 上限固定，且只有歸戶過的聯絡人才有。
- **[多筆相同 email 時選最早建立的]** 可能不是顧客心中的那一位 → 客服可解除後手動合併到正確的聯絡人。

## Migration Plan

1. 部署：不需要 DB migration，也沒有新的權限點，不需要跑 reconcile。
2. 部署後 email 登記預設關閉，由租戶管理員在設定頁開啟。
3. 回復：revert PR。已發生的 `EMAIL` 合併可從合併紀錄逐筆解除。
4. UAT 若曾設定 `LINE_LOGIN_*`／`FB_LOGIN_*`，部署後可從 `.env.api` 移除（目前沒有設定）。
