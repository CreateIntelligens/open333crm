## MODIFIED Requirements

### Requirement: 指派角色給成員的越權防護

以 `POST /api/v1/agents` 建立成員，或以 `PATCH /api/v1/agents/:id/role` 修改成員的角色時，系統 SHALL 檢查下列條件：

1. 目標角色屬於其他租戶時，系統 SHALL 回 HTTP 404。
2. 指派者的角色不是租戶的 `admin` 系統角色時，目標角色的權限集合 MUST 不超出指派者角色的權限集合。兩者都含 `implies` 的閉包。超出時，系統 SHALL 回 HTTP 403（`ROLE_ESCALATION`），`error.details.escalatedPermissions` 是超出的權限碼。
3. 成員把自己改成另一個角色時，新角色 MUST 含至少一個標記 `selfLock` 的權限碼。不含時，系統 SHALL 回 HTTP 422（`SELF_LOCK`）。
4. 修改角色時，成員目前的權限也 MUST 不高於指派者，見「對其他成員的操作不能用在權限比自己高的成員」。

被拒絕時，成員的角色 MUST 不變，也 MUST NOT 建立成員。

#### Scenario: 指派權限比自己多的角色被拒
- **WHEN** 指派者的角色是自訂角色，有 `agent.role.assign`、沒有 `channel.delete`；指派者把另一位成員改成含 `channel.delete` 的角色
- **THEN** 系統回 HTTP 403，`error.code` 是 `ROLE_ESCALATION`，`error.details.escalatedPermissions` 含 `channel.delete`，該成員的角色不變

#### Scenario: 不能把自己改成沒有 role.manage 的角色
- **WHEN** 成員把自己的角色改成不含任何 `selfLock` 權限碼的角色
- **THEN** 系統回 HTTP 422，`error.code` 是 `SELF_LOCK`，成員的角色不變

#### Scenario: 指派其他租戶的角色回 404
- **WHEN** 租戶 A 的指派者把成員的角色改成租戶 B 的角色
- **THEN** 系統回 HTTP 404，成員的角色不變

## ADDED Requirements

### Requirement: 對其他成員的操作不能用在權限比自己高的成員

操作者修改另一位成員的角色（`PATCH /api/v1/agents/:id/role`）、重設他的密碼（`PATCH /api/v1/agents/:id/password`）、停用（`POST /api/v1/agents/:id/deactivate`）或永久刪除（`DELETE /api/v1/agents/:id`）時，操作者的角色不是租戶的 `admin` 系統角色，而且目標成員目前角色的權限集合含操作者角色沒有的權限碼，系統 SHALL 回 HTTP 403（`TARGET_OUTRANKS_ACTOR`），`error.details.exceededPermissions` 是目標多出的權限碼。兩者都含 `implies` 的閉包，不套方案天花板。被拒絕時，目標成員 MUST 不變。

這個檢查在權限碼檢查（`requirePermission`）與最後一位管理員保護之後執行。

#### Scenario: 主管不能降級管理員
- **WHEN** 租戶有兩位啟用中的 `admin` 系統角色成員，`supervisor` 系統角色的成員把其中一位改成 `{ role: "SUPERVISOR" }`
- **THEN** 系統回 HTTP 403，`error.code` 是 `TARGET_OUTRANKS_ACTOR`，`error.details.exceededPermissions` 含 `role.manage`，該管理員的角色不變

#### Scenario: 管理員可以降級另一位管理員
- **WHEN** 租戶有兩位啟用中的 `admin` 系統角色成員，其中一位把另一位改成 `{ role: "SUPERVISOR" }`
- **THEN** 系統回 HTTP 200，被改的成員的角色是 `supervisor` 系統角色

#### Scenario: 不能重設權限比自己高的成員的密碼
- **WHEN** 自訂角色有 `agent.password.reset`、沒有 `role.manage`；這個角色的成員重設 `admin` 系統角色成員的密碼
- **THEN** 系統回 HTTP 403，`error.code` 是 `TARGET_OUTRANKS_ACTOR`，管理員的密碼不變

#### Scenario: 不能停用權限比自己高的成員
- **WHEN** 租戶有兩位啟用中的 `admin` 系統角色成員，自訂角色有 `agent.deactivate`、沒有 `role.manage`；這個角色的成員停用其中一位管理員
- **THEN** 系統回 HTTP 403，`error.code` 是 `TARGET_OUTRANKS_ACTOR`，該管理員維持啟用

#### Scenario: 不能刪除權限比自己高的成員
- **WHEN** 租戶有兩位啟用中的 `admin` 系統角色成員，自訂角色有 `agent.purge`、沒有 `role.manage`；這個角色的成員刪除其中一位管理員
- **THEN** 系統回 HTTP 403，`error.code` 是 `TARGET_OUTRANKS_ACTOR`，該管理員仍然存在
