# analytics-reports Specification

## Purpose
規定租戶後台分析報表 API（總覽、訊息趨勢、工單、客服、渠道與匯出）共用的查詢規則，例如日期區間必須先後正確，讓報表不會因為參數錯誤而回傳看似正常、其實全是 0 的空資料，使用者誤以為期間內沒有任何活動。

## Requirements

### Requirement: Analytics Date Range Must Be Ordered
Every analytics endpoint that accepts `from` and `to` SHALL respond 400 naming the `from` field when `from` is later than `to`.

#### Scenario: Reversed date range
- **WHEN** a user requests `GET /api/v1/analytics/overview?from=2026-12-31&to=2020-01-01`
- **THEN** the system SHALL respond 400 and `error.details.issues` SHALL contain the path `from`

#### Scenario: Same day
- **WHEN** a user requests the overview with `from` and `to` on the same instant
- **THEN** the system SHALL return the report

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
