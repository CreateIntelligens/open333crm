## MODIFIED Requirements

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

## ADDED Requirements

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
