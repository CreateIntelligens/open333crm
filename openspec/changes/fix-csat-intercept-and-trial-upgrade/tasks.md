## 1. RLS-06：CSAT 評分限定租戶與聯絡人

- [x] 1.1 寫失敗的測試 `apps/api/tests/feature/modules/csat/csat-record-scope.test.ts`，在 TENANT_A 與 TENANT_B 各建立一張工單（測試結束時刪除），涵蓋規格的「CSAT response for a case of another tenant」「CSAT response for a case of another contact」「CSAT response for a case that does not exist」：以 `recordCsatScore()` 對另一個租戶或另一個聯絡人的工單評分，斷言回傳 `false`、工單的 `csatScore` 仍是 null、對話沒有新訊息；對自己租戶、自己聯絡人的工單評分，斷言回傳 `true` 並寫入分數
- [x] 1.2 修改 `csat.service.ts` 的 `recordCsatScore()`：接收 `{ tenantId, contactId? }`，以 `findFirst({ where: { id, tenantId, contactId } })` 查工單（design D1）。讓 1.1 通過
- [x] 1.3 修改 `case.routes.ts` 的 `POST /cases/:id/csat`，傳入 `{ tenantId: request.agent.tenantId }`
- [x] 1.4 在 `apps/api/tests/unit/modules/webhook/inbound-message-refactor.test.ts` 新增會失敗的測試，涵蓋「CSAT response for a case of another tenant」：文字訊息 `csat:5:<id>` 進站時，斷言攔截器以 `case.findFirst` 查工單，`where` 帶 `tenantId: 'tenant-1'` 與傳訊者的 `contactId`；查不到時不發布 `message.received`。既有的 `testCsatInterceptDoesNotPublishMessageReceived` 只把 mock 從 `case.findUnique` 換成 `case.findFirst`，斷言的行為不變
- [x] 1.5 修改 `inbound-postback-interceptors.ts` 的 `handleCsatResponse()`：`ctx.contactId` 是空值時不呼叫 `recordCsatScore()`；傳入 `{ tenantId: ctx.tenantId, contactId: ctx.contactId }`；沒有寫入時記一筆 warn log；文字或 postback 的格式與分數符合時一律回傳 `true`（design D2）。讓 1.4 通過

## 2. TRIAL-01：轉為付費方案時脫離試用

- [x] 2.1 寫失敗的測試 `apps/api/tests/feature/modules/platform/plan-change-trial-exit.test.ts`，建立帶唯一標記的測試方案、租戶與申請（`afterAll` 刪除），涵蓋規格的：
  - 「核准試用租戶的升級申請」
  - 「申請審核期間試用已到期並被軟刪」
  - 「核准非試用租戶的升級申請」
  - 「核准試用租戶的加購申請」
- [x] 2.2 在同一個測試檔寫失敗的測試，涵蓋「轉付費清除軟刪標記」：對 `isActive=false`、`purgedAt` 不是 null 的試用租戶呼叫 `convertToPaid()`，斷言 `purgedAt` 是 null
- [x] 2.3 在同一個測試檔寫測試，涵蓋「平台在編輯頁改方案不脫離試用」：對試用租戶呼叫 `updateTenant()` 改方案，斷言 `trialEndsAt` 不變。這個測試在修改前就會通過，用來防止日後改壞
- [x] 2.4 在同一個測試檔寫失敗的測試，涵蓋「脫離試用後不被到期排程停用」：試用租戶的 `trialEndsAt` 設為過去，經 `approveRequest()` 核准升級後呼叫 `runTrialLifecycle()`，斷言 `isActive` 仍是 true，且沒有該租戶的 `tenant.trial.expire` 稽核
- [x] 2.5 在 `trial-admin.service.ts` 定義 `TRIAL_EXIT_DATA`，並改 `convertToPaid()` 使用它（design D3）。讓 2.2 通過
- [x] 2.6 修改 `plan-change.service.ts` 的 `approveRequest()`：upgrade 分支先讀租戶的 `trialEndsAt`，不是 null 時把 `planId` 與 `TRIAL_EXIT_DATA` 在同一次更新寫入，回傳值加上 `trialExited`。讓 2.1、2.4 通過
- [x] 2.7 修改 `platform.routes.ts` 的 `plan_change.approve` 稽核，在 payload 寫入 `trialExited`
- [x] 2.8 在 `apps/web/src/app/admin/tenants/[id]/page.tsx` 的方案下拉選單旁邊，對 `trialEndsAt` 不是 null 的租戶顯示提示：改方案不會脫離試用，轉付費請用試用管理頁（design D4）

- [x] 2.9 在 `plan-change-trial-exit.test.ts` 寫失敗的測試，fixture 把 `trial.planSlug` 設為測試用的試用方案，涵蓋規格的「租戶申請升級到試用方案」「平台核准目標為試用方案的升級申請」「轉正式到試用方案」
- [x] 2.10 在 `trial-admin.service.ts` 新增 `assertNotTrialPlan()`，由 `createPlanChangeRequest()`、`approveRequest()`、`convertToPaid()` 呼叫，`convertToPaid()` 移除寫死的 `trial` 比對（design D5）。讓 2.9 通過
- [x] 2.11 更新 `docs/ref/features/platform/PLAN-CHANGES.md` 與 `TRIALS.md`，說明試用方案不能當成目標，並在 `AUDIT-REVIEWS.md` 記錄這項由 Codex review 發現

## 3. 文件與 AUDIT

- [x] 3.1 `docs/ref/system/AUDIT.md`：移除 RLS-06 與 TRIAL-01，並新增一個項目記錄「非 LINE 渠道的 CSAT 無法運作」（提示格式不含工單 ID、FB 的 postback 沒有解析進 `postbackData`、`buildCsatChannelMessage()` 的 quick reply 沒有使用）
- [x] 3.2 `docs/ref/system/AUDIT-REVIEWS.md`：記錄 RLS-06、TRIAL-01 的修正 commit，以及新增的項目
- [x] 3.3 更新引用 RLS-06、TRIAL-01 的功能區文件（`docs/ref/features/` 下以 grep 找出）
- [x] 3.4 依 design 的 Migration Plan，把部署前查詢與修復的步驟寫進 PR 說明

## 4. 完成的定義

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 `pnpm test:feature` 通過
- [x] 4.3 `node scripts/check-tenant-scoping.mjs --strict` 與 `node scripts/check-prisma-admin-usage.mjs --strict` 沒有本 change 新增的違規
- [x] 4.4 `CHANGELOG.md` 在最新的 `## [YYYY-MM-DD]` 段落加入 `Fixed` 項目，涵蓋 RLS-06 與 TRIAL-01
- [ ] 4.5 所有任務打勾後，歸檔本 change
