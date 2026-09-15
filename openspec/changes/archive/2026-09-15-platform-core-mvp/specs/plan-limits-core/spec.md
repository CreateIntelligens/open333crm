# plan-limits-core

## ADDED Requirements

### Requirement: 有效上限解析
系統 SHALL 提供 `getEffectiveLimit(tenant, key)`：回傳 `Tenant.limitOverrides[key] ?? Plan.limits[key]`；值為 null 或租戶無 plan 時 MUST 視為無上限。

#### Scenario: 覆寫優先
- **GIVEN** plan.limits.maxAgents=3、tenant.limitOverrides.maxAgents=5
- **WHEN** 解析有效 maxAgents
- **THEN** MUST 為 5

#### Scenario: 無 plan 無上限
- **GIVEN** 租戶 planId 為 null
- **WHEN** 解析任一 limit
- **THEN** MUST 為無上限

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
