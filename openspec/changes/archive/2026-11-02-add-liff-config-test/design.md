## Context

LIFF 入口頁 `/liff/redirect` 是 LINE Developers 上唯一登記的 Endpoint URL，短連結（`s`）與票券（`ct`）都在這一頁跑 LIFF。票券流程拿到 ID token 後呼叫 `POST /api/v1/fan/coupons/liff-session`，後端用 `verifyLineIdToken` 向 LINE 驗證；任何一步失敗都改走 One ID 登記，所以設定錯誤時看不到失敗。

## Decisions

### D1：測試連結走同一個 LIFF 入口頁，用 `lt` 參數區分

測試要驗證的正是「顧客實際會走的那條路」：同一個 LIFF App、同一個 Endpoint URL、同一個 Login Channel ID 驗證。測試連結是 `https://liff.line.me/{liffId}?lt={testId}&lid={liffId}`，入口頁看到 `lt` 就跑測試流程，不跑短連結或票券。`lt` 跟 `s`、`ct` 一樣存進 sessionStorage，LIFF 登入來回後還讀得到。

### D2：testId 是一次測試的憑證，存在 Redis

- 管理者產生測試時，後端產生 32 bytes 隨機值當 testId，在 Redis 存 `{tenantId, channelId, liffId, loginChannelId}`，10 分鐘過期。設定值在產生時就固定，測試的是當下存檔的設定。
- 公開端點只憑 testId 找到租戶與渠道，不信任請求帶的其他識別。testId 不存在或過期回 410。
- 結果另存一個鍵，同樣 10 分鐘過期。同一條連結可以重測（例如先改 LINE Developers 再開一次），後一次結果覆蓋前一次。
- 後台查結果時，testId 必須屬於這個租戶的這個渠道，否則回 404。

### D3：「已驗證」還要對上這個官方帳號的聯絡人

ID token 驗證通過，只代表 LIFF 與 Login Channel ID 是同一組。顧客開券時，後端還要比對 ID token 的 `sub` 和收券的 LINE userId（design D20）。Login channel 跟官方帳號不在同一個 Provider 時，同一個人的 userId 不同，顧客永遠驗證不過。所以測試也查 `sub` 是否是這個渠道的 LINE 身分（`channel_identities`）：

- 找到：成功。
- 找不到：失敗，原因是 `not_a_friend`。訊息同時說明兩種可能：還沒加好友，或者 Provider 不同。管理者先加好友、傳一則訊息後重測，就能分辨是哪一種。

### D4：驗證 ID token 分辨「不接受」和「連不上」

現有的 `verifyLineIdToken` 兩種情況都回 null（給票券流程用，兩者都改走登記）。測試要給出不同的說明，所以新增 `checkLineIdToken`，回傳 `ok`／`rejected`／`unreachable`。`verifyLineIdToken` 改成包裝它，票券流程的行為不變。LINE 回 5xx、408（逾時）或 429（限流）是暫時的狀態，歸為 `unreachable`；其他非 2xx（例如 400）才是 `rejected`。

### D5：前端回報 LIFF 端的失敗

LIFF 啟動失敗（`init_failed`）和拿不到 ID token（`no_id_token`）只有手機端知道，入口頁把失敗原因送到同一個公開端點。LIFF App ID 錯誤時，LINE 根本不會打開入口頁，後端收不到任何回報，所以後台在連結過期仍未收到結果時，列出常見原因。

### D6：成功紀錄放在渠道 settings 的系統維護欄位

`settings.liffTest = { verifiedAt, liffId, loginChannelId }`，以 `patchChannelSettings` 合併寫入。加進 `SYSTEM_MANAGED_SETTING_KEYS`，Bot 設定整包存檔時不會被舊快照覆蓋，也不能從 API 偽造。後台只在 `liffTest` 的設定值等於目前設定時顯示「上次測試成功」。

### D7：結構

- `channel/liff-test.service.ts`：只收 TenantCtx，讀渠道的 LIFF 設定、查 LINE 身分、寫成功紀錄。
- `channel/liff-test.flow.ts`：產生測試、收回報、查結果。Redis 與向 LINE 驗證都由 deps 注入，向 LINE 驗證不放在交易內。
- 管理端兩條路由加在 `channel.routes.ts`；公開端點放新檔 `channel/liff-test-public.routes.ts`，註冊在 `/api/v1/fan/liff-test`，有限流。

## Risks

- 公開端點能被拿來試 testId：testId 是 32 bytes 隨機值，加上限流，猜中機率可忽略；猜中也只能寫入一筆測試結果。
- 管理者用的 LINE 帳號本身不是好友時會得到 `not_a_friend`：訊息說明要先加好友再測。
