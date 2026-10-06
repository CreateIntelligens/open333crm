# role-management Specification

## Purpose
定義租戶內角色的管理：系統角色與自訂角色、管理角色需要的權限碼、租戶隔離、安全鎖，以及設定角色權限與指派角色給成員時的越權防護。

## Requirements

### Requirement: 系統角色與自訂角色

每個租戶 SHALL 有三個系統角色，`slug` 分別是 `admin`、`supervisor` 與 `agent`，`isSystem` 是 `true`。開通租戶時建立系統角色，見 `tenant-provisioning`。系統角色 MUST NOT 被刪除；刪除系統角色時，系統 SHALL 回 HTTP 403。系統角色的名稱可以修改，`slug` MUST NOT 改變。

有 `role.manage` 的成員 SHALL 能建立、改名與刪除自訂角色。

#### Scenario: 系統角色不能刪除
- **WHEN** 有 `role.manage` 的成員以 `DELETE /api/v1/roles/:id` 刪除系統角色
- **THEN** 系統回 HTTP 403，角色仍然存在

#### Scenario: 系統角色改名不改 slug
- **WHEN** 有 `role.manage` 的成員以 `PATCH /api/v1/roles/:id` 修改 `supervisor` 系統角色的名稱
- **THEN** 系統回 HTTP 200，角色的名稱改變，`slug` 仍是 `supervisor`

### Requirement: 自訂角色建立時沒有權限

建立自訂角色 SHALL 只需要名稱，不需要選擇作為基礎的角色。新角色的 `isSystem` 是 `false`，沒有任何權限碼；成員之後再逐一授予權限。名稱去除前後空白後與租戶內其他角色相同時，系統 SHALL 回 HTTP 422（`DUPLICATE`），MUST NOT 建立角色。

#### Scenario: 只給名稱即可建立
- **WHEN** 有 `role.manage` 的成員以 `POST /api/v1/roles` 送出 `{ name: "行銷專員" }`
- **THEN** 系統回 HTTP 201，新角色的 `isSystem` 是 `false`，`GET /api/v1/roles/:id/permissions` 回傳空清單

#### Scenario: 同名的角色被拒
- **WHEN** 租戶已有名稱為「行銷專員」的角色，有 `role.manage` 的成員以同一個名稱建立角色
- **THEN** 系統回 HTTP 422，`error.code` 是 `DUPLICATE`，不建立角色

### Requirement: 角色管理需要 role.manage

查詢角色、角色的權限與權限矩陣 SHALL 要求 `role.view`。建立、改名、刪除角色與設定角色權限 SHALL 要求 `role.manage`。

#### Scenario: 沒有 role.manage 不能設定權限
- **WHEN** 成員有 `role.view`、沒有 `role.manage`，以 `PUT /api/v1/roles/:id/permissions` 設定角色權限
- **THEN** 系統回 HTTP 403，角色的權限不變

#### Scenario: 只有 role.view 也能查詢角色
- **WHEN** 成員有 `role.view`、沒有 `role.manage`，呼叫 `GET /api/v1/roles`
- **THEN** 系統回 HTTP 200，回傳租戶的角色

### Requirement: 角色的租戶隔離

角色與角色權限的所有操作 SHALL 只作用在發出請求的成員所屬的租戶。租戶 ID SHALL 取自登入憑證，MUST NOT 取自請求主體或查詢參數。系統讀寫角色的權限之前，SHALL 先確認角色屬於這個租戶。角色屬於其他租戶時，系統 SHALL 回 HTTP 404，與角色不存在時相同，MUST NOT 讀取或修改該角色的權限。

刪除角色時，系統 SHALL 一併刪除它的權限資料列。

#### Scenario: 設定其他租戶的角色權限回 404
- **WHEN** 租戶 A 有 `role.manage` 的成員，設定租戶 B 的角色 R 的權限
- **THEN** 系統回 HTTP 404，R 的權限不變

#### Scenario: 查詢其他租戶的角色權限回 404
- **WHEN** 租戶 A 有 `role.view` 的成員，以 `GET /api/v1/roles/:id/permissions` 查詢租戶 B 的角色 R
- **THEN** 系統回 HTTP 404，不回傳 R 的權限

#### Scenario: 請求主體的租戶 ID 不生效
- **WHEN** 租戶 A 的成員以 `POST /api/v1/roles` 建立角色，請求主體含租戶 B 的 `tenantId`
- **THEN** 新角色屬於租戶 A

#### Scenario: 刪除角色時一併刪除權限資料列
- **WHEN** 有 `role.manage` 的成員刪除一個有權限碼、沒有成員使用的自訂角色
- **THEN** 該角色的權限資料列都被刪除

### Requirement: 系統角色權限可以調整，但有安全鎖

有 `role.manage` 的成員 SHALL 能修改系統角色的權限，但有下列兩個例外：

- `admin` 系統角色 MUST 保留註冊表標記 `adminLock` 的權限碼，例如 `role.manage`。移除這些權限碼時，系統 SHALL 回 HTTP 422（`ADMIN_LOCK`）。
- 成員 MUST NOT 從自己目前的角色移除註冊表標記 `selfLock` 的權限碼，例如 `role.manage`。移除時，系統 SHALL 回 HTTP 422（`SELF_LOCK`）。

被拒絕時，角色的權限 MUST 不變。

