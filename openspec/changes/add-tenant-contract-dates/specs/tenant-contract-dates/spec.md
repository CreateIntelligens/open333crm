## ADDED Requirements

### Requirement: 租戶合約日期為純記錄欄位

`Tenant` MUST 具備 `contractStartDate` 與 `contractEndDate`（皆 `DateTime?`，nullable、無 default）。此兩欄位 MUST 為純記錄用途——MUST NOT 觸發任何自動生命週期行為（停用、降級、提醒、權限或計費變動），與 `trialEndsAt` 的到期自動停用明確區隔。既有租戶（欄位為 null）MUST NOT 受任何影響。

#### Scenario: 既有租戶不受新欄位影響

- **WHEN** migration 加入 `contractStartDate`／`contractEndDate` 後，既有租戶這兩欄位為 null
- **THEN** 該租戶的登入、權限、計費、trial 行為 MUST 與加欄位前完全一致

#### Scenario: 合約到期不觸發任何自動行為

- **WHEN** 某租戶的 `contractEndDate` 已早於現在時間
- **THEN** 系統 MUST NOT 因此停用租戶、發送提醒或改變其任何權限／方案；`contractEndDate` 僅供平台方查看

### Requirement: 平台 superuser 可設定與查看租戶合約日期

平台後台 MUST 提供受 `authenticatePlatformSuperuser` 保護的端點，讓平台 superuser 為指定租戶設定與查看 `contractStartDate`／`contractEndDate`。租戶列表／詳情回傳 MUST 包含此兩欄位。設定變更 MUST 寫入 `PlatformAuditLog`（比照其他平台變更操作）。租戶端（tenant 使用者）MUST NOT 能讀寫此兩欄位。

#### Scenario: 平台設定合約起訖日

- **GIVEN** 平台 superuser 已登入平台後台
- **WHEN** 對某租戶設定 `contractStartDate=2026-09-01`、`contractEndDate=2027-08-31`
- **THEN** 該租戶的兩欄位 MUST 被更新並持久化，且 MUST 寫一筆 PlatformAuditLog

#### Scenario: 合約日期出現在租戶列表

- **WHEN** 平台 superuser 開啟租戶管理頁
- **THEN** 每個租戶 MUST 顯示其 `contractStartDate`／`contractEndDate`（未設定者顯示為空／未設定）

#### Scenario: 租戶端無法存取合約日期

- **WHEN** 一般租戶使用者（tenant JWT）嘗試讀取或修改合約日期
- **THEN** 系統 MUST 拒絕（無對應租戶端端點，且平台端點只受 platform superuser 認證）

### Requirement: 合約日期驗證

`contractStartDate`／`contractEndDate` 皆 optional（可只設其一或皆不設，皆不設等同無合約記錄）。當兩者皆有值時，`contractEndDate` MUST 大於或等於 `contractStartDate`，否則 MUST 以驗證錯誤（HTTP 422）拒絕，MUST NOT 寫入。

#### Scenario: 迄日早於起日被拒絕

- **WHEN** 平台設定 `contractStartDate=2027-01-01`、`contractEndDate=2026-01-01`
- **THEN** 系統 MUST 回 422 驗證錯誤，兩欄位 MUST NOT 被更新

#### Scenario: 只設定其中一個日期

- **WHEN** 平台只設定 `contractStartDate`、留空 `contractEndDate`
- **THEN** 系統 MUST 接受並持久化（起日有值、迄日為 null）

### Requirement: 免費試用天數於平台後台可設定（確認性）

免費試用天數 MUST 由 `PlatformSetting` 的 `trial.durationDays` 承載，平台後台 MUST 提供設定介面，且 MUST NOT 寫死於程式碼；此機制與行為沿用既有 trial 生命週期規格，本能力僅確認其平台後台呈現完整、與合約日期集中於「租戶期間管理」呈現。變更 `trial.durationDays` MUST NOT 影響既有已開通租戶的 `trialEndsAt`。

#### Scenario: 平台後台可見並可改試用天數

- **WHEN** 平台 superuser 開啟試用政策／方案設定
- **THEN** MUST 能看到並修改 `trial.durationDays`；儲存後對「之後」新開通的試用租戶生效

#### Scenario: 改試用天數不影響既有租戶

- **WHEN** `trial.durationDays` 由 14 改為 30
- **THEN** 既有試用中租戶的 `trialEndsAt` MUST 不變；僅之後新開通者以 30 天計算
