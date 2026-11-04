## 1. 已指派對話的通知套用渠道可見範圍

- [x] 1.1 測試 `apps/api/tests/unit/modules/notification/notification.worker.test.ts`：「負責客服失去渠道權限」「負責客服已停用」「負責客服看不到渠道時改通知主管」，在現有程式上斷言失敗（X 仍收到）
- [x] 1.2 `notification.worker.ts` 新增負責客服的檢查（啟用中＋可見範圍），不符合時改用 `getChannelSupervisorAndAdminIds()`；`message.received` 與 `conversation.handoff` 共用
- [x] 1.3 既有「已指派」測試的 mock 補上負責客服為啟用中

## 2. 完成定義

- [x] 2.1 api unit、feature 測試通過；`check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 通過
- [x] 2.2 CHANGELOG、AUDIT-REVIEWS、`docs/ref/features/tenant/NOTIFICATIONS.md`、`docs/ref/features/tenant/INBOX.md` 更新