租戶對系統角色權限的修改 SHALL 在權限註冊表更新之後保留。同步系統角色預設權限的流程 MUST NOT 重新授予租戶已經移除的權限碼，也 MUST NOT 移除租戶已經加上的權限碼。

#### Scenario: 可以減少 supervisor 的權限
- **WHEN** `supervisor` 系統角色有 `marketing.broadcast`，有 `role.manage` 的成員移除 `marketing.broadcast`
- **THEN** 系統接受這次設定，`supervisor` 不再有 `marketing.broadcast`

#### Scenario: admin 的鎖定權限不能移除
- **WHEN** 有 `role.manage` 的成員從 `admin` 系統角色移除 `role.manage`
- **THEN** 系統回 HTTP 422，`error.code` 是 `ADMIN_LOCK`，`admin` 的權限不變

#### Scenario: 不能從自己的角色移除 role.manage
- **WHEN** 成員的角色是自訂角色 R，R 有 `role.manage`；成員從 R 移除 `role.manage`
- **THEN** 系統回 HTTP 422，`error.code` 是 `SELF_LOCK`，R 的權限不變

#### Scenario: 權限註冊表更新後，租戶對系統角色的修改仍然保留
- **WHEN** 租戶已經從 `supervisor` 移除 `marketing.broadcast`，並加上預設沒有的 `channel.view_all`；之後部署更新了權限註冊表，並同步系統角色的預設權限
- **THEN** `supervisor` 仍然沒有 `marketing.broadcast`，仍然有 `channel.view_all`

### Requirement: 設定角色權限的越權防護

編輯者的角色不是租戶的 `admin` 系統角色時，設定後的權限清單 MUST 不超出編輯者角色的權限集合。這個權限集合含 `implies` 的閉包，不套用方案天花板。清單含編輯者沒有的權限碼時，系統 SHALL 回 HTTP 403（`PRIVILEGE_ESCALATION`），MUST NOT 修改角色的權限。

#### Scenario: 授予自己沒有的權限碼被拒
- **WHEN** 編輯者的角色是自訂角色，有 `role.manage`、沒有 `channel.delete`；編輯者設定另一個角色的權限，清單含 `channel.delete`
- **THEN** 系統回 HTTP 403，`error.code` 是 `PRIVILEGE_ESCALATION`，該角色的權限不變

#### Scenario: admin 角色的編輯者不受限
- **WHEN** 編輯者的角色是租戶的 `admin` 系統角色，這個 `admin` 角色已經被移除 `channel.delete`；編輯者設定另一個角色的權限，清單含 `channel.delete`
- **THEN** 系統接受這次設定

### Requirement: 指派角色給成員的越權防護

以 `POST /api/v1/agents` 建立成員，或以 `PATCH /api/v1/agents/:id/role` 修改成員的角色時，系統 SHALL 檢查下列條件：

1. 目標角色屬於其他租戶時，系統 SHALL 回 HTTP 404。
2. 指派者的角色不是租戶的 `admin` 系統角色時，目標角色的權限集合 MUST 不超出指派者角色的權限集合。兩者都含 `implies` 的閉包。超出時，系統 SHALL 回 HTTP 403（`ROLE_ESCALATION`），`error.details.escalatedPermissions` 是超出的權限碼。
3. 成員把自己改成另一個角色時，新角色 MUST 含至少一個標記 `selfLock` 的權限碼。不含時，系統 SHALL 回 HTTP 422（`SELF_LOCK`）。

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

### Requirement: 刪除使用中的角色

自訂角色仍有成員使用時，系統 SHALL 拒絕刪除，回 HTTP 409（`ROLE_IN_USE`），`error.details.blockingAgentCount` 是使用這個角色的成員人數。成員都改用其他角色之後，系統 SHALL 允許刪除。

#### Scenario: 有成員使用的角色不能刪除
- **WHEN** 自訂角色有 2 位成員使用，有 `role.manage` 的成員刪除這個角色
- **THEN** 系統回 HTTP 409，`error.code` 是 `ROLE_IN_USE`，`error.details.blockingAgentCount` 是 2，角色仍然存在

#### Scenario: 沒有成員使用的角色可以刪除
- **WHEN** 自訂角色沒有成員使用，有 `role.manage` 的成員刪除這個角色
- **THEN** 系統回 HTTP 200，角色不再存在

### Requirement: 角色列表與權限矩陣

`GET /api/v1/roles` SHALL 回傳租戶的所有角色，每個角色含 `isSystem`、權限碼數量與成員人數。系統角色排在自訂角色之前。

`GET /api/v1/roles/matrix` SHALL 回傳權限註冊表的所有權限點，依 `group` 分組。每個權限點含 `code`、`label`、`description`、`dependsOn`、`implies` 與 `adminLock`。

#### Scenario: 角色列表標示系統角色
- **WHEN** 租戶有三個系統角色與一個自訂角色，有 `role.view` 的成員呼叫 `GET /api/v1/roles`
- **THEN** 回傳的前三個角色的 `isSystem` 是 `true`，自訂角色的 `isSystem` 是 `false`

#### Scenario: 權限矩陣涵蓋註冊表的每個權限點
- **WHEN** 有 `role.view` 的成員呼叫 `GET /api/v1/roles/matrix`
- **THEN** 註冊表的每個權限碼在回應中恰好出現一次，位於它的 `group` 之下，並帶有 `dependsOn`、`implies` 與 `adminLock`

