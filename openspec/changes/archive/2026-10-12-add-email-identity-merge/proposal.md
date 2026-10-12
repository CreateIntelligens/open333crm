# Proposal

## Why

同一位顧客在 LINE、Facebook、Instagram、網站客服各有一個聯絡人，客服與 AI 都只看得到當下渠道的對話。2026-10-06 需求會議決定以 email 作為跨渠道的 One ID：顧客在連結填入 email，系統把同 email 的聯絡人自動歸戶；客服知道某個 email 屬於誰時也能手動歸戶。歸戶之後，客服與 AI 回覆都要能讀到這位顧客在所有渠道的對話。

現有的 email 歸戶路徑是 LINE／Facebook 登入補 email（`line-login`、`fb-login`），它有 AUDIT IDENT-02 的漏洞（公開端點可產生任意渠道身分的授權網址、callback 不比對登入者），而且 UAT 沒有設定 LINE Login／FB Login，從未產生過合併。本 change 以新流程取代它。

## What Changes

- 顧客在對話中輸入 email 登記關鍵字，或客服在收件匣按「傳送 email 登記連結」，系統回傳一次性的登記連結。
- 顧客在登記網頁填入 email（不寄驗證信）。同租戶有另一位未封存聯絡人使用相同 email 時，系統自動合併，並在雙方渠道通知；沒有時只把 email 寫到這位聯絡人。
- 自動合併沿用綁定代碼的保護：同一渠道雙方都有身分時拒絕合併；合併後 7 天內顧客可回覆解除關鍵字自助解除；客服可從合併紀錄解除。
- 客服在聯絡人頁把 email 改成另一位聯絡人已使用的 email 時，系統顯示合併預覽，由客服決定合併或仍要儲存。既有的手動合併功能保留不變。
- 收件匣右側面板新增「其他渠道的對話」，聯絡人詳情頁新增「對話紀錄」分頁，依客服的渠道可見性過濾。
- AI 回覆（KB 自動回覆與 Agent 模式）除了當下對話，也讀取同一位聯絡人在其他渠道最近 30 天、最多 10 則訊息，並標上渠道。
- 綁定代碼流程保留，與 email 登記並存。
- **BREAKING**：移除 `/auth/line/*`、`/auth/fb/*` 路由與 `line-login`、`fb-login` 模組，以及收件匣的「索取 email」按鈕。`LINE_LOGIN_*`、`FB_LOGIN_*` 環境變數不再使用。UAT 沒有設定這些變數，沒有使用者受影響。

## Capabilities

### New Capabilities

- `email-identity-merge`：顧客以登記連結填入 email、系統依相同 email 自動歸戶、雙邊通知與自助解除，以及客服修改 email 時的合併確認。
- `cross-channel-conversation-view`：客服在收件匣與聯絡人頁查看同一位聯絡人在所有可見渠道的對話。
- `ai-cross-channel-context`：AI 回覆時讀取同一位聯絡人在其他渠道的近期訊息。

### Modified Capabilities

- `contact-management`：「Contact Merging」的合併路徑清單移除 LINE Login、FB Login，加入 email 登記。這條需求的現行版本在尚未歸檔的 change `add-cross-channel-one-id`，該 change 必須先歸檔（見 design.md「歸檔順序」）。

## Impact

- **API**：新增公開端點（讀取登記連結資訊、送出 email）與聯絡人跨渠道訊息端點；`PATCH /api/v1/contacts/:id` 在 email 與他人重複時回 409；`kb-autoreply.service.ts`、`agent.service.ts` 的對話紀錄讀取改為依聯絡人；移除 `line-login`、`fb-login` 模組與 `env.ts` 的六個變數。
- **入站處理**：`identity-binding` 的關鍵字攔截新增 email 登記關鍵字；解除綁定也涵蓋 email 歸戶。
- **Web**：新增公開登記頁 `/bind/email/[token]`、收件匣面板區塊、聯絡人頁分頁、email 重複時的合併確認；移除「索取 email」按鈕。
- **資料**：不需要 migration。`ContactMergeLog.source` 是字串欄位，新增值 `EMAIL`；租戶設定 `identityBinding` JSON 新增 `emailEnabled`、`emailKeywords`。
- **文件**：AUDIT.md 的 IDENT-02 改為已修正；`docs/ref` 的聯絡人與收件匣文件；CHANGELOG。
