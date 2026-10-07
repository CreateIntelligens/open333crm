## MODIFIED Requirements

### Requirement: 渠道數量上限

Plan MUST 支援 `plan.limits.maxChannels`（number，null=無上限）。有效的 `maxChannels` 依 `plan-limits-core` 的「有效上限解析」決定：租戶的 `limitOverrides` 有 `maxChannels` 這個 key 時採用覆寫值，否則採用方案的值。

建立渠道時，若有效 `maxChannels` 非 null，而且租戶啟用中的渠道數已達上限，MUST 拒絕（`PLAN_LIMIT_EXCEEDED` 403，details 含 `limitKey`、`current`、`max`），比照 `maxAgents` 硬擋機制。停用的渠道不計數。

#### Scenario: 達渠道數上限擋新建

- **GIVEN** 某方案 `maxChannels=1`，租戶已有 1 個渠道
- **WHEN** 建立第 2 個渠道
- **THEN** MUST 回 `PLAN_LIMIT_EXCEEDED` 403，渠道 MUST NOT 被建立

#### Scenario: 無上限不擋

- **GIVEN** 某方案 `maxChannels` 為 null
- **WHEN** 建立渠道
- **THEN** MUST 不因數量被擋

#### Scenario: 停用的渠道不計數

- **GIVEN** 某方案 `maxChannels=1`，租戶唯一的渠道已停用
- **WHEN** 建立渠道
- **THEN** 渠道建立成功

#### Scenario: 租戶覆寫渠道數上限

- **GIVEN** 某方案 `maxChannels=1`，租戶的 `limitOverrides.maxChannels` 是 2，租戶已有 1 個啟用中的渠道
- **WHEN** 建立渠道
- **THEN** 渠道建立成功
