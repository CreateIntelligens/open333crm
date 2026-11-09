## 1. 共用的收件成員檢查

- [x] 1.1 `packages/core/src/agent/notifiable-agent.ts`：`isNotifiableAgent()`（同租戶、啟用中）與 `agentExistsInTenant()`（只看存在）；`apps/workers/src/lib/requester.ts` 的 `requesterExists()` 改用 `agentExistsInTenant()`，`data-export`、`data-erasure` 既有測試保持通過

## 2. workers 的通知 job

- [x] 2.1 測試 `apps/workers/tests/unit/handlers/notification.handler.test.ts`：「收件成員已被永久刪除」「收件成員已停用」在現有程式上斷言失敗（仍寫入）；「Notification job consumed by worker」等既有測試的 mock 補上啟用中的收件成員
- [x] 2.2 `notification.handler.ts` 寫入前呼叫 `isNotifiableAgent()`，不符合時寫 info log 並 return

## 3. API 行程直接寫入的通知

- [x] 3.1 測試 `apps/api/tests/feature/modules/notification/notification-recipient.test.ts`（真實資料庫、`app_tenant` 連線）：「createAndDispatch 的收件成員已被永久刪除」「createAndDispatch 的收件成員已停用」「createAndDispatch 的收件成員啟用中」「序號明細匯出者已停用」「序號明細匯出者已被永久刪除」「重新啟用後不補送」，修正前刪除與停用的情境斷言失敗（外鍵錯誤或寫入通知）
- [x] 3.2 `createAndDispatch` 寫入前呼叫 `isNotifiableAgent()`，不符合時寫 info log、回傳 `null`
- [x] 3.3 `recordExportNotice` 寫入前呼叫 `isNotifiableAgent()`，不符合時回傳 `null`；`notifyExportResult` 只在有寫入時推播

## 4. Mutation 驗證

- [x] 4.1 拿掉 `isNotifiableAgent()` 的 `isActive: true` 條件 → worker「收件成員已停用」與 feature「createAndDispatch 的收件成員已停用」「重新啟用後不補送」「序號明細匯出者已停用」失敗；還原
- [x] 4.2 `notification.handler.ts` 拿掉檢查 → worker 的刪除、停用測試失敗；還原
- [x] 4.3 拿掉 `createAndDispatch` 與 `recordExportNotice` 的檢查 → feature 的刪除、停用、重新啟用不補送、匯出共 5 項失敗；還原

## 5. 完成定義

- [x] 5.1 `pnpm test`、api feature 全套通過
- [x] 5.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 無新增違規；`feature-impact --check` 通過
- [x] 5.3 CHANGELOG `## [2026-11-09]`、`docs/ref/features/tenant/NOTIFICATIONS.md`、健檢 `NOTIFICATIONS.md`、`feature-notifications` skill、AUDIT CONV-06 與 AUDIT-REVIEWS 更新
