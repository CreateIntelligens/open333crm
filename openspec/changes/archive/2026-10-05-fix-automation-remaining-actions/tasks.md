## 1. remove_tag

- [x] 1.1 測試 `apps/workers/tests/unit/lib/automation-remove-tag.test.ts`：Remove tag by name、Remove a tag that does not exist、依 tagId、只找 CONTACT scope、跨租戶、缺聯絡人
- [x] 1.2 實作 `apps/workers/src/lib/automation-actions.ts` 的 `remove_tag`

## 2. 拿掉 3 種動作與未支援動作機制

- [x] 2.1 測試 `apps/api/tests/unit/modules/automation/automation-retired-actions.test.ts`：Unsupported action is rejected、Disabling a rule that contains an unsupported action、契約不含 3 種動作、remove_tag 有提供
- [x] 2.2 測試 `apps/workers/tests/unit/handlers/automation-retired-actions.test.ts`：Existing rule still runs its other actions、Retired action in an existing rule
- [x] 2.3 測試 `apps/web/tests/unit/lib/automation/rule-actions.test.ts`：Rule contains an unsupported action、Rule contains only unsupported actions besides valid ones
- [x] 2.4 實作：契約、composer、validation、workers handler、web 列表與編輯頁

## 3. 清理腳本

- [x] 3.1 測試 `apps/api/tests/unit/scripts/remove-retired-automation-actions.test.ts`：dry-run 不寫入、`--apply` 只移除 3 種動作、其他動作保留
- [x] 3.2 實作 `apps/api/src/scripts/remove-retired-automation-actions.ts`

## 4. 完成檢查

- [x] 4.1 `pnpm test` 通過；`packages/automation`、`apps/api`、`apps/workers`、`apps/web` 的 `tsc` 通過
- [x] 4.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 4.3 `CHANGELOG.md`；`AUDIT.md` 移除 AUTO-01、`AUDIT-REVIEWS.md`；`docs/ref/features/tenant/AUTOMATION.md`；操作手冊第 4 章
- [x] 4.4 `openspec validate fix-automation-remaining-actions --strict` 通過，用 CLI 歸檔
