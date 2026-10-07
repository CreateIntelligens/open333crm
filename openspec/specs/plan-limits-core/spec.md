# plan-limits-core Specification

## Purpose

定義方案數值上限的解析：租戶的覆寫值優先於方案的設定值，租戶沒有方案時沒有上限。也定義建立成員時的客服人數上限。渠道數量上限見 `granular-plan-entitlement`。

## Requirements

### Requirement: 有效上限解析
系統 SHALL 依下列順序解析租戶某個上限的有效值：

1. `Tenant.limitOverrides` 有這個 key 時，採用覆寫值，即使覆寫值是 null。
2. 租戶沒有覆寫、但有方案，而且方案的 `limits` 有這個 key 時，採用 `Plan.limits[key]`。
3. 其他情況，有效值是 null。

有效值是 null 時，系統 MUST 視為無上限。

#### Scenario: 覆寫優先
- **GIVEN** plan.limits.maxAgents=3、tenant.limitOverrides.maxAgents=5
- **WHEN** 解析有效 maxAgents
- **THEN** MUST 為 5

#### Scenario: 無 plan 無上限
- **GIVEN** 租戶 planId 為 null
- **WHEN** 解析任一 limit
- **THEN** MUST 為無上限

#### Scenario: 沒有覆寫時採用方案的值
- **GIVEN** plan.limits.maxAgents=3，tenant.limitOverrides 沒有 `maxAgents` 這個 key
- **WHEN** 解析有效 maxAgents
- **THEN** 結果是 3

#### Scenario: 覆寫成 null 時沒有上限
- **GIVEN** plan.limits.maxAgents=3，tenant.limitOverrides 有 `maxAgents` 這個 key，值是 null
- **WHEN** 解析有效 maxAgents
- **THEN** 結果是無上限，不採用方案的 3

#### Scenario: 方案沒有設定這個上限
- **GIVEN** 租戶所屬方案的 limits 沒有 `maxChannels`，租戶也沒有覆寫
- **WHEN** 解析有效 maxChannels
- **THEN** 結果是無上限

### Requirement: 客服人數建立時硬擋
`createAgent` MUST 在權限檢查之後、建立之前，檢查該租戶 active agent 數是否已達有效 maxAgents；達上限 MUST 擋下並回 `PLAN_LIMIT_EXCEEDED` 錯誤（含 limitKey、current、max），該 agent MUST NOT 被建立。無上限時 MUST NOT 檢查。

#### Scenario: trial 租戶達人數上限
- **GIVEN** trial 租戶有效 maxAgents=3 且已有 3 位 active agent
- **WHEN** admin 新增第 4 位客服
- **THEN** 回應 MUST 為 403 `PLAN_LIMIT_EXCEEDED` 且帶 `{ limitKey:'maxAgents', current:3, max:3 }`

#### Scenario: 停用的 agent 不計數
- **GIVEN** 有效 maxAgents=3，租戶有 3 位 agent 其中 1 位 isActive=false
- **WHEN** 新增一位客服
- **THEN** 新增 MUST 成功
