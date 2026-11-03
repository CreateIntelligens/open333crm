# Proposal

## Why

2026-10-30 的設定健檢發現三組問題（`docs/ref/features/health/SETTINGS.md`）：

- 營業時間不檢查輸入（HC-SETTINGS-03、04）。存入不合法的時區之後，非營業時間的自動回覆整個失效，後台沒有任何提示。
- 營業時間的設定是 `{}` 時，營業時間頁按「啟用」整頁崩潰（HC-SETTINGS-01）。收過訊息的租戶多半是這種狀態。
- API 金鑰與 CLI token 的有效天數沒有上限，值太大時回 500（HC-SETTINGS-06、12）。建立與撤銷這兩種長效憑證也不寫稽核，事後查不出是誰建立的（AUD-01）。

#337 第九批搬遷這四組設定時，路由與 flow 已經整理好，所以在同一個分支修正。

## What Changes

- `PUT /api/v1/settings/office-hours` 檢查輸入，不合法時回 400 `VALIDATION_ERROR`，已存的設定不變：
  - 時段的格式是 `HH:mm`，範圍 00:00～23:59，結束時間必須晚於開始時間。跨午夜的時段不支援，回 400。
  - 假日必須是存在的日期（`YYYY-MM-DD`），最多 366 筆。
  - 時區必須是有效的 IANA 時區。
  - 非營業時間的訊息長度是 1～1000 字。
- 讀取營業時間時，已存的設定不合法（例如 `{}`、不合法的時區），系統當作沒有設定：`GET` 回傳預設值，`enabled` 是 `false`。收訊時不送非營業時間的自動回覆，也不記錯誤。
- `POST /api/v1/settings/api-keys` 與 `POST /api/v1/settings/cli-sessions` 的 `expiresInDays` 只收 1～365 的整數，其他值回 400 `VALIDATION_ERROR`。API 金鑰不送或送 `null` 時仍然永不過期。CLI token 不送或送 `null` 時仍然是 30 天。
- 在設定頁建立與撤銷 API 金鑰、CLI token 時，寫一筆 `settings.update` 租戶稽核。CLI 登入（`POST /auth/cli/login`）與登出（`POST /auth/cli/logout`）寫 `cli_session.login`、`cli_session.logout` 稽核。稽核與憑證的寫入在同一個交易。

## Capabilities

### New Capabilities

- `partner-api-key`：Partner API 金鑰的管理規則。這次只寫有效天數的限制。

### Modified Capabilities

- `office-hours-settings`：新增「營業時間的輸入檢查」與「已存的營業時間不合法時當作沒有設定」。
- `open333-cli-auth`：新增設定頁建立 CLI token 時的有效天數限制。
- `tenant-audit-log`：修改「記錄租戶內的敏感操作」，加上 API 金鑰與 CLI token 的建立與撤銷。

## Impact

- API：
  - `PUT /settings/office-hours`：原本存得進去的不合法輸入，現在回 400。
  - `POST /settings/api-keys`、`POST /settings/cli-sessions`：`expiresInDays` 超過 365 時，原本回 201 或 500，現在回 400。
  - 回應的格式不變。
- 前端：營業時間頁送出的值都在新的範圍內，只有跨午夜的時段會被拒。被拒時頁面只顯示通用的錯誤訊息（HC-SETTINGS-08），這次不改。`officeHours` 為 `{}` 的租戶改由後端回傳預設值，頁面不再崩潰。
- 資料：沒有 migration。已存的不合法設定不改寫，下一次儲存時覆蓋。
- 稽核：`tenant_audit_logs` 多出 `section` 為 `api-keys`、`cli-sessions` 的 `settings.update` 紀錄，以及 `cli_session.login`、`cli_session.logout` 紀錄。
- 程式：`apps/api/src/modules/settings/` 的營業時間檔案、`apps/api/src/modules/auth/partner-api-key.flow.ts`、`cli-session.flow.ts`，以及兩個憑證的路由檔。
