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

### Requirement: 已解決數以工單的解決時間判斷

總覽的已解決數 SHALL 只計算 `resolvedAt` 在查詢區間內的工單。因為狀態轉換依 `case-management` 的規則維護 `resolvedAt`，直接關閉的工單與解決後重開的工單 SHALL NOT 算入已解決數；從已解決轉成已關閉的工單 SHALL 算入。

#### Scenario: 直接關閉與重開的工單不算已解決

- **WHEN** 區間內同一個渠道有五張工單：直接關閉、解決、解決後改回處理中、解決後關閉、解決後關閉再重開，成員查詢只含這個渠道的總覽
- **THEN** 總覽的 `resolvedCases` 為 2

### Requirement: 匯出的 CSV 欄位經過跳脫與公式防護

`POST /api/v1/analytics/export` 的四種報表（overview、cases、agents、channels）SHALL 讓標題列與每個欄位經過同一套規則：含逗號、雙引號、CR 或 LF 的欄位以雙引號包住，內部的 `"` 改成 `""`；以 `=`、`+`、`-`、`@`、Tab、CR 開頭的文字前面加 `'`，Excel 當成文字而不是公式。數字欄位（計數、平均分鐘、CSAT、百分比）SHALL 照原樣輸出，負數也不加 `'`。

#### Scenario: 聯絡人名稱含逗號與公式時工單 CSV 欄數正確
- **WHEN** 成員匯出工單報表，其中一張工單的聯絡人名稱是 `=HYPERLINK("http://evil.example","hc-analytics, 點我")`
- **THEN** 該資料列與標題列都是 10 欄，聯絡人欄的值是 `'` 加上原名稱

#### Scenario: 標題、分類、客服姓名以公式字元開頭或含換行時加以跳脫
- **WHEN** 工單標題是 `=1+1 退貨, 急件`、分類是 `+分類`、另一張工單標題含換行
- **THEN** 標題欄是 `'=1+1 退貨, 急件`、分類欄是 `'+分類`，含換行的標題以雙引號包住，每列仍是 10 欄

#### Scenario: 客服 CSV 的數字欄位不加單引號
- **WHEN** 成員匯出客服報表，某位客服姓名是 `@陳, 大文`，平均首次回應是 -1.5 分鐘
- **THEN** 姓名欄是 `'@陳, 大文`，平均首次回應欄是 `-1.5`，每列 9 欄

#### Scenario: 渠道 CSV 的渠道名稱經過跳脫
- **WHEN** 成員匯出渠道報表，渠道名稱含逗號
- **THEN** 渠道欄以雙引號包住，訊息數與對話數照原樣輸出，每列 3 欄

#### Scenario: 概覽 CSV 的負數不加單引號
- **WHEN** 成員匯出概覽報表，平均首次回應是 -2
- **THEN** 標題列與資料列欄數相同，平均首次回應欄是 `-2`

### Requirement: 滿意度分數只算客人自評
報表的 CSAT 平均分數與好評率 SHALL 只計算客人自評的工單（`csatRatedBy` 不是 `agent`；沒有來源的舊資料視為客人自評）。總覽（`GET /analytics/overview`，含 CLI 與 MCP）SHALL 另外回傳 `csatAgentRatedCount`（期間內客服代評的工單數）；`GET /analytics/csat` 的回覆數、平均、滿意率與低分工單只算客人自評，另外回傳 `agentRatedCount`；客服績效與我的績效的 CSAT 平均只算客人自評。報表頁的 CSAT 分數卡 SHALL 顯示客服代評的筆數。

#### Scenario: 總覽的平均不含客服代評
- **WHEN** 期間內有兩張客人自評 4 分與 2 分的工單、一張客服代評 5 分的工單
- **THEN** `GET /analytics/overview` 的 `csatAvg` 是 3，`csatPositiveRate` 是 50，`csatAgentRatedCount` 是 1

#### Scenario: 滿意度報告分開客服代評
- **WHEN** 期間內寄出問卷的工單有一張客人自評 1 分、一張客服代評 5 分、一張沒有評分
- **THEN** `GET /analytics/csat` 的 `totalResponded` 是 1、`avgScore` 是 1、`agentRatedCount` 是 1，`lowScoreCases` 只有客人自評的那張

#### Scenario: 客服績效的 CSAT 不含客服代評
- **WHEN** 一位客服負責兩張工單，一張客人自評 2 分、一張客服代評 5 分
- **THEN** `GET /analytics/agents` 這位客服的 `csatAvg` 是 2

#### Scenario: 報表頁顯示客服代評筆數
- **WHEN** 報表總覽回傳 `csatAvg` 是 4.5、`csatAgentRatedCount` 是 3
- **THEN** CSAT 分數卡顯示 4.5 與「客服代評 3 筆（不計入平均）」
