# plan-limits-core Specification

## Purpose

定義方案數值上限的解析：租戶的覆寫值優先於方案的設定值，租戶沒有方案時沒有上限。也定義建立成員時的客服人數上限。渠道數量上限見 `granular-plan-entitlement`。

## Requirements

### Requirement: 有效上限解析
系統 SHALL 依下列順序解析租戶某個上限的有效值：

1. `Tenant.limitOverrides` 有這個 key 時，採用覆寫值，即使覆寫值是 null。
2. 租戶沒有覆寫、但有方案，而且方案的 `limits` 有這個 key 時，採用 `Plan.limits[key]`。
3. 其他情況，有效值是 null。

有效值是 null 時，系統 MUST 視為無上限。`monthlyTokens` 依這個順序得到的是基礎上限，AI 月額度另外加上當月的加購量，見「AI 月額度含當月加購量」。

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

### Requirement: AI 月額度含當月加購量
租戶本月的有效 `monthlyTokens` SHALL 是基礎上限（見「有效上限解析」）加上本月已核准的加購量總和。本月以台灣時間（`Asia/Taipei`）計算。

一筆加購是 `type=token_topup`、`status=approved` 的方案異動申請，屬於核准時間（`reviewedAt`）所在的台灣月份。待審與已駁回的申請 MUST NOT 計入，其他租戶的申請 MUST NOT 計入。

基礎上限是無上限時，有效 `monthlyTokens` MUST 仍是無上限。

#### Scenario: 同月多筆加購加總
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶沒有覆寫
- **AND** 租戶在台灣時間 2026-11 核准了兩筆加購，200,000 與 300,000
- **WHEN** 台灣時間 2026-11-20 解析租戶的有效 `monthlyTokens`
- **THEN** 結果是 1,500,000

#### Scenario: 下個月回到方案額度
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶在台灣時間 2026-11-10 核准了加購 500,000
- **WHEN** 台灣時間 2026-12-01 00:00 解析租戶的有效 `monthlyTokens`
- **THEN** 結果是 1,000,000

#### Scenario: 台灣月初凌晨核准的加購算在新月份
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，一筆加購 500,000 在台灣時間 2026-12-01 00:30（UTC 2026-11-30 16:30）核准
- **WHEN** 分別在台灣時間 2026-11-30 23:00 與 2026-12-01 01:00 解析有效 `monthlyTokens`
- **THEN** 結果分別是 1,000,000 與 1,500,000

#### Scenario: 待審、駁回與其他租戶的加購不計入
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000
- **AND** 本月租戶有一筆待審的加購 100,000、一筆已駁回的加購 200,000，另一個租戶有一筆已核准的加購 400,000
- **WHEN** 解析租戶的有效 `monthlyTokens`
- **THEN** 結果是 1,000,000

#### Scenario: 升級方案後加購加在新方案的額度上
- **GIVEN** 租戶的方案是 light（`monthlyTokens` 1,500,000），本月已核准加購 50,000
- **WHEN** 租戶升級到 standard（`monthlyTokens` 3,000,000）之後解析有效 `monthlyTokens`
- **THEN** 結果是 3,050,000

#### Scenario: 基礎上限無上限時仍無上限
- **GIVEN** 租戶本月已核准加購 500,000，之後方案改成 `monthlyTokens` 是 null 的方案
- **WHEN** 解析有效 `monthlyTokens`
- **THEN** 結果是無上限
