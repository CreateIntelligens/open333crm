## MODIFIED Requirements

### Requirement: 系統角色權限可以調整，但有安全鎖

有 `role.manage` 的成員 SHALL 能修改系統角色的權限，但有下列兩個例外：

- `admin` 系統角色 MUST 保留註冊表標記 `adminLock` 的權限碼，例如 `role.manage`。移除這些權限碼時，系統 SHALL 回 HTTP 422（`ADMIN_LOCK`）。
- 成員 MUST NOT 從自己目前的角色移除註冊表標記 `selfLock` 的權限碼，例如 `role.manage`。移除時，系統 SHALL 回 HTTP 422（`SELF_LOCK`）。

被拒絕時，角色的權限 MUST 不變。

租戶對系統角色權限的修改 SHALL 在權限註冊表更新之後保留。同步系統角色預設權限的流程 MUST NOT 重新授予租戶已經移除的權限碼，也 MUST NOT 移除租戶已經加上的權限碼。demo seed 的 Demo Tenant 是例外，見「demo seed 讓 Demo Tenant 與預設權限同步」。

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

## ADDED Requirements

### Requirement: demo seed 讓 Demo Tenant 與預設權限同步

demo seed（`packages/database/prisma/seed.ts`）每次執行時 SHALL 先刪除 Demo Tenant 三個系統角色的權限碼，再寫入 `DEFAULT_ROLE_PERMISSIONS` 中該角色的權限碼。demo seed 與平台開通 SHALL 讀同一份 `DEFAULT_ROLE_PERMISSIONS`，MUST NOT 另外維護一份預設權限。對 Demo Tenant 系統角色的修改不保留。

#### Scenario: demo seed 讓 Demo Tenant 的系統角色與預設權限相同
- **WHEN** Demo Tenant 的 `admin` 系統角色少了預設權限中的 `audit.view`，`supervisor` 多了預設沒有的 `channel.view_all`；之後 demo seed 執行
- **THEN** 三個系統角色的權限碼都等於 `DEFAULT_ROLE_PERMISSIONS` 中該角色的權限碼，`admin` 有 `audit.view`，`supervisor` 沒有 `channel.view_all`
