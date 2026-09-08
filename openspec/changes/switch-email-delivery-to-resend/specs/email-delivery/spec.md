## Purpose

提供一致且可設定的系統郵件寄送能力，讓正式環境能以 Resend API 發送郵件，同時保留本機開發、webhook 與既有 SMTP 部署的相容性。

## ADDED Requirements

### Requirement: Resend delivery mode

系統 MUST 支援 `EMAIL_DELIVERY_MODE=resend`。在此模式下，系統 MUST 將既有郵件的寄件人、收件人、主旨、HTML 內容與可選純文字內容送至 Resend，且不得要求 Gmail SMTP host、user 或 password。

#### Scenario: 使用 Resend 成功寄送 HTML 郵件

- **WHEN** 系統設定 `EMAIL_DELIVERY_MODE=resend`、有效的 `RESEND_API_KEY` 與已驗證寄件人的 `EMAIL_FROM`，並呼叫郵件寄送能力
- **THEN** 系統以 Resend API 寄送相同的 `from`、`to`、`subject`、`html` 與 `text` 欄位，並將成功回應的 provider message ID 記錄在可供診斷的郵件紀錄中

#### Scenario: Resend 模式不使用 SMTP

- **WHEN** 系統設定 `EMAIL_DELIVERY_MODE=resend` 且 SMTP 環境變數未設定
- **THEN** 郵件寄送仍可執行，且系統不得建立 SMTP transporter 或嘗試連線 Gmail SMTP

### Requirement: Resend configuration validation

系統 MUST 在 Resend 模式啟動或首次載入設定時驗證 `RESEND_API_KEY` 與 `EMAIL_FROM` 已設定。缺少任一必要設定時，系統 MUST 明確回報設定錯誤，且 MUST NOT 嘗試呼叫 Resend 或以未驗證的預設寄件人寄信。

#### Scenario: 缺少 Resend API key

- **WHEN** `EMAIL_DELIVERY_MODE=resend` 且 `RESEND_API_KEY` 未設定
- **THEN** 環境設定驗證失敗，錯誤指出缺少 `RESEND_API_KEY`，且錯誤內容不得包含 API key 值

#### Scenario: 缺少寄件人

- **WHEN** `EMAIL_DELIVERY_MODE=resend` 且 `EMAIL_FROM` 未設定
- **THEN** 環境設定驗證失敗，錯誤指出 Resend 模式需要 `EMAIL_FROM`

### Requirement: Delivery error semantics

系統 MUST 將 Resend API 的非成功回應或 SDK 錯誤視為寄送失敗，保留既有 `sendEmail()` 呼叫端的錯誤處理語意；系統 MUST 記錄可診斷的錯誤資訊，但 MUST NOT 記錄 `RESEND_API_KEY` 或完整郵件內容。Resend 失敗時，系統 MUST NOT 在同一次寄送中自動改用 SMTP 重送，以避免重複寄信。

#### Scenario: Resend API 拒絕郵件

- **WHEN** Resend 回傳錯誤或拒絕郵件
- **THEN** `sendEmail()` 的 promise 以錯誤結束，錯誤可被現有安全寄送呼叫端記錄，且不會觸發 SMTP fallback

#### Scenario: Resend API timeout 或網路錯誤

- **WHEN** 呼叫 Resend 時發生 timeout 或網路錯誤
- **THEN** 系統將寄送視為失敗並記錄 provider/網路錯誤摘要，不記錄 API key、Authorization header 或完整 HTML

### Requirement: Existing delivery mode compatibility

系統 MUST 保持 `log`、`webhook` 與 `smtp` delivery mode 的既有行為。除非明確設定 `EMAIL_DELIVERY_MODE=resend`，系統 MUST NOT 改變現有 delivery mode 的選擇；未設定 delivery mode 時 MUST 維持 `log` 預設。

#### Scenario: 開發環境預設仍為 log

- **WHEN** 未設定 `EMAIL_DELIVERY_MODE` 且呼叫郵件寄送能力
- **THEN** 系統只記錄郵件摘要，不呼叫 Resend、SMTP 或 webhook

#### Scenario: SMTP fallback deployment remains usable

- **WHEN** `EMAIL_DELIVERY_MODE=smtp` 且既有 SMTP 設定完整
- **THEN** 系統仍可透過 SMTP 寄送郵件，且 Resend 設定不是必要條件

### Requirement: All system email paths use the shared delivery capability

系統的試用流程、平台帳號郵件、用量告警與畫布 Email 節點 MUST 繼續經由共用郵件寄送能力發送，並在 `EMAIL_DELIVERY_MODE=resend` 時使用 Resend；這些郵件模板的收件人、主旨與內容不得因 provider 切換而改變。

#### Scenario: Platform welcome email uses Resend

- **WHEN** 平台管理員建立帳號或重寄開通信，且 delivery mode 為 resend
- **THEN** 平台開通信經由 Resend 發送，且現有登入連結與模板內容保留

#### Scenario: Trial and notification emails use Resend

- **WHEN** 試用驗證/開通信或用量告警觸發，且 delivery mode 為 resend
- **THEN** 對應郵件經由 Resend 發送，且不需要各模組自行處理 Resend API key
