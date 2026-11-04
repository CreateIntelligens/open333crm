## 1. CSV 匯入解碼

- [x] 1.1 測試 `apps/api/tests/unit/modules/knowledge/knowledge-file-parser-encoding.test.ts`：「CSV import decodes UTF-8 without BOM」「CSV import decodes Big5 from Taiwan Excel」「CSV import with English headers keeps Chinese content intact」「CSV without QA headers is imported as one article with readable Chinese」「CSV that cannot be decoded is rejected with a Chinese reason」「CSV that already contains replacement characters is rejected」，在現有程式上斷言失敗
- [x] 1.2 同檔「CSV import decodes UTF-8 with BOM」：現有程式已正確處理 BOM，測試寫好即通過；以突變驗證：CSV 改成以 latin1 讀成字串（不經 `decodeCsvText()`）時測試失敗，還原後通過。只拿掉去 BOM 不會讓測試失敗，因為 XLSX 解析字串時會略過開頭的 U+FEFF
- [x] 1.3 測試 `apps/api/tests/unit/modules/knowledge/knowledge-upload-encoding.test.ts`：「UTF-8 CSV without BOM is split into published QA articles with readable Chinese」「CSV that cannot be decoded is rejected and nothing is written」，在現有程式上斷言失敗
- [x] 1.4 `file-parser.service.ts` 新增 `decodeCsvText()`（BOM → UTF-8 嚴格 → Big5 嚴格 → 拒絕；含 U+FFFD 也拒絕），`readWorkbook()` 依 zip 標頭分辨 xlsx 與 CSV
- [x] 1.5 `knowledge.routes.ts` 上傳失敗結果帶 `code`
- [x] 1.6 `ImportDialog.tsx` 失敗原因完整換行顯示

## 2. 完成定義

- [x] 2.1 knowledge 相關 unit 測試通過；`pnpm --filter @open333crm/web build` 通過
- [x] 2.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 通過
- [x] 2.3 CHANGELOG、AUDIT（KB-03）、AUDIT-REVIEWS、`docs/ref/features/health/KNOWLEDGE.md`、`docs/ref/features/tenant/KNOWLEDGE.md`、操作手冊、`feature-knowledge` skill 更新
- [x] 2.4 `node scripts/validate-openspec.mjs fix-kb-csv-encoding-421` 通過後以 `pnpm exec openspec archive` 歸檔
