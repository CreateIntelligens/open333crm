## 1. 規則列表顯示全部規則

- [x] 1.1 測試 `apps/web/tests/unit/lib/fetch-all-pages.test.ts`：Tenant has more rules than one page、Tenant has no rules、A page fails to load
- [x] 1.2 實作 `apps/web/src/lib/fetch-all-pages.ts`，`useAutomationRules`、`useKeywordReplies` 改用它；列表頁顯示載入失敗
- [x] 1.3 測試 `apps/api/tests/unit/modules/automation/automation-list-order.test.ts`：Rules share priority and creation time
- [x] 1.4 實作 `listRules` 的排序加上 `id`

## 2. 編輯器移除契約外的動作

- [x] 2.1 測試 `apps/web/tests/unit/lib/automation/rule-actions.test.ts`：Rule contains an action outside the contract、Rule contains an action that the event does not offer、Rule contains an unsupported action、Rule has no trigger type
- [x] 2.2 實作 `splitRuleActions`、`ruleEventName`；編輯頁改用它們，移除重複的過濾 effect，切換觸發事件後隱藏提示

## 3. 列表標示會被略過的規則

- [x] 3.1 測試 `apps/web/tests/unit/lib/automation/rule-actions.test.ts`：Rule List Marks Rules The Workers Skip 的兩個 scenario
- [x] 3.2 實作 `findWorkerSkipErrors`，規則列表顯示「規則不會執行」

## 4. 驗證錯誤訊息用中文

- [x] 4.1 測試 `apps/api/tests/unit/modules/automation/automation-contract.test.ts`：Error message uses Chinese labels；Invalid fact rejected、Invalid action rejected 改為檢查中文名稱
- [x] 4.2 實作 `packages/automation/src/contracts/validation.ts` 的中文訊息

## 5. PR #221 bot 審查

- [x] 5.1 測試：Error message uses Chinese labels 改為「不是系統提供的動作」，契約沒有的欄位比照；Rule contains an action outside the contract 列為「未知動作（auto_assign）」
- [x] 5.2 實作 `validation.ts` 與 `splitRuleActions` 的未知欄位、動作說明

## 6. 完成檢查

- [x] 6.1 `pnpm test` 通過；`packages/automation`、`apps/web`、`apps/api` 的 `tsc` 通過
- [x] 6.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 6.3 `CHANGELOG.md` 新增條目；`docs/ref/features/tenant/AUTOMATION.md` 更新
- [x] 6.4 `openspec validate fix-automation-editor-bugs --strict` 通過
