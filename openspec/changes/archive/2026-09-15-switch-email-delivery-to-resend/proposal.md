## Why

目前系統的 SMTP 寄信設定雖然是通用的，但文件與常見部署方式以 Gmail SMTP、帳號和 App Password 為例。SMTP 需要維護連線參數與郵件服務商密碼，部署時也較容易遇到 Gmail 驗證、寄件網域與服務可用性問題；Resend 提供適合後端服務的 API 與寄件網域管理，應成為正式環境的主要寄信方式。

## What Changes

- 新增 `resend` 郵件投遞模式，使用 Resend Node SDK/API 寄送既有的 HTML 與純文字郵件。
- 以 `RESEND_API_KEY` 保存 Resend API key，沿用 `EMAIL_FROM` 作為已驗證網域的寄件人。
- 將正式環境文件與範例設定從 Gmail SMTP 改為 Resend；本機預設 `log` 模式不變。
- 保留既有 `log`、`webhook` 與 `smtp` 模式，讓既有部署可回退，並避免一次切換造成不必要的相容性破壞。
- 統一處理 Resend API 錯誤、未設定必要環境變數與回傳的 provider message ID；既有呼叫端維持 `sendEmail()` 介面。
- 覆蓋試用驗證/開通信、平台帳號、用量告警與畫布 Email 節點等現有寄信路徑的測試，確認它們都經由 Resend adapter。

## Capabilities

### New Capabilities

- `email-delivery`: 以可設定的 delivery mode 寄送系統郵件，正式環境支援 Resend API，並保留 log、webhook 與 SMTP 相容模式。

### Modified Capabilities

- 無。

## Impact

- API 郵件服務：`apps/api/src/modules/email/email.service.ts` 與環境設定驗證。
- API 套件依賴：新增 `resend`，評估移除或保留 `nodemailer` 以支援既有 SMTP fallback。
- 環境範例、部署文件與通知文件：改列 Resend API key、寄件人與已驗證網域設定。
- 測試：新增 Resend client mock、成功/失敗/缺少設定案例，並驗證所有現有郵件模板仍可發送。
- 無資料庫 migration、無對外 HTTP route 變更；郵件服務的公開 `sendEmail` 輸入介面維持不變。
