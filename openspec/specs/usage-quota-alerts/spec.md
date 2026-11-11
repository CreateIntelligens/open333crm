# usage-quota-alerts Specification

## Purpose
定義 AI 用量的告警：租戶本月的用量跨越月額度的 80% 與 100% 時，對管理員發送站內通知與 email，每個門檻每月最多一次。用量的計數見 `token-quota`。

## Requirements

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
除了「月額度提高後可以再次告警」的情況，同一個租戶、同一個月（台灣時間 `Asia/Taipei`）、同一個門檻，系統 SHALL 最多發送一次告警。系統以 Redis 的 `SET NX` 寫入 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`（台灣月份），寫入成功才發送。這個 key 在台灣時間下個月 1 日 0 時過期，所以新的月份可以再次告警。告警的通知與 email 中的月份 SHALL 是同一個台灣月份。

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

#### Scenario: 核准加購後再次跨越門檻
- **GIVEN** 租戶的有效 `monthlyTokens` 是 200,000，本月已經發送過 warning 與 critical 告警
- **WHEN** 平台核准加購 300,000，之後一次累加使用量從 390,000 變成 400,000
- **THEN** 系統發送 warning 告警，上限是 500,000

#### Scenario: 告警的月份是台灣月份
- **WHEN** 租戶在台灣時間 2026-09-01 01:00（UTC 2026-08-31 17:00）跨越 80%
- **THEN** 告警的月份是 `2026-09`，寫入 `aiquota-alert:{tenantId}:2026-09:warning`，這個 key 在台灣時間 2026-10-01 0 時過期

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
告警的偵測與發送 MUST NOT 阻擋 AI 回覆：Redis 無法使用、告警事件寫入失敗、站內通知入列失敗或 email 寄送失敗時，系統只寫日誌，AI 回覆照常完成。Redis 沒有回應時，告警的處理最多讓 AI 回覆多等一個 Redis 指令的逾時（1 秒）。告警事件 `usage.quota.threshold` SHALL 在用量紀錄 commit 之後經 outbox 送出，至少送出一次；重送時不重複寄信，見「事件重送時不重複寄出告警信」。

#### Scenario: Redis 無法使用時跳過告警
- **GIVEN** 累加計數器時 Redis 無法連線
- **WHEN** 一次 AI 呼叫成功
- **THEN** 系統不發送告警，AI 回覆照常完成

#### Scenario: email 寄送失敗
- **WHEN** 一封告警 email 寄送失敗
- **THEN** 系統寫入錯誤日誌，其他管理員的通知與 email 照常發送

#### Scenario: 告警事件寫進 outbox
- **WHEN** 一次 AI 呼叫使租戶本月的用量跨越 80%
- **THEN** outbox 有一筆這個租戶的 `usage.quota.threshold` 事件，level 是 `warning`

#### Scenario: 告警事件寫入失敗
- **WHEN** 一次 AI 呼叫使用量跨越門檻，寫入告警事件的交易失敗
- **THEN** 系統寫入錯誤日誌，AI 回覆照常完成
- **AND** 這個門檻的 Redis key 已經寫入，所以本月不再發送這個門檻的告警

### Requirement: 事件重送時不重複寄出告警信

告警信的保證是至少一次。一個告警事件的每位收件管理員，系統 MUST 只建立一個寄信的 job，job id MUST 由事件 id 與管理員的 id 組成。寄送失敗時，系統 MUST 重試這個 job。寄信服務已經收下信、job 還沒完成時中斷，重試會多寄一封；系統接受這個情況，不為此少寄。

#### Scenario: 告警事件處理兩次

- **WHEN** `usage.quota.threshold` 事件 E 的通知訂閱者 job 執行兩次，租戶有一位管理員
- **THEN** 管理員 MUST 只收到一封 E 的告警信

#### Scenario: Email provider fails

- **WHEN** 寄出事件 E 的告警信時，寄信服務回傳錯誤
- **THEN** 寄信的 job MUST 失敗，由佇列重試

### Requirement: 月額度提高後可以再次告警
下列操作使租戶的有效 `monthlyTokens` 提高之後，系統 SHALL 刪除這個租戶本月所有門檻的告警 key，用量跨越新上限的門檻時會再次告警：

- 平台核准加購申請（一律視為提高）。
- 平台核准升級申請、平台以 `PATCH /api/v1/platform/tenants/:id` 變更租戶的方案、試用轉為付費方案。
- 平台修改方案的 `limits.monthlyTokens`：影響這個方案的每個租戶。

「提高」是指操作之後的基礎上限大於操作之前，或從有限變成無上限。上限不變或降低時，系統 MUST NOT 刪除告警 key。租戶的 `limitOverrides` 有 `monthlyTokens` 時，換方案不改變基礎上限，所以不刪除。

#### Scenario: 升級方案後再次跨越門檻
- **GIVEN** 租戶的方案 `monthlyTokens` 是 1,500,000，本月已經發送過 warning 與 critical 告警
- **WHEN** 平台核准升級到 `monthlyTokens` 3,000,000 的方案，之後一次累加使用量從 2,390,000 變成 2,400,000
- **THEN** 系統發送 warning 告警，上限是 3,000,000

#### Scenario: 平台變更租戶方案或試用轉付費後再次告警
- **GIVEN** 租戶本月已經發送過 warning 告警，方案的 `monthlyTokens` 是 1,000
- **WHEN** 平台以租戶編輯頁或試用轉付費把租戶改到 `monthlyTokens` 100,000 的方案
- **THEN** 這個租戶本月的 warning 告警 key 被刪除

#### Scenario: 平台調高方案額度後再次告警
- **GIVEN** 方案 `monthlyTokens` 是 200,000，租戶甲與乙使用這個方案，乙的覆寫是 `monthlyTokens` 500,000，兩者本月都已發送過 warning 告警
- **WHEN** 平台把這個方案的 `limits.monthlyTokens` 改成 400,000
- **THEN** 甲的告警 key 被刪除，乙的告警 key 保留

#### Scenario: 降級不刪除告警紀錄
- **GIVEN** 租戶的方案 `monthlyTokens` 是 3,000,000，本月已經發送過 warning 告警
- **WHEN** 平台把租戶改到 `monthlyTokens` 1,500,000 的方案
- **THEN** 這個租戶本月的 warning 告警 key 保留
