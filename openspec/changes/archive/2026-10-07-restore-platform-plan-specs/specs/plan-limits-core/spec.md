## MODIFIED Requirements

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
