# tenant-contract-dates Specification

## Purpose
平台人員為每個租戶記錄合約的起訖日，供續約與對帳時查看。合約日期用於到期提醒：到期前依設定的天數寄信給平台帳號，並在租戶列表標示到期狀態；合約到期不會自動停用租戶、清除資料或改變方案。試用到期的行為見 `trial-lifecycle`。

## Requirements

### Requirement: 合約到期不自動停用租戶
`Tenant` SHALL 有 `contractStartDate` 與 `contractEndDate` 兩個欄位，兩者都可以是 null。系統 SHALL NOT 因為合約日期停用租戶、清除資料，或改變租戶的方案與權限。合約日期唯一的自動行為是到期前寄提醒信給平台帳號（見「合約到期前提醒平台帳號」），這一點和試用到期（`trialEndsAt`）不同。

#### Scenario: 合約到期不觸發任何自動行為
- **WHEN** 付費租戶與試用中的租戶，`contractEndDate` 都早於現在，試用排程與合約提醒排程各執行一次
- **THEN** 兩個租戶仍是啟用狀態，`purgedAt` 仍是 null，排程不為這兩個租戶寫任何稽核，也不寄提醒信

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

### Requirement: 合約到期前提醒平台帳號
系統 SHALL 每小時檢查一次啟用中、有合約迄日的租戶。剩餘天數是迄日的日期減台灣時區今天的日期。提醒檔位是平台設定 `contract.reminderDaysBefore`（正整數陣列），沒有設定或不合法時用 `[30, 7, 1]`。剩餘天數不小於 0 時，系統 SHALL 找出大於或等於剩餘天數的檔位中最小的一個。這個檔位還沒寄過時，系統 SHALL 寄一封提醒信給每一個 `isActive=true` 的平台帳號，並把這個檔位與比它大的檔位都記為已寄。停用的租戶與已過期的合約不寄。

#### Scenario: 到達檔位時寄給所有啟用中的平台帳號
- **WHEN** 租戶啟用中，合約迄日是 7 天後，檔位是預設值，有兩個啟用中與一個停用的平台帳號，排程執行
- **THEN** 兩個啟用中的平台帳號各收到一封提醒信，信中有租戶名稱、迄日與剩餘 7 天；停用的平台帳號沒有收到

#### Scenario: 同一檔位只寄一次
- **WHEN** 上一個情境之後排程再執行一次
- **THEN** 沒有寄出任何信

#### Scenario: 跳過的檔位不補寄
- **WHEN** 合約迄日是 5 天後，還沒寄過任何檔位，排程連續執行兩次
- **THEN** 只寄出一輪提醒（7 天檔），30 天檔與 7 天檔都記為已寄

#### Scenario: 未到檔位、已過期或停用不寄
- **WHEN** 三個租戶：迄日 40 天後、迄日昨天、迄日 7 天後但已停用，排程執行
- **THEN** 沒有寄出任何信，三個租戶的已寄檔位都不變

#### Scenario: 檔位依平台設定
- **WHEN** 平台設定 `contract.reminderDaysBefore=[14]`，合約迄日是 10 天後，排程執行
- **THEN** 寄出一輪提醒，已寄檔位是 `[14]`

### Requirement: 修改合約迄日後重新計算提醒
平台人員以 `PATCH /api/v1/platform/tenants/:id/contract` 送出與現值不同的 `contractEndDate`（包含清除成 null）時，系統 SHALL 清空該租戶已寄的提醒檔位，之後依新的迄日重新提醒。只改起日或送出相同的迄日時，已寄檔位 SHALL 不變。

#### Scenario: 延長迄日後重新提醒
- **WHEN** 租戶已寄過 30 天與 7 天檔，平台人員把迄日改成另一個日期
- **THEN** 系統回 HTTP 200，已寄檔位變成空陣列

#### Scenario: 只改起日不重寄
- **WHEN** 租戶已寄過 30 天檔，平台人員只送出 `contractStartDate`
- **THEN** 系統回 HTTP 200，已寄檔位仍是 `[30]`

### Requirement: 平台租戶列表標示合約到期狀態
`/admin/tenants` 列表 SHALL 依合約迄日標示狀態：剩餘天數小於 0 顯示「已過期」，0 到 30 天顯示「30 天內到期」，其他或沒有迄日不顯示標籤。標籤是文字加顏色，不用 emoji 或勾號。列表 SHALL 可以依合約迄日排序，沒有迄日的租戶排在最後。

#### Scenario: 列表標示已過期與 30 天內到期
- **WHEN** 列表有三個租戶：迄日昨天、迄日 10 天後、迄日 90 天後
- **THEN** 第一個顯示「已過期」，第二個顯示「30 天內到期」，第三個沒有標籤

#### Scenario: 依合約迄日排序
- **WHEN** 平台人員按下「合約期間」欄的排序
- **THEN** 租戶依迄日由近到遠排列，沒有迄日的排在最後；再按一次改成由遠到近，沒有迄日的仍在最後

### Requirement: 平台人員修改合約到期提醒天數
平台人員 SHALL 以 `PUT /api/v1/platform/settings/contract.reminderDaysBefore` 修改提醒檔位。系統 SHALL 只接受 1 到 365 的整數組成的非空陣列。合法時，系統去除重複、由大到小排序後存入，回傳存入的值，並寫一筆 `setting.update` 稽核。不合法時，系統 SHALL 回 HTTP 400 `VALIDATION_ERROR` 並說明原因，不修改設定，也不改存預設值。其他設定鍵的行為不變。

#### Scenario: 儲存合法的提醒天數
- **WHEN** 平台人員送出 `value=[7, 30, 7]`
- **THEN** 系統回 HTTP 200，回傳與存入的值都是 `[30, 7]`，並寫一筆 `setting.update` 稽核

#### Scenario: 不合法的提醒天數被拒絕
- **WHEN** 目前設定是 `[30, 7]`，平台人員送出 `[]`、`[0]`、`[-1]`、`[1.5]`、`[400]`、`["7"]`、`"30,7"` 或 `null`
- **THEN** 每一次系統都回 HTTP 400 `VALIDATION_ERROR`，設定仍是 `[30, 7]`

### Requirement: 租戶管理頁編輯合約到期提醒天數
`/admin/tenants` SHALL 有「合約到期提醒」設定卡，以逗號分隔顯示目前的提醒天數（沒有設定時顯示預設的 `30, 7, 1`）。修改後，平台人員 SHALL 按「儲存」才送出，輸入時與離開欄位時都不送出。送出前，畫面 SHALL 檢查輸入：空值或含非正整數時顯示原因、不送出；合法時去除重複、由大到小排序後送出。儲存成功與失敗都 SHALL 在畫面上顯示訊息，訊息不含 emoji 或勾號。

#### Scenario: 按儲存才送出提醒天數
- **WHEN** 目前設定是 `[30, 7, 1]`，平台人員把欄位改成 `7, 30, 7`，離開欄位，再按「儲存」
- **THEN** 離開欄位時沒有送出；按下「儲存」後送出 `[30, 7]`，畫面顯示儲存成功與新的天數

#### Scenario: 畫面擋下不合法的提醒天數
- **WHEN** 平台人員輸入空白或 `7, abc` 或 `0` 後按「儲存」
- **THEN** 沒有送出，畫面顯示不合法的原因

#### Scenario: 儲存失敗顯示訊息
- **WHEN** 平台人員按「儲存」，API 回錯誤
- **THEN** 畫面顯示失敗訊息，欄位保留平台人員輸入的值
