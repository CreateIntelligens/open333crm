## 1. 規則引擎：文字欄位比對數字比較值

- [x] 1.1 測試 `packages/automation/tests/unit/rules/operators.test.ts`：「訊息內容包含數字比較值」「文字欄位等於數字比較值」「標籤包含數字比較值」「不包含數字比較值」（另含 in／notIn、startsWith／textContains／matchesRegex），在現有程式上 6 項斷言失敗。「數字欄位比對不變」在現有程式上通過，以突變驗證：讓 `sameValue()` 改成 `String(a) === String(b)` 時失敗
- [x] 1.2 `packages/automation/src/rules/operators.ts`：字串運算子遇到數字比較值先轉字串；覆寫 `equal`、`notEqual`、`in`、`notIn`，只在「欄位值是字串、比較值是數字」時轉字串，其餘維持 json-rules-engine 原本的比對
- [x] 1.3 測試 `apps/workers/tests/unit/handlers/automation.handler.test.ts`：「訊息內容包含數字比較值」（workers 評估 `message.received` 規則會執行動作），在現有程式上斷言失敗
- [x] 1.4 測試 `apps/api/tests/unit/modules/automation/automation-test-numeric-text.test.ts`：「試試看與實際觸發一致」（`testRule` 回 `matched: true`），在現有程式上斷言失敗

## 2. 規則編輯器：條件值依欄位型別儲存

- [x] 2.1 測試 `apps/web/tests/unit/lib/automation/qb-to-engine.test.ts`：「文字欄位的純數字保留字串」「重存舊規則修正型別」（與巢狀群組）在現有程式上斷言失敗；「數字欄位轉成數字」「是／否欄位轉成布林」在現有程式上通過，以突變驗證：契約有定義的欄位一律不轉值時兩項失敗
- [x] 2.2 `apps/web/src/lib/automation/qb-to-engine.ts`：依 `AUTOMATION_FACT_MAP` 的欄位型別轉值

## 3. 完成定義

- [x] 3.1 `pnpm test`、受影響的 feature 測試、`pnpm build` 通過
- [x] 3.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 通過
- [x] 3.3 `node scripts/validate-openspec.mjs fix-automation-numeric-text-conditions` 與 `--specs` 通過
- [x] 3.4 CHANGELOG、AUDIT（AUTO-06）、AUDIT-REVIEWS、`docs/ref/features/health/AUTOMATION.md`、`docs/ref/features/health/README.md`、`docs/ref/features/tenant/AUTOMATION.md`、feature-automation skill 更新
