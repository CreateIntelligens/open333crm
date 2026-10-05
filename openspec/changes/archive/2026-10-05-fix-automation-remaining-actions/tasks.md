## 1. remove_tag

- [x] 1.1 測試 `apps/workers/tests/unit/lib/automation-remove-tag.test.ts`：Remove tag by name、Remove a tag that does not exist、Remove a tag of another scope added by add_tag、依 tagId、跨租戶、缺聯絡人
- [x] 1.2 實作 `apps/workers/src/lib/automation-actions.ts` 的 `remove_tag`

## 2. 拿掉 3 種動作與未支援動作機制

- [x] 2.1 測試 `apps/api/tests/unit/modules/automation/automation-retired-actions.test.ts`：Unsupported action is rejected、Disabling a rule that contains an unsupported action、契約不含 3 種動作、remove_tag 有提供
- [x] 2.2 測試 `apps/workers/tests/unit/handlers/automation-retired-actions.test.ts`：Existing rule still runs its other actions、Retired action in an existing rule
- [x] 2.3 測試 `apps/web/tests/unit/lib/automation/rule-actions.test.ts`：Rule contains an unsupported action、Rule contains only unsupported actions besides valid ones
- [x] 2.4 實作：契約、composer、validation、workers handler、web 列表與編輯頁

## 3. 清理既有規則

- [x] 3.1 資料 migration `packages/database/prisma/migrations/20261005100000_remove_retired_automation_actions/migration.sql`：Migration cleans existing rules。在本機資料庫的交易內插入 4 種規則（只有已停用動作、混合、不受影響、空陣列）驗證結果並回滾，第二次執行不影響任何列
- [x] 3.2 契約 `RETIRED_AUTOMATION_ACTIONS` 保留中文名稱；測試 `automation-retired-actions.test.ts`、`rule-actions.test.ts`、`rule-summary.test.ts`

## 4. Code review 修正

- [x] 4.1 清理改為資料 migration（原本是部署後人工執行的腳本，程式上線到執行之間有空窗）；只有已停用動作的規則改為停用
- [x] 4.2 `remove_tag` 不限 scope，與 `add_tag` 對稱
- [x] 4.3 `apps/workers/tests/unit/handlers/automation-retired-actions.test.ts` 驗證 `remove_tag` 真的執行（暫時改壞實作時失敗）
- [x] 4.4 已停用動作在訊息與畫面用中文名稱；更新描述舊機制的註解

## 5. 完成檢查

- [x] 5.1 `pnpm test` 通過；`packages/automation`、`apps/api`、`apps/workers`、`apps/web` 的 `tsc` 通過
- [x] 5.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 5.3 `CHANGELOG.md`；`AUDIT.md` 移除 AUTO-01、`AUDIT-REVIEWS.md`；`docs/ref/features/tenant/AUTOMATION.md`；操作手冊第 4 章
- [x] 5.4 `openspec validate fix-automation-remaining-actions --strict` 通過，用 CLI 歸檔
