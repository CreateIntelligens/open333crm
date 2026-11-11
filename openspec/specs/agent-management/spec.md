## Purpose
定義租戶成員（客服帳號）的管理：建立成員、指派角色、成員修改自己的密碼，以及重設其他成員的密碼。停用與永久刪除見 `agent-lifecycle`；角色與越權防護見 `role-management`。

## Requirements

### Requirement: Change Own Password

`PATCH /api/v1/agents/me/password` SHALL 讓登入的成員修改自己的密碼，不要求權限碼。請求 SHALL 帶目前的密碼與新密碼，新密碼至少 8 個字元。目前的密碼不正確時，系統 SHALL 回 HTTP 400（`INVALID_PASSWORD`），MUST NOT 修改密碼。

#### Scenario: Agent changes password successfully
- **WHEN** 登入的成員以 `{ currentPassword, newPassword }` 修改密碼，`currentPassword` 正確
- **THEN** 系統回 HTTP 200，成員的密碼變成 `newPassword`

#### Scenario: Wrong current password
- **WHEN** 登入的成員修改密碼，`currentPassword` 不正確
- **THEN** 系統回 HTTP 400，`error.code` 是 `INVALID_PASSWORD`，密碼不變

#### Scenario: New password too short
- **WHEN** 登入的成員修改密碼，`newPassword` 少於 8 個字元
- **THEN** 系統回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，密碼不變

### Requirement: 建立成員

`POST /api/v1/agents` SHALL 在發出請求的成員所屬的租戶建立成員，要求 `agent.manage`。請求含姓名、email、密碼與角色，密碼至少 8 個字元。建立成功時，系統 SHALL 回 HTTP 201，回應 MUST NOT 含密碼的雜湊值。

email 在所有租戶之間唯一。email 已被任何租戶的成員使用時，包含停用的成員，系統 SHALL 回 HTTP 409（`CONFLICT`），MUST NOT 建立成員。

下列規則由其他主規格規定：

- 能指派哪些角色：`role-management` 的「指派角色給成員的越權防護」。
- 人數上限：`plan-limits-core` 的「客服人數建立時硬擋」。
- 新成員看得到哪些渠道：`channel-visibility-defaults` 的「New Member Sees Chosen Channels」。

#### Scenario: 建立成員成功
- **WHEN** 有 `agent.manage` 的成員以 `POST /api/v1/agents` 送出姓名、未使用的 email、8 個字元以上的密碼與角色
- **THEN** 系統回 HTTP 201，新成員屬於發出請求的成員所屬的租戶，回應不含 `passwordHash`

#### Scenario: 沒有 agent.manage 時被拒
- **WHEN** 沒有 `agent.manage` 的成員以 `POST /api/v1/agents` 建立成員
- **THEN** 系統回 HTTP 403，不建立成員

#### Scenario: email 已被其他租戶使用
- **WHEN** 租戶 B 已有 email 為 `a@example.test` 的成員，租戶 A 有 `agent.manage` 的成員以同一個 email 建立成員
- **THEN** 系統回 HTTP 409，`error.code` 是 `CONFLICT`，不建立成員

#### Scenario: 密碼太短
- **WHEN** 有 `agent.manage` 的成員建立成員，密碼少於 8 個字元
- **THEN** 系統回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不建立成員

### Requirement: 指派成員的角色

`PATCH /api/v1/agents/:id/role` SHALL 修改本租戶成員的角色，要求 `agent.role.assign`。請求以 `roleId` 指定角色。請求只帶角色列舉 `role`（`ADMIN`、`SUPERVISOR`、`AGENT`）時，系統 SHALL 指派同名的系統角色（`admin`、`supervisor`、`agent`）。成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。

越權防護與自我降級的限制見 `role-management` 的「指派角色給成員的越權防護」。

#### Scenario: 以 roleId 改成員的角色
- **WHEN** 有 `agent.role.assign` 的成員以 `roleId` 把另一位成員改成本租戶的角色 R，R 的權限不超出自己的權限
- **THEN** 系統回 HTTP 200，該成員的角色是 R

#### Scenario: 以角色列舉指定系統角色
- **WHEN** 有 `agent.role.assign` 的成員只送出 `{ role: "SUPERVISOR" }`
- **THEN** 系統回 HTTP 200，該成員的角色是租戶的 `supervisor` 系統角色

#### Scenario: 成員不存在
- **WHEN** 有 `agent.role.assign` 的成員修改不存在的成員 ID 的角色
- **THEN** 系統回 HTTP 404

#### Scenario: 沒有 agent.role.assign 時被拒
- **WHEN** 沒有 `agent.role.assign` 的成員修改另一位成員的角色
- **THEN** 系統回 HTTP 403，該成員的角色不變

### Requirement: 重設其他成員的密碼

`PATCH /api/v1/agents/:id/password` SHALL 重設本租戶成員的密碼，不需要原本的密碼，要求 `agent.password.reset`。新密碼至少 8 個字元。成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。目標的權限比操作者高時，系統 SHALL 回 HTTP 403（`TARGET_OUTRANKS_ACTOR`），見 `role-management` 的「對其他成員的操作不能用在權限比自己高的成員」。

#### Scenario: 重設後以新密碼登入
- **WHEN** 有 `agent.password.reset` 的成員以 `{ newPassword }` 重設另一位成員的密碼
- **THEN** 系統回 HTTP 200，該成員的密碼變成新密碼

#### Scenario: 沒有 agent.password.reset 時被拒
- **WHEN** 沒有 `agent.password.reset` 的成員重設另一位成員的密碼
- **THEN** 系統回 HTTP 403，該成員的密碼不變

#### Scenario: 重設其他租戶的成員回 404
- **WHEN** 租戶 A 有 `agent.password.reset` 的成員，重設租戶 B 的成員的密碼
- **THEN** 系統回 HTTP 404，該成員的密碼不變
