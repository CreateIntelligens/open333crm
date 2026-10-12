## MODIFIED Requirements

### Requirement: 每個門檻每月最多告警一次
除了下面核准加購的情況，同一個租戶、同一個月（UTC）、同一個門檻，系統 SHALL 最多發送一次告警。系統以 Redis 的 `SET NX` 寫入 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`，寫入成功才發送。這個 key 在下個月 1 日 0 時（UTC）過期，所以新的月份可以再次告警。

平台核准加購申請（見 `plan-change-request` 的「核准加購申請」）之後，系統 SHALL 刪除這個租戶本月所有門檻的 key。用量跨越新上限的門檻時，系統會再次告警。

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
