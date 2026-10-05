## 1. 規則摘要

- [x] 1.1 測試 `apps/web/tests/unit/lib/automation/rule-summary.test.ts`：Rule with one condition and one action、Rule with any-group conditions、Select value shown by label
- [x] 1.2 實作 `apps/web/src/lib/automation/rule-summary.ts`

## 2. 列表

- [x] 2.1 測試 `apps/web/tests/unit/lib/automation/rule-list.test.ts`：Event shown by label、Search by name、Filter by active state
- [x] 2.2 實作 `apps/web/src/lib/automation/rule-list.ts`；改寫 `apps/web/src/app/dashboard/automation/page.tsx`

## 3. 編輯頁用語

- [x] 3.1 測試 `apps/api/tests/unit/modules/automation/automation-contract.test.ts`：Event that never triggers（契約的 `dispatched` 與事件說明）
- [x] 3.2 實作 `packages/automation` 事件說明與 `dispatched`
- [x] 3.3 測試 `apps/web/tests/unit/lib/automation/condition-builder-labels.test.ts`：Condition builder in Chinese
- [x] 3.4 實作 `ConditionBuilder` 中文化；編輯頁欄位名稱與說明

## 4. 試跑表單

- [x] 4.1 測試 `apps/web/tests/unit/lib/automation/rule-test-form.test.ts`：Inputs follow the conditions、Rule triggers、Rule does not trigger
- [x] 4.2 實作 `apps/web/src/lib/automation/rule-test-form.ts`；編輯頁試跑區改用表單

## 5. 實作時發現

- [x] 5.1 測試 `apps/api/tests/unit/modules/automation/automation-create-active.test.ts`：Create an inactive rule、Client that does not send the active state
- [x] 5.2 實作 `createRuleSchema` 與 `createRule` 接受 `isActive`
- [x] 5.3 測試 `rule-actions.test.ts`：指派客服的選項；實作 `agentOptions()` 與 `AgentSelectField`，契約標籤由「Agent UUID」改為「指派給」
- [x] 5.4 列表切換啟用失敗時顯示錯誤；動作下拉選單文字被切掉

## 6. Code review 修正

- [x] 6.1 測試 `rule-test-form.test.ts`：Boolean fact、多值欄位、日期時間、Conditions match but the rule is inactive、事件不會送出、關鍵字規則；`rule-summary.test.ts`：Action with an ID parameter；`rule-actions.test.ts`：客服名單載入前
- [x] 6.2 實作依欄位型別轉型、試跑結果說明停用／不會送出／關鍵字、摘要不顯示 ID、客服名單載入前不標已停用、規則重新載入時清除試跑結果
- [x] 6.3 更新 UAT E2E：`tenant-automation.spec.ts`（案例 02、05、06、07）、`tenant-fields-knowledge-automation.spec.ts`（AU-09、AU-13 與新文案）
- [x] 6.4 更新 `AUDIT.md`（AUTO-02、AUTO-05 部分修正）與 `AUDIT-REVIEWS.md`

## 7. 第二輪 code review

- [x] 7.1 測試 `automation-dispatched-events.test.ts`：契約的 `dispatched` 與 `setupAutomationWorker()` 實際訂閱的事件一致
- [x] 7.2 測試與實作：Keyword rule names its keywords、Unknown condition node、Inactive rule without conditions；指派客服的參數型別改為 `agent`（`automation-contract.test.ts`），刪除走不到的 `assign_agent` 舊分支
- [x] 7.3 條件樹走訪抽成 `condition-tree.ts`；列表的摘要與契約驗證改為依規則資料快取；摘要的滑鼠提示顯示完整摘要與說明
- [x] 7.4 AU-15 的說明欄文案；操作手冊第 4 章（`apps/web/public/manual/ch04-automation.html`）改寫並更新列表截圖

## 8. PR #225 bot 審查

- [x] 8.1 測試 `apps/api/tests/unit/modules/automation/automation-create-active-route.test.ts`：以 HTTP 請求驗證 `isActive` 經過 `createRuleSchema` 與路由傳到資料庫（暫時拿掉 schema 的 `isActive` 時失敗）

## 9. 完成檢查

- [x] 9.1 `pnpm test` 通過；`packages/automation`、`apps/web`、`apps/api` 的 `tsc` 通過
- [x] 9.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 9.3 `CHANGELOG.md` 新增條目；`docs/ref/features/tenant/AUTOMATION.md` 更新
- [x] 9.4 `openspec validate improve-automation-page-readability --strict` 通過
- [x] 9.5 在本機或 UAT 實際操作列表與編輯頁截圖確認
