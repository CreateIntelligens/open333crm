## ADDED Requirements

### Requirement: 匯出的 CSV 以 UTF-8 BOM 開頭

`POST /api/v1/analytics/export` 回傳的 CSV SHALL 以 UTF-8 BOM（`U+FEFF`）開頭，讓 Excel 以 UTF-8 開啟、中文不亂碼。報表頁 SHALL 只對有 `analytics.export` 的成員顯示「匯出 CSV」，匯出失敗時 SHALL 顯示錯誤訊息。

#### Scenario: CSV 以 BOM 開頭
- **WHEN** 有 `analytics.export` 的成員匯出工單報表
- **THEN** 回應內容的第一個字元是 `U+FEFF`，之後是標題列

#### Scenario: 沒有匯出權限時不顯示按鈕
- **WHEN** 成員有 `analytics.view` 但沒有 `analytics.export`，開啟報表頁
- **THEN** 頁面不顯示「匯出 CSV」

#### Scenario: 匯出失敗時顯示錯誤
- **WHEN** 成員按「匯出 CSV」，API 回 HTTP 500
- **THEN** 頁面顯示匯出失敗的訊息
