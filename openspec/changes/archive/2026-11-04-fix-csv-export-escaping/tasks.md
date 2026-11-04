## 1. 共用跳脫函式

- [x] 1.1 測試 `packages/shared/tests/unit/csv.test.ts`：引號跳脫、公式字元加 `'`、數字（含負數、bigint）不加 `'`、日期與物件、`csvRow()`；以只做 `String()` 的暫時實作斷言失敗（5 個失敗）
- [x] 1.2 `packages/shared/src/utils/csv.ts` 新增 `csvCell()`、`csvRow()`，由 `@open333crm/shared` 匯出

## 2. 報表匯出（analytics-reports）

- [x] 2.1 測試 `apps/api/tests/unit/modules/analytics/export-csv-escaping.test.ts`：「聯絡人名稱含逗號與公式時工單 CSV 欄數正確」「標題、分類、客服姓名以公式字元開頭或含換行時加以跳脫」「客服 CSV 的數字欄位不加單引號」「渠道 CSV 的渠道名稱經過跳脫」在現有程式上斷言失敗
- [x] 2.2 「概覽 CSV 的負數不加單引號」：概覽的值都是數字，現有程式已正確，寫好就通過；突變驗證：`csvCell()` 不再對數字直接輸出時失敗（客服 CSV 的測試也一起失敗）
- [x] 2.3 `buildCsv()` 四種報表的標題列與資料列都改用 `csvRow()`

## 3. 優惠券序號明細（coupon-management）

- [x] 3.1 測試 `apps/api/tests/unit/modules/coupon/csv-cell.test.ts` 改測 `instancesToCsv()`：「持有者名稱以公式開頭又含逗號」「券號以減號開頭、持有者名稱含換行」——既有行為，寫好就通過；突變驗證：共用 `csvCell()` 拿掉公式防護時失敗
- [x] 3.2 `coupon-stats.service.ts` 刪掉模組內的 `csvCell()`，改用 `csvRow()`
- [x] 3.3 feature 測試 `coupon.service.test.ts`「CSV 欄位含逗號時不破壞格式」原本數 `","` 依賴「每欄都加引號」，改用 `tests/support/parse-csv.ts` 解析後比欄數

## 4. 租戶資料匯出（tenant-data-export）

- [x] 4.1 測試 `apps/workers/tests/unit/lib/data-export-zip.test.ts`：「聯絡人名稱以公式開頭又含逗號」「數字與日期欄位照原樣輸出」在現有程式上斷言失敗
- [x] 4.2 `simple-zip.ts` 的 `toCsv()` 改用 `csvRow()`

## 5. 文件與完成定義

- [x] 5.1 `docs/ref/system/AUDIT.md` ANA-03、`AUDIT-REVIEWS.md`、`docs/ref/features/health/ANALYTICS.md`、`docs/ref/features/health/README.md`、`feature-analytics` skill 回歸清單、`CHANGELOG.md`
- [x] 5.2 受影響的 unit 測試（shared、api analytics／coupon、workers）與 api coupon feature 測試通過
- [x] 5.3 `pnpm build`、`check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 以 `--strict` 通過
