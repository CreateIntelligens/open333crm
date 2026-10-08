## ADDED Requirements

### Requirement: 跨越用量門檻時發送告警
`USAGE_QUOTA_ALERTS_ENABLED` 是 1（預設值）時，系統 SHALL 在租戶本月的 AI 用量（見 `token-quota` 的「本月 AI 用量的計數」）剛跨越門檻時，發送告警給租戶的管理員。管理員是角色列舉為 `ADMIN`、而且啟用中的成員。

門檻是有效 `monthlyTokens` 的固定比例：warning 是 80%，critical 是 100%。「剛跨越」是指累加前的用量小於門檻，累加後的用量大於或等於門檻。

#### Scenario: 用量首次跨越 80%
- **WHEN** 一次累加使租戶本月的用量從低於上限的 80%，變成大於或等於 80%、但小於上限
- **THEN** 系統發送 warning 告警

#### Scenario: 用量跨越 100%
- **WHEN** 一次累加使租戶本月的用量從低於上限，變成大於或等於上限
- **THEN** 系統發送 critical 告警

#### Scenario: 一次呼叫同時跨越 80% 與 100%
- **WHEN** 一次累加使用量從低於 80%，變成大於或等於上限
- **THEN** 系統發送 warning 與 critical 兩種告警，各一次

#### Scenario: 關閉告警
- **GIVEN** `USAGE_QUOTA_ALERTS_ENABLED` 是 0
- **WHEN** 一次累加使用量跨越門檻
- **THEN** 系統不發送告警

### Requirement: 每個門檻每月最多告警一次
同一個租戶、同一個月（UTC）、同一個門檻，系統 SHALL 最多發送一次告警。系統以 Redis 的 `SET NX` 寫入 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`，寫入成功才發送。這個 key 在下個月 1 日 0 時（UTC）過期，所以新的月份可以再次告警。

#### Scenario: 同月重複跨越同一個門檻
- **GIVEN** 租戶本月已經發送過 warning 告警
- **WHEN** 之後的累加再次跨越 80%
- **THEN** 系統不再發送 warning 告警

#### Scenario: 兩次累加同時跨越同一個門檻
- **WHEN** 兩次同時進行的累加都偵測到剛跨越同一個門檻
- **THEN** 系統只發送一次告警

#### Scenario: 進入新的月份
- **GIVEN** 租戶上個月已經發送過 warning 告警
- **WHEN** 租戶在新的月份跨越 80%
- **THEN** 系統發送新月份的 warning 告警

### Requirement: 只對計入額度的用量告警
只有計入 `token-quota` 計數的用量會觸發告警：租戶自備金鑰的呼叫不觸發。有效 `monthlyTokens` 是無上限的租戶，系統 MUST NOT 發送告警。

#### Scenario: 沒有上限的租戶不告警
- **GIVEN** 租戶的有效 `monthlyTokens` 是無上限
- **WHEN** 租戶使用 AI
- **THEN** 系統不發送告警

#### Scenario: 自備金鑰的用量不告警
- **WHEN** 租戶以自備金鑰（`keySource` 是 `byok`）呼叫 AI
- **THEN** 系統不累加計數器，也不發送告警

### Requirement: 告警的通知與信件
系統 SHALL 對每位管理員發送一則站內通知與一封 email：

- 站內通知的類型是 `usage_quota_warning` 或 `usage_quota_critical`，`clickUrl` 是 `/dashboard/plan`。
- email 含租戶名稱、本月已用與上限的 token 數，以及一個按鈕，連到 `WEB_BASE_URL` 下的 `/dashboard/plan`。email 中由使用者輸入的字串 MUST 經過 HTML 轉義。
- critical 的 email 說明 AI 自動回覆已暫停，真人回覆不受影響。

#### Scenario: 每位管理員都收到通知與 email
- **GIVEN** 租戶有兩位啟用中的管理員
- **WHEN** 系統發送 critical 告警
- **THEN** 每位管理員各收到一則 `usage_quota_critical` 站內通知與一封 critical email

#### Scenario: critical email 說明影響
- **WHEN** 系統發送 critical email
- **THEN** email 說明 AI 自動回覆已暫停、真人回覆不受影響

#### Scenario: email 的按鈕連到站台的方案頁
- **GIVEN** `WEB_BASE_URL` 是 `https://crm.example`
- **WHEN** 系統發送告警 email
- **THEN** email 的按鈕連到 `https://crm.example/dashboard/plan`

#### Scenario: 租戶名稱經過 HTML 轉義
- **GIVEN** 租戶名稱含 `<script>`
- **WHEN** 系統發送告警 email
- **THEN** email 的內容含 `&lt;script&gt;`，不含 `<script>`

### Requirement: 告警不影響 AI 回覆
告警的偵測與發送 MUST NOT 阻擋或延遲 AI 回覆。Redis 無法使用、站內通知入列失敗或 email 寄送失敗時，系統只寫日誌，AI 回覆照常完成。

#### Scenario: Redis 無法使用時跳過告警
- **GIVEN** 累加計數器時 Redis 無法連線
- **WHEN** 一次 AI 呼叫成功
- **THEN** 系統不發送告警，AI 回覆照常完成

#### Scenario: email 寄送失敗
- **WHEN** 一封告警 email 寄送失敗
- **THEN** 系統寫入錯誤日誌，其他管理員的通知與 email 照常發送
