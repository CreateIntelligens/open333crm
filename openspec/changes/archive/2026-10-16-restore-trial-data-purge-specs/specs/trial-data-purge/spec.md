## ADDED Requirements

### Requirement: 保留期滿標記軟刪

試用生命週期排程每次執行時，SHALL 標記符合全部條件的租戶：`trialEndsAt` 不是 null、`isActive` 是 false、`purgedAt` 是 null，而且 `trialEndsAt` 之後已經過了 `trial.dataRetentionDays` 天。保留期 SHALL 從 `trialEndsAt` 起算，不從停用的時間起算。

標記時，系統 SHALL 把 `purgedAt` 設為當下的時間，並寫一筆 action 是 `tenant.trial.purge` 的平台稽核，`platformUserId` 是 null。系統 MUST NOT 刪除這個租戶的任何業務資料。

#### Scenario: 保留期滿的停用試用租戶被標記
- **WHEN** `trial.dataRetentionDays` 是 30，一個已停用的試用租戶 `trialEndsAt` 是 40 天前、`purgedAt` 是 null，排程執行
- **THEN** 該租戶的 `purgedAt` 是執行時的時間，有一筆 `tenant.trial.purge` 稽核，該租戶的聯絡人仍然存在

#### Scenario: 保留期未滿不標記
- **WHEN** `trial.dataRetentionDays` 是 30，一個已停用的試用租戶 `trialEndsAt` 是 10 天前，排程執行
- **THEN** 該租戶的 `purgedAt` 仍是 null

#### Scenario: 已標記的租戶不重複處理
- **WHEN** 一個已停用的試用租戶 `purgedAt` 已經有值，排程執行
- **THEN** 該租戶的 `purgedAt` 不變，也沒有新的 `tenant.trial.purge` 稽核

#### Scenario: 停用的非試用租戶不標記
- **WHEN** 一個已停用的租戶 `trialEndsAt` 是 null，排程執行
- **THEN** 該租戶的 `purgedAt` 仍是 null

### Requirement: 平台復原軟刪標記

平台 superuser SHALL 能以 `PATCH /api/v1/platform/tenants/:id/restore` 清除租戶的 `purgedAt`。復原 MUST NOT 改變 `isActive`。復原成功時，系統 SHALL 寫一筆 action 是 `tenant.trial.restore` 的平台稽核，`platformUserId` 是操作的平台人員。

租戶不存在時，系統回 HTTP 404 `NOT_FOUND`。`purgedAt` 是 null 時，系統回 HTTP 422 `NOT_PURGED`。

#### Scenario: 復原已標記的租戶
- **WHEN** 平台 superuser 復原一個 `purgedAt` 有值、`isActive` 是 false 的租戶
- **THEN** 該租戶的 `purgedAt` 是 null，`isActive` 仍是 false

#### Scenario: 復原寫入平台稽核
- **WHEN** 平台 superuser 復原成功
- **THEN** 有一筆 `tenant.trial.restore` 稽核，`targetId` 是該租戶，`platformUserId` 是操作的平台人員

#### Scenario: 未標記的租戶不能復原
- **WHEN** 平台 superuser 復原一個 `purgedAt` 是 null 的租戶
- **THEN** 系統回 HTTP 422 `NOT_PURGED`，租戶不變

### Requirement: 平台後台顯示軟刪狀態

試用租戶清單（`GET /api/v1/platform/trial-tenants`）SHALL 把 `purgedAt` 不是 null 的租戶的 `status` 設為 `purged`，不論其他欄位的值。`/admin/trial` 的試用租戶分頁 SHALL 把這些租戶顯示為「已清除」，操作欄只有「復原」，沒有「延長」與轉正式的選單。

#### Scenario: 已標記的租戶狀態是 purged
- **WHEN** 平台查詢試用租戶清單，其中一個租戶的 `purgedAt` 有值
- **THEN** 該租戶的 `status` 是 `purged`

#### Scenario: 已清除的租戶只能復原
- **WHEN** 平台人員開啟 `/admin/trial`，清單中有一個 `status` 是 `purged` 的租戶與一個 `status` 是 `disabled` 的租戶
- **THEN** 已清除的租戶顯示「已清除」與「復原」按鈕，沒有「延長」按鈕；停用的租戶顯示「延長」按鈕，沒有「復原」按鈕
