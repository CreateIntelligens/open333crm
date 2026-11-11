## ADDED Requirements

### Requirement: 平台延長試用

平台 superuser SHALL 能以 `PATCH /api/v1/platform/trial-tenants/:id/extend` 延長一個試用租戶，`days` 是正整數。新的 `trialEndsAt` SHALL 從原本的 `trialEndsAt` 與當下兩者中較晚的時間起算，加上 `days` 天。

延長時，系統 SHALL 在同一次更新中把 `isActive` 設為 true、清空 `trialRemindersSent`，並把 `purgedAt` 設為 null。`trialEndsAt` 是 null 的租戶，系統回 HTTP 400 `NOT_TRIAL`。

#### Scenario: 延長未到期的試用
- **WHEN** 平台延長一個 `trialEndsAt` 是 10 天後的試用租戶 7 天
- **THEN** 該租戶的 `trialEndsAt` 是原本的到期日加 7 天

#### Scenario: 延長已到期停用的試用
- **WHEN** 平台延長一個 `trialEndsAt` 是 10 天前、`isActive` 是 false、`trialRemindersSent` 不是空的試用租戶 7 天
- **THEN** 該租戶的 `trialEndsAt` 是延長當下加 7 天，`isActive` 是 true，`trialRemindersSent` 是空的

#### Scenario: 延長已清除的試用
- **WHEN** 平台延長一個 `purgedAt` 有值的試用租戶
- **THEN** 該租戶的 `purgedAt` 是 null，`isActive` 是 true

#### Scenario: 非試用租戶不能延長
- **WHEN** 平台延長一個 `trialEndsAt` 是 null 的租戶
- **THEN** 系統回 HTTP 400 `NOT_TRIAL`，租戶不變
