## 1. 問卷卡片顯示分數與時間軸紀錄（後端）

- [x] 1.1 在 `apps/api/tests/unit/modules/csat/csat-score-display.test.ts`（新增）寫 Scenario「客人評分後問卷卡片顯示分數」「客服代評後問卷卡片標明客服代評」「客人評分後時間軸有評分與自動關閉紀錄」「客服代評的時間軸紀錄標明客服」的測試，執行確認在 assertion 失敗（4 項失敗：找不到問卷訊息的更新與 `csat_rated` 事件）
- [x] 1.2 在 `apps/api/tests/feature/modules/csat/csat-record-scope.test.ts` 加真資料庫的同名情境（驗證 `metadata.caseId` JSON 條件與租戶條件），執行確認失敗（3 項）
- [x] 1.3 修改 `csat.service.ts`：新增 `recordCsatRating(ctx: TenantCtx, …)` 更新問卷訊息並寫 `csat_rated`；`recordCsatScore()` 推送問卷訊息的 `message.new`、自動關閉寫 `status_changed`；`CsatScope` 加 `agentId`，`case.routes.ts` 傳入。執行 1.1、1.2 確認通過

## 2. 評分訊息顯示文字

- [x] 2.1 在 `apps/api/tests/feature/modules/webhook/inbound-message-processing.test.ts` 寫 Scenario「評分的訊息在收件匣顯示文字」，執行確認失敗
- [x] 2.2 新增 `relabelCsatReplyMessage(ctx: TenantCtx, …)`、`csatReplyDisplayText()`（LINE 問卷按鈕的 `displayText` 改用同一函式）；`inbound-postback-interceptors.ts` 攔截後呼叫。執行 2.1 確認通過，原有 CSAT 攔截測試仍通過

## 3. 前端

- [x] 3.1 在 `apps/web/tests/unit/components/inbox/csat-message-score.test.tsx`（新增）寫 Scenario「有分數的問卷卡片唯讀」；在 `apps/web/tests/unit/components/case/case-timeline-csat.test.tsx`（新增）寫「時間軸以中文顯示評分與自動關閉」「工單詳情頁顯示滿意度分數」，執行確認失敗（5 項）
- [x] 3.2 修改 `CsatMessage.tsx`（分數跟著 prop 更新、標題顯示評分者、送出失敗時恢復可點）、`ChatWindow.tsx`（傳入 `csatRatedBy`）、`CaseTimeline.tsx`、`CaseDetail.tsx`。執行 3.1 確認通過

## 4. 文件

- [x] 4.1 更新（`docs/ref/features/health/README.md` 只列 P1，HC-CASES-01 是 P2，不需改） `docs/ref/features/tenant/CASES.md`、`INBOX.md`、`docs/ref/features/health/`、`docs/ref/system/AUDIT.md`、`AUDIT-REVIEWS.md`、`.claude/skills/feature-cases/SKILL.md` 回歸清單、`CHANGELOG.md`

## 5. 完成前檢查

- [x] 5.1 受影響的 api／web unit 測試與 `tests/feature/modules/csat/`、`tests/feature/modules/webhook/inbound-message-processing.test.ts` 通過；`pnpm --filter @open333crm/web build` 通過
- [x] 5.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 通過
- [x] 5.3 `node scripts/validate-openspec.mjs show-csat-score-444` 通過
