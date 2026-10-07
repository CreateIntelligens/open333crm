## MODIFIED Requirements

### Requirement: 有效上限解析
系統 SHALL 提供 `getEffectiveLimit(tenant, key)`：回傳 `Tenant.limitOverrides[key] ?? Plan.limits[key]`；值為 null 或租戶無 plan 時 MUST 視為無上限。

`Tenant.limitOverrides` 有這個 key 時，系統 MUST 採用覆寫值，即使覆寫值是 null。方案的 `limits` 沒有這個 key 時，系統 MUST 視為無上限。

#### Scenario: 覆寫優先
- **GIVEN** plan.limits.maxAgents=3、tenant.limitOverrides.maxAgents=5
- **WHEN** 解析有效 maxAgents
- **THEN** MUST 為 5

#### Scenario: 無 plan 無上限
- **GIVEN** 租戶 planId 為 null
- **WHEN** 解析任一 limit
- **THEN** MUST 為無上限

#### Scenario: 覆寫成 null 時沒有上限
- **GIVEN** plan.limits.maxAgents=3，tenant.limitOverrides.maxAgents 為 null
- **WHEN** 解析有效 maxAgents
- **THEN** 結果是無上限，不採用方案的 3

#### Scenario: 方案沒有設定這個上限
- **GIVEN** 租戶所屬方案的 limits 沒有 `maxChannels`，租戶也沒有覆寫
- **WHEN** 解析有效 maxChannels
- **THEN** 結果是無上限
