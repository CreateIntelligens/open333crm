## MODIFIED Requirements

### Requirement: 平台復原軟刪標記

平台 superuser SHALL 能以 `PATCH /api/v1/platform/tenants/:id/restore` 清除租戶的 `purgedAt`。復原 MUST NOT 改變 `isActive`。復原成功時，系統 SHALL 寫一筆 action 是 `tenant.trial.restore` 的平台稽核，`platformUserId` 是操作的平台人員。

租戶不存在時，系統回 HTTP 404 `NOT_FOUND`。`purgedAt` 是 null 時，系統回 HTTP 422 `NOT_PURGED`。

復原只移除標記，讓平台人員接著延長試用或轉正式。復原之後租戶仍停用，沒有延長也沒有轉正式時，下一輪排程 SHALL 依「保留期滿標記軟刪」再標記這個租戶。

#### Scenario: 復原已標記的租戶
- **WHEN** 平台 superuser 復原一個 `purgedAt` 有值、`isActive` 是 false 的租戶
- **THEN** 該租戶的 `purgedAt` 是 null，`isActive` 仍是 false

#### Scenario: 復原寫入平台稽核
- **WHEN** 平台 superuser 復原成功
- **THEN** 有一筆 `tenant.trial.restore` 稽核，`targetId` 是該租戶，`platformUserId` 是操作的平台人員

#### Scenario: 未標記的租戶不能復原
- **WHEN** 平台 superuser 復原一個 `purgedAt` 是 null 的租戶
- **THEN** 系統回 HTTP 422 `NOT_PURGED`，租戶不變

#### Scenario: 復原後沒有延長，下一輪排程再標記
- **WHEN** 一個保留期已滿的停用試用租戶被復原，之後沒有延長也沒有轉正式，排程執行
- **THEN** 該租戶的 `purgedAt` 又有值
