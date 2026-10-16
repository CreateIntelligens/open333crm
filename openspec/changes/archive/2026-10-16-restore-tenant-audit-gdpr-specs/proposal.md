## Why

change `add-tenant-audit-gdpr` 在 `aa274cf0` 以改名的方式搬進 `archive/`（issue #228）。它新增的 capability `tenant-audit-log`、`tenant-data-export`、`tenant-data-erasure` 從來沒有套用，所以主規格沒有這三份。`rbac` 的「稽核與合規權限點」已由 #232 寫入 `permission-model`，不在這個 change 的範圍。

程式已經實作這三個功能，但測試只涵蓋 API 這一層，匿名化與硬刪除完全沒有測試。這個 change 照現行程式補上主規格與測試。

## What Changes

- 新增主規格 `tenant-audit-log`，有 3 條需求：
  - 記錄租戶內的敏感操作。
  - 稽核寫入失敗不影響主操作。
  - 查詢租戶稽核。
- 新增主規格 `tenant-data-export`，有 3 條需求：
  - 發起資料匯出。
  - 產生匯出檔。
  - 下載匯出檔與保留期。
- 新增主規格 `tenant-data-erasure`，有 4 條需求：
  - 發起聯絡人資料刪除。
  - 匿名化聯絡人。
  - 硬刪除聯絡人。
  - 刪除完成時記錄結果。
- 新增 3 個 feature 測試檔。匯出與刪除的測試直接呼叫 `apps/workers` 的 handler，資料庫是真的，物件儲存與通知佇列以 mock 取代。
- 既有測試改用 Scenario 名稱：`tenant-audit.test.ts` 2 個、`data-export.test.ts` 3 個。
- `docs/ref/system/AUDIT.md`：ERASE-01 補上「被合併的聯絡人的個資不會刪除」，新增 EXPORT-01。
- `docs/ref/features/tenant/GOVERNANCE.md`：補上漏列的稽核動作、合併聯絡人的問題與 EXPORT-01。

### 歸檔需求的處理方式

| 歸檔的需求 | 處理 |
| --- | --- |
| 記錄租戶內敏感操作 | 改寫成「記錄租戶內的敏感操作」，照現況列出寫稽核的操作。歸檔規格要求稽核「聯絡人刪除」與「行銷名單匯出」，但系統沒有這兩個功能，刪除聯絡人只能透過資料刪除。其他沒有寫稽核的操作由 AUDIT AUD-01 記錄。Scenario「系統動作以 null actor 記錄」不補：刪除完成的稽核記錄發起的成員，其他系統動作不寫稽核 |
| 稽核寫入為非阻斷側效 | 改寫成「稽核寫入失敗不影響主操作」 |
| 租戶 ADMIN 可查詢稽核日誌 | 改寫成「查詢租戶稽核」，補上排序與每頁筆數 |
| 租戶可發起資料匯出請求 | 改寫成「發起資料匯出」 |
| 非同步產生匯出檔並存物件儲存 | 改寫成「產生匯出檔」，照現況列出匯出的資料與 zip 結構。`scope` 參數沒有作用，需求不寫，記在 EXPORT-01 |
| 一次性下載與檔案保留期 | 改寫成「下載匯出檔與保留期」。現行程式在保留期內可以重複下載，不是一次性。到期後下載立即回 410，但狀態與檔案要等每小時一次的清理才更新，需求照現況寫 |
| 租戶可對聯絡人發起資料刪除 | 改寫成「發起聯絡人資料刪除」 |
| 匿名化抹除個資並保留營運統計 | 改寫成「匿名化聯絡人」，照現況列出處理的資料。歸檔規格寫「匿名化後該聯絡人 MUST 不再可被識別」，現行程式做不到（媒體檔、表單答案、工單內容、被合併的聯絡人都保留），需求不寫這句，沒處理的資料列在 ERASE-01 |
| 硬刪連鎖移除且不可復原 | 改寫成「硬刪除聯絡人」 |
| 刪除稽核不重新產生個資 | 併入「刪除完成時記錄結果」，並補上失敗時的紀錄 |

### 這次發現的問題

- **被合併的聯絡人的個資不會刪除。** 合併時被併入的聯絡人只會封存，個人欄位留著；刪除只處理指定的聯絡人。補進 AUDIT ERASE-01。
- **匯出的完成通知連到不存在的頁面、`scope` 沒有作用、整個租戶的資料一次載入記憶體。** 新增 AUDIT EXPORT-01（P3）。

三個功能都沒有後台頁面，規格只寫 API。

## Capabilities

### New Capabilities

- `tenant-audit-log`：租戶內敏感操作的稽核與查詢。
- `tenant-data-export`：匯出租戶的業務資料。
- `tenant-data-erasure`：匿名化或硬刪除單一聯絡人的資料。

### Modified Capabilities

（無）

## Impact

- `openspec/specs/tenant-audit-log/spec.md`、`openspec/specs/tenant-data-export/spec.md`、`openspec/specs/tenant-data-erasure/spec.md`（歸檔時建立）
- `apps/api/tests/feature/modules/tenant-audit/tenant-audit-routes.test.ts`、`apps/api/tests/feature/modules/data-export/data-export-flow.test.ts`、`apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`（新增）
- `apps/api/tests/feature/modules/tenant-audit/tenant-audit.test.ts`、`apps/api/tests/feature/modules/data-export/data-export.test.ts`（測試改名）
- `docs/ref/system/AUDIT.md`、`docs/ref/features/tenant/GOVERNANCE.md`
