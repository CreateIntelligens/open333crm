## ADDED Requirements

### Requirement: 租戶合約日期只是紀錄
`Tenant` SHALL 有 `contractStartDate` 與 `contractEndDate` 兩個欄位，兩者都可以是 null。這兩個欄位只供平台人員查看。系統 SHALL NOT 因為合約日期停用租戶、清除資料、寄送提醒，或改變租戶的方案與權限。合約到期不觸發任何自動行為，這一點和試用到期（`trialEndsAt`）不同。

#### Scenario: 合約到期不觸發任何自動行為
- **WHEN** 付費租戶與試用中的租戶，`contractEndDate` 都早於現在，試用排程執行一次
- **THEN** 兩個租戶仍是啟用狀態，`purgedAt` 仍是 null，排程不為這兩個租戶寫任何稽核

### Requirement: 平台人員設定與查看租戶合約日期
平台人員 SHALL 以 `PATCH /api/v1/platform/tenants/:id/contract` 設定合約日期。每個日期欄位的處理方式：

- 送出日期：設定該欄位。
- 送出 null：清除該欄位。
- 沒有送出：不改變該欄位。

修改成功後，系統 SHALL 寫一筆平台稽核 `tenant.contract.update`，記錄修改後的兩個日期。平台的租戶列表與租戶詳細資料 SHALL 回傳兩個日期，沒有設定時回 null。

系統 SHALL NOT 提供租戶端讀寫合約日期的 API。這個端點和其他平台路由相同，只接受平台帳號的 token。

#### Scenario: 平台設定合約起訖日
- **WHEN** 平台人員對租戶送出 `contractStartDate=2026-09-01`、`contractEndDate=2027-08-31`
- **THEN** 系統回 HTTP 200，資料庫存入兩個日期，並寫一筆 `tenant.contract.update` 稽核，`platformUserId` 是這位平台人員

#### Scenario: 合約日期出現在租戶列表與租戶詳細資料
- **WHEN** 平台人員查詢租戶列表與某個租戶的詳細資料
- **THEN** 每個租戶都有 `contractStartDate` 與 `contractEndDate`，沒有設定的租戶兩者都是 null

#### Scenario: 只設定其中一個日期
- **WHEN** 平台人員只送出 `contractStartDate=2026-09-01`
- **THEN** 系統回 HTTP 200，起日存入 2026-09-01，迄日仍是 null

#### Scenario: 送 null 清除日期，沒送的日期不變
- **WHEN** 租戶的合約是 2026-09-01 到 2027-08-31，平台人員只送出 `contractEndDate=null`
- **THEN** 系統回 HTTP 200，迄日變成 null，起日仍是 2026-09-01

### Requirement: 合約迄日不得早於起日
檢查之前，系統 SHALL 用資料庫的現值補上沒有送出的日期。補上之後兩個日期都有值，而且迄日早於起日時，系統 SHALL 回 HTTP 422 `CONTRACT_DATE_INVALID`，不修改任何欄位，也不寫稽核。

#### Scenario: 迄日早於起日被拒絕
- **WHEN** 平台人員送出 `contractStartDate=2027-01-01`、`contractEndDate=2026-01-01`
- **THEN** 系統回 HTTP 422 `CONTRACT_DATE_INVALID`，兩個日期都不變，也沒有稽核

#### Scenario: 只送一個日期時，與另一個日期的現值比較
- **WHEN** 租戶的合約是 2026-09-01 到 2027-08-31，平台人員只送出 `contractEndDate=2026-01-01`
- **THEN** 系統回 HTTP 422 `CONTRACT_DATE_INVALID`，迄日仍是 2027-08-31
