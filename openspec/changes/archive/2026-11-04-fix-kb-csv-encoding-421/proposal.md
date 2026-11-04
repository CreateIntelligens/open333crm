## Why

知識庫匯入 CSV 時沒有指定編碼，`XLSX.read(buffer)` 把沒有 BOM 的 UTF-8 當成單位元組讀，中文全部變亂碼（#421，AUDIT KB-03）。表頭是英文 `question,answer` 時，亂碼的問答還會直接發布，AI 馬上拿來回答客人。Google 試算表、Numbers 與程式匯出的 CSV 都沒有 BOM；台灣版 Excel 的「CSV（逗號分隔）」是 Big5，同樣會亂碼。

使用者決定（2026-11-04）：匯入的問答維持直接發布；這次只修編碼，解不出來或仍是亂碼時拒絕匯入。

## What Changes

- CSV 匯入前先自行解碼：有 UTF-8 BOM 時去掉 BOM 以 UTF-8 解；沒有 BOM 時先以嚴格 UTF-8 解，失敗再試 Big5。解好的字串再交給試算表解析。xlsx 不受影響。
- 兩種編碼都解不出來，或解出的文字含替代字元 U+FFFD 時，這個檔案一篇都不寫入，該檔的匯入結果標成失敗，錯誤代碼 `CSV_ENCODING_UNREADABLE`，原因是中文並建議另存成「CSV UTF-8」。同批其他檔案照常匯入（上傳路由原本就是每個檔案各自回報結果）。
- 匯入對話框的失敗原因改為完整換行顯示，不再截斷。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `km-ingestion`：新增「CSV import decodes UTF-8 and Big5 text」與「CSV import rejects text that cannot be decoded」。主規格原本沒有描述檔案上傳匯入 CSV 的需求，因此用 ADDED。

## Impact

- `apps/api/src/modules/knowledge/file-parser.service.ts`：新增 `decodeCsvText()`，`parseSpreadsheetToQaRows()` 與單篇 CSV 匯入都經過它。
- `apps/api/src/modules/knowledge/knowledge.routes.ts`：`POST /knowledge/upload` 的失敗結果多帶 `code`。
- `apps/web/src/components/knowledge/ImportDialog.tsx`：失敗原因不截斷。
- 不新增依賴：Node 內建 `TextDecoder` 支援 `big5`。
