## 1. 測試先行

- [x] 1.1 `packages/automation/tests/unit/contracts/validation.test.ts`：「Select parameter outside the options rejected」（狀態 `FOO`、優先級 `SUPER`、分類不在清單）在現有程式上以 assertion 失敗；「Empty optional select parameter accepted」現有程式本來就通過，以 mutation 驗證（見 3.1）
- [x] 1.2 同檔「Case status action offers pending」：選項含 `PENDING`／待處理、設 `PENDING` 的規則通過驗證，在現有程式上以 assertion 失敗
- [x] 1.3 `apps/api/tests/feature/modules/automation/automation-routes.test.ts`：`POST /automation/rules` 帶狀態 `FOO` 回 400、規則沒有存進資料庫，在現有程式上以 assertion 失敗（回 201）
- [x] 1.4 `packages/shared/tests/unit/case-transitions.test.ts`：`caseStatusOutcomeEvent()` 已解決、已關閉、其他狀態三項（先以回傳 null 的空殼跑，以 assertion 失敗）
- [x] 1.5 `apps/workers/tests/unit/lib/automation-update-case-status.test.ts`：「Automation cannot resolve an open case」「Automation records a valid status change」「Automation closes a case」在現有程式上以 assertion 失敗；「Automation sets the current status」在現有程式上也失敗（狀態相同仍推播），另以 M2 驗證

## 2. 實作

- [x] 2.1 `packages/automation/src/contracts/validation.ts`：`validateActionParams()` 檢查下拉參數值
- [x] 2.2 `packages/automation/src/contracts/actions.ts`：`caseStatusOptions` 加入 `PENDING`
- [x] 2.3 `packages/shared/src/constants/case-transitions.ts`：`caseStatusOutcomeEvent()`；`apps/api/src/modules/case/case-effects.ts` 改用它
- [x] 2.4 `apps/workers/src/lib/automation-actions.ts`：`update_case_status` 檢查轉換、寫工單事件與 outbox、socket `source: 'automation'`
- [x] 2.5 `apps/web/src/components/case/CaseTimeline.tsx`：顯示 `automation_status_skipped`，自動化的 `status_changed` 標出規則名稱（`apps/web/tests/unit/components/case/` 補測試）

## 3. Mutation 驗證

- [x] 3.1 mutation 與失敗的測試（每次都已還原）：
  - M1：`validateActionParams()` 空值時不 `continue`（空白的選填下拉也檢查選項）→「Empty optional select parameter accepted」與分類那一項失敗
  - M2：workers 拿掉「狀態相同」判斷 →「Automation sets the current status」失敗
  - M3：workers 跳過 `canTransition()` →「Automation cannot resolve an open case」兩項失敗
  - M4：workers 推播的 `source` 改回 `sla_worker` →「Automation records a valid status change」失敗
  - M5：`caseStatusOutcomeEvent()` 拿掉 `conversationId` → shared「轉成 RESOLVED」與 API 工單單元測試「結案：commit 之後推播 case.updated，並發 case.resolved 帶上對話 ID」「下拉改成已解決：寫 status_changed 事件並發布 case.resolved」失敗

## 4. 完成定義

- [x] 4.1 `pnpm test`、`pnpm build`、`pnpm --filter @open333crm/api test:feature`
- [x] 4.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`；`node scripts/feature-impact.mjs --check`
- [x] 4.3 `node scripts/validate-openspec.mjs fix-automation-case-status-469` 與 `--specs`
- [x] 4.4 CHANGELOG、AUDIT.md（AUTO-10、AUTO-12）、AUDIT-REVIEWS.md、功能文件、健檢、skill 回歸清單
