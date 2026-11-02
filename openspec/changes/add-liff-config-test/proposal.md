## Why

LINE 顧客開優惠券時，靠 LIFF 取得的 ID token 自動驗證身分（`add-coupon-system` design D20）。這需要渠道的 LIFF App ID、LINE Login Channel ID 和 LINE Developers 上的設定都正確。現在後台存檔時只檢查格式。設定錯誤時，顧客開券會靜靜改走 email／手機登記，管理者看不到任何失敗，要等顧客反映「為什麼要我登記」才會發現。2026-10-22 也是靠真機逐步實測才確認設定正確。

渠道卡片上的「測試連線」只用 Channel Access Token 檢查 Messaging API，不會檢查 LIFF 與 Login channel。

issue #401。

## What Changes

- 新增「測試 LIFF 設定」：管理者在 LINE 渠道的 Bot 設定產生 10 分鐘有效的測試連結與 QR code，用手機 LINE 開啟。手機走跟顧客開券相同的 LIFF 登入、取得 ID token，後端以渠道的 Login Channel ID 向 LINE 驗證。
- 結果同時顯示在後台與手機上。失敗時寫出原因：LIFF 啟動失敗、Scope 沒有 openid、ID token 跟 Login Channel ID 不符、連不上 LINE，以及 LINE 帳號不在這個官方帳號的聯絡人裡（沒加好友，或 Login channel 跟官方帳號不在同一個 Provider）。
- 測試連結過期都沒收到結果時，後台提示常見原因（LIFF App ID 錯誤、Endpoint URL 錯誤）。
- 測試成功時記錄時間與測試的設定值；設定值改過後，後台不再顯示「上次測試成功」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `channel-management`：新增 LIFF 設定的測試。

## Impact

- API：`POST /api/v1/channels/:id/liff-test`、`GET /api/v1/channels/:id/liff-test/:testId`（權限 `channel.update`）；公開端點 `POST /api/v1/fan/liff-test`（測試連結本身就是憑證，有限流）。
- Redis：測試連結與結果，10 分鐘過期。
- 渠道 `settings.liffTest`：最後一次測試成功的時間與設定值，列為系統維護欄位，整包更新渠道設定時不會被洗掉。
- Web：`BotConfigForm` 的測試區塊、LIFF 入口頁 `/liff/redirect` 的測試流程。
- 不需要 migration。
