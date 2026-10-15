## ADDED Requirements

### Requirement: 營業時間讀取失敗時不可儲存

營業時間設定頁讀取 `GET /api/v1/settings/office-hours` 失敗時，前端 SHALL 顯示讀取失敗的訊息與「重新載入」按鈕，SHALL NOT 顯示可以儲存的預設值，也 SHALL NOT 送出 `PUT /api/v1/settings/office-hours`。重新載入成功後，頁面顯示已儲存的設定並恢復儲存。

#### Scenario: 讀取失敗時停用儲存
- **WHEN** 成員開啟營業時間設定頁，`GET /api/v1/settings/office-hours` 失敗
- **THEN** 頁面顯示讀取失敗的訊息與「重新載入」，沒有可按的「儲存設定」，前端不呼叫 `PUT /api/v1/settings/office-hours`

#### Scenario: 重新載入成功後可以儲存
- **WHEN** 讀取失敗後成員按「重新載入」，這次讀取成功
- **THEN** 頁面顯示讀到的設定，「儲存設定」可以按
