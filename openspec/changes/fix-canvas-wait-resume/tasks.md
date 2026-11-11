## 1. 喚醒後從等待節點的下一個節點繼續

- [x] 1.1 測試 `packages/core/tests/unit/canvas/flow-runner-wait.test.ts`：「喚醒後從等待節點的下一個節點繼續」「等待節點是最後一個節點」「連續兩個等待節點」，在現有程式上斷言失敗（喚醒後狀態仍是 `WAITING`）
- [x] 1.2 測試 `apps/api/tests/feature/modules/canvas/canvas-resume.test.ts`：「喚醒後從等待節點的下一個節點繼續」走真實資料庫，從 `canvas-resume` 排程經認領到 `FlowRunner`，在現有程式上斷言失敗
- [x] 1.3 `FlowRunner.run()` 加上 `resumeFromWait`，略過暫停的等待節點（design D1）

## 2. 同一次等待只喚醒一次

- [x] 2.1 測試 `canvas-resume.test.ts`：「兩次喚醒同時執行」（兩期都掃描到之後才一起認領）、「已被另一次喚醒認領」、「時間還沒到」
- [x] 2.2 測試 `packages/core/tests/unit/canvas/resume-queue.test.ts`：在 execution 所屬租戶的交易內認領，認領失敗不恢復，一筆失敗不影響其他筆
- [x] 2.3 `processResumeQueue()` 改收 `{ admin, inTenant }`，以 `claimDueExecution()` 條件更新認領；`setupCanvasScheduler()` 改收 `{ admin, prisma }`（design D2、D3）
- [x] 2.4 突變驗證：認領條件改成只有 `{ id, tenantId }` 時，「兩次喚醒同時執行」（實際 2 次）與「已被另一次喚醒認領」失敗。只拿掉 `status` 或只拿掉 `resumeAt` 時測試仍通過，兩個條件互為備援（design D2）
- [x] 2.5 突變驗證：`FlowRunner` 拿掉 `resumeFromWait` 的略過時，1.1 與 1.2 的測試失敗

## 3. 文件

- [x] 3.1 `docs/ref/modules/CANVAS-FLOW-ENGINE.md` 的「暫停與喚醒」與核對日期
- [x] 3.2 `docs/ref/system/AUDIT.md` 的 APP-09、RLS-01，`docs/ref/system/AUDIT-REVIEWS.md` 加一節，`docs/ref/modules/EVENTS.md` 的排程說明

## 4. 完成定義

- [x] 4.1 `pnpm test`
- [x] 4.2 `pnpm test:feature`（獨立測試庫 `open333crm_test_334`）
- [x] 4.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 4.4 `node scripts/validate-openspec.mjs --specs`、`node scripts/validate-openspec.mjs fix-canvas-wait-resume`
- [x] 4.5 `pnpm build`
- [x] 4.6 `CHANGELOG.md` 的 `## [2026-11-11]` Fixed 加條目
