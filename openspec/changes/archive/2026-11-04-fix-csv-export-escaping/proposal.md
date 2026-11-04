## Why

#423（AUDIT ANA-03、健檢 HC-ANALYTICS-04）：報表匯出的 CSV 只替工單標題加引號，聯絡人名稱、客服姓名、分類、渠道名稱原樣輸出。
聯絡人名稱來自 LINE、FB 暱稱或 WebChat 訪客自填，顧客自己就能設定：名稱含逗號時後面的欄位錯位；以 `=`、`+`、`-`、`@` 開頭時，
Excel 開啟會當成公式（CSV injection），例如插入惡意連結。

全 repo 共有三處產生 CSV：報表匯出（`analytics.service.ts` 的 `buildCsv()`）、優惠券序號明細（`coupon-stats.service.ts` 的
`csvCell()`，已有公式防護但只在優惠券模組內）、租戶資料匯出（workers `simple-zip.ts` 的 `toCsv()`，有引號跳脫但沒有公式防護，
日期還被 `JSON.stringify` 多包一層引號）。三處規則不同，現有主規格都沒有寫 CSV 欄位的格式。

## What Changes

- 新增共用函式 `csvCell()`／`csvRow()`（`packages/shared/src/utils/csv.ts`）：含逗號、雙引號、CR／LF 的欄位以雙引號包住、
  `"` 改成 `""`；以 `=`、`+`、`-`、`@`、Tab、CR 開頭的文字前面加 `'`；數字、bigint、布林照原樣輸出（負數不加 `'`）；
  `Date` 輸出 ISO 字串；`null` 是空欄。標題列也經過同一個函式。
- 報表匯出的四種報表（overview、cases、agents、channels）每一欄都經過 `csvRow()`。
- 優惠券序號明細改用共用函式，刪掉模組內的 `csvCell()`。輸出由「每欄都加引號」改成「需要時才加引號」，解析結果相同。
- 租戶資料匯出的 `toCsv()` 改用共用函式，補上公式防護；日期欄改輸出 ISO 字串（原本是帶引號的 JSON 字串）。
- 知識庫離線管線 `packages/kb-ingest` 的審核用 CSV 不改：它會被讀回匯入，加 `'` 會改變內容，且不對租戶開放。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `analytics-reports`：新增「匯出的 CSV 欄位經過跳脫與公式防護」。
- `coupon-management`：新增「序號明細 CSV 的欄位經過跳脫與公式防護」（行為已存在，補規格）。
- `tenant-data-export`：新增「匯出檔的 CSV 欄位經過跳脫與公式防護」。

## Impact

- 程式：`packages/shared/src/utils/csv.ts`（新增）、`apps/api/src/modules/analytics/analytics.service.ts`、
  `apps/api/src/modules/coupon/coupon-stats.service.ts`、`apps/workers/src/lib/simple-zip.ts`。
- API：`POST /api/v1/analytics/export`、`GET /api/v1/coupons/:id/instances/export` 與背景匯出下載、資料匯出 zip 的 `csv/` 檔，
  輸出格式依上述規則變動；欄位名稱與順序不變。
- 前端不產生 CSV（只下載後端回傳的 Blob），不需改動。
