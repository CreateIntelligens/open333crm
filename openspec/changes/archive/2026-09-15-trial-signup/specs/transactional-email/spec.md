# transactional-email

## ADDED Requirements

### Requirement: SMTP 寄送模式
`email.service.ts` 的 `sendEmail()` MUST 支援第三種 delivery mode `smtp`（`EMAIL_DELIVERY_MODE=smtp`），以 nodemailer 透過 env 設定（SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS，寄件人沿用 EMAIL_FROM）寄送。mode=smtp 而 SMTP_HOST 未設定時 MUST 在啟動時報錯。既有 log/webhook 模式行為 MUST 不變。

#### Scenario: smtp 模式寄信
- **GIVEN** EMAIL_DELIVERY_MODE=smtp 且 SMTP 設定完整
- **WHEN** 呼叫 sendEmail
- **THEN** 信件 MUST 經 SMTP 送出

#### Scenario: 設定不完整
- **GIVEN** EMAIL_DELIVERY_MODE=smtp 但 SMTP_HOST 未設定
- **WHEN** API 啟動載入 env
- **THEN** MUST 拋出明確設定錯誤

### Requirement: 平台級試用信件模板
驗證信、到期提醒信、到期通知信、開通完成信 MUST 以程式碼內 MJML 模板定義（不存 DB、不可被租戶修改），渲染複用既有 MJML 管線與 `{{variable}}` 替換。寄信失敗 MUST 只記 log，MUST NOT 使申請/排程主流程失敗。

#### Scenario: 驗證信內容
- **WHEN** 產生驗證信
- **THEN** 信件 MUST 含站台名稱與帶完整 token 的驗證連結，且 token 明文 MUST 只出現在信件中（DB 僅存雜湊）

#### Scenario: 寄信失敗不影響申請
- **GIVEN** SMTP 暫時不可用
- **WHEN** 申請流程觸發寄驗證信失敗
- **THEN** 申請記錄 MUST 已建立、API 照常回 202，且可用 resend 補寄
