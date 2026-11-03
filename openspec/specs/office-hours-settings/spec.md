# office-hours-settings Specification

## Purpose
規定營業時間設定頁讀取正式設定失敗時，不得以預設值取代畫面內容讓使用者儲存，避免網路不穩時開頁再按儲存就把租戶原本的營業時間覆蓋掉；畫面要顯示原因並提供重新載入。

## Requirements

### Requirement: 營業時間讀取失敗時不可儲存

營業時間設定頁讀取 `GET /api/v1/settings/office-hours` 失敗時，前端 SHALL 顯示讀取失敗的訊息與「重新載入」按鈕，SHALL NOT 顯示可以儲存的預設值，也 SHALL NOT 送出 `PUT /api/v1/settings/office-hours`。重新載入成功後，頁面顯示已儲存的設定並恢復儲存。

#### Scenario: 讀取失敗時停用儲存
- **WHEN** 成員開啟營業時間設定頁，`GET /api/v1/settings/office-hours` 失敗
- **THEN** 頁面顯示讀取失敗的訊息與「重新載入」，沒有可按的「儲存設定」，前端不呼叫 `PUT /api/v1/settings/office-hours`

#### Scenario: 重新載入成功後可以儲存
- **WHEN** 讀取失敗後成員按「重新載入」，這次讀取成功
- **THEN** 頁面顯示讀到的設定，「儲存設定」可以按

### Requirement: 營業時間的輸入檢查

`PUT /api/v1/settings/office-hours` SHALL 依下列規則檢查輸入：

- 每天的時段是 `null`（休息），或是 `{ start, end }`。`start` 與 `end` 的格式是 `HH:mm`，範圍 00:00～23:59，`end` MUST 晚於 `start`。
- `holidays` 的每一筆是存在的日期，格式 `YYYY-MM-DD`，最多 366 筆。
- `timezone` 是有效的 IANA 時區。
- `outsideHoursMessage` 的長度是 1～1000 字。

輸入不合法時，系統 SHALL 回 400 `VALIDATION_ERROR`，`error.details.issues` 指出不合法的欄位，已存的設定 SHALL NOT 改變。

#### Scenario: 合法的邊界值可以儲存
- **WHEN** 有 `settings.manage` 的成員送出 `mon: { start: "00:00", end: "23:59" }`、假日 `2028-02-29`、時區 `America/New_York`、1000 字的訊息
- **THEN** 系統回 200，`GET /api/v1/settings/office-hours` 讀回相同的設定

#### Scenario: 結束時間不晚於開始時間
- **WHEN** 成員送出 `fri: { start: "22:00", end: "02:00" }`，或 `fri: { start: "10:00", end: "10:00" }`
- **THEN** 系統回 400 `VALIDATION_ERROR`，`issues` 指出 `officeHours.schedule.fri`，已存的設定不變

#### Scenario: 時間超出範圍
- **WHEN** 成員送出 `mon: { start: "99:99", end: "24:61" }`
- **THEN** 系統回 400 `VALIDATION_ERROR`，`issues` 指出 `officeHours.schedule.mon.start` 與 `officeHours.schedule.mon.end`

#### Scenario: 假日不是存在的日期
- **WHEN** 成員送出假日 `2026-02-30` 或 `abc`
- **THEN** 系統回 400 `VALIDATION_ERROR`，`issues` 指出 `officeHours.holidays` 的那一筆

#### Scenario: 假日超過 366 筆
- **WHEN** 成員送出 367 筆假日
- **THEN** 系統回 400 `VALIDATION_ERROR`，`issues` 指出 `officeHours.holidays`

#### Scenario: 時區不合法
- **WHEN** 成員送出時區 `Mars/Base`
- **THEN** 系統回 400 `VALIDATION_ERROR`，`issues` 指出 `timezone`，已存的設定不變

#### Scenario: 訊息是空白或超過 1000 字
- **WHEN** 成員送出空字串，或 1001 字的 `outsideHoursMessage`
- **THEN** 系統回 400 `VALIDATION_ERROR`，`issues` 指出 `officeHours.outsideHoursMessage`

### Requirement: 已存的營業時間不合法時當作沒有設定

讀取營業時間時，已存的 `officeHours` 或 `timezone` 不符合「營業時間的輸入檢查」的規則（例如 `{}`，或規則加上之前存入的不合法時區），系統 SHALL 當作租戶沒有設定營業時間：

- `GET /api/v1/settings/office-hours` 回傳預設值：時區 `Asia/Taipei`，`enabled` 是 `false`，週一到週五 09:00～18:00，週六與週日休息，沒有假日。
- 收到客人的訊息時，系統 SHALL NOT 送出非營業時間的自動回覆，也 SHALL NOT 記錄錯誤。

系統 SHALL NOT 在讀取時改寫已存的設定。成員下一次儲存時，新的設定取代舊的設定。

#### Scenario: 設定是空物件時回傳預設值
- **WHEN** 租戶的 `officeHours` 是 `{}`，有 `settings.manage` 的成員呼叫 `GET /api/v1/settings/office-hours`
- **THEN** 系統回 200，`officeHours.enabled` 是 `false`，`officeHours.schedule.mon` 是 `{ start: "09:00", end: "18:00" }`，`timezone` 是 `Asia/Taipei`，資料庫的 `officeHours` 仍然是 `{}`

#### Scenario: 已存的時區不合法時不自動回覆
- **WHEN** 租戶已存的設定是 `enabled: true`、每天都休息、時區 `Mars/Base`，客人傳來一則訊息
- **THEN** 系統不送非營業時間的自動回覆，也不記錄錯誤；`GET /api/v1/settings/office-hours` 回傳 `enabled: false`、時區 `Asia/Taipei`
