## MODIFIED Requirements

### Requirement: 刪除使用中的角色

自訂角色仍有成員使用時，系統 SHALL 拒絕刪除，回 HTTP 409（`ROLE_IN_USE`），`error.details.blockingAgentCount` 是使用這個角色的成員人數。停用的成員也算使用中。`error.details.blockingAgents` SHALL 列出這些成員的 `id`、`name` 與 `isActive`，錯誤訊息 SHALL 列出成員姓名，停用的成員標示「已停用」。成員都改用其他角色之後，系統 SHALL 允許刪除。

#### Scenario: 有成員使用的角色不能刪除
- **WHEN** 自訂角色有 2 位成員使用，有 `role.manage` 的成員刪除這個角色
- **THEN** 系統回 HTTP 409，`error.code` 是 `ROLE_IN_USE`，`error.details.blockingAgentCount` 是 2，角色仍然存在

#### Scenario: 沒有成員使用的角色可以刪除
- **WHEN** 自訂角色沒有成員使用，有 `role.manage` 的成員刪除這個角色
- **THEN** 系統回 HTTP 200，角色不再存在

#### Scenario: 停用的成員佔用角色時列出姓名
- **WHEN** 自訂角色只有一位停用的成員「王小明」使用，有 `role.manage` 的成員刪除這個角色
- **THEN** 系統回 HTTP 409，`error.details.blockingAgents` 含 `{ name: "王小明", isActive: false }`，錯誤訊息含「王小明（已停用）」
