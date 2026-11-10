## ADDED Requirements

### Requirement: 平台後台以中文顯示申請狀態
平台後台試用管理的「申請記錄」SHALL 以中文顯示每筆申請的狀態：`pending_verification` 顯示「等待驗證」、`provisioned` 顯示「已開通」、`failed` 顯示「失敗／已作廢」。其他狀態 SHALL 顯示原值，不顯示空白。

#### Scenario: 三種狀態顯示中文
- **WHEN** 平台管理員打開申請記錄，有狀態是 `pending_verification`、`provisioned`、`failed` 的申請各一筆
- **THEN** 三列的狀態依序顯示「等待驗證」、「已開通」、「失敗／已作廢」，畫面上沒有英文狀態代碼

#### Scenario: 未知的狀態顯示原值
- **WHEN** 平台管理員打開申請記錄，有一筆申請的狀態是 `archived`
- **THEN** 這一列的狀態顯示 `archived`
