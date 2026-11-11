## 1. 未指派對話的通知套用渠道可見範圍

- [x] 1.1 測試 `apps/api/tests/unit/modules/notification/notification.worker.test.ts`：「未指派的對話轉接：看不到該渠道的主管不會收到轉接通知」「未指派對話的新訊息：看不到該渠道的主管不會收到新訊息通知」，在現有程式上斷言失敗（分店主管也收到）
- [x] 1.2 `notification.worker.ts` 新增 `getChannelSupervisorAndAdminIds()`，以注入的 `AgentVisibilityResolver`（預設 `agentVisibilityResolver(prisma)`）過濾；`message.received` 與 `conversation.handoff` 的未指派分支改用它
- [x] 1.3 既有測試改為注入回傳 `ALL_CHANNELS` 的可見範圍；「分店主管收自己渠道的新訊息通知」由「同一個事件通知多位客服人員」涵蓋（兩位都看得到時都收到）

## 2. 完成定義

- [x] 2.1 api unit、feature 測試通過；`check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 通過
- [x] 2.2 CHANGELOG、AUDIT RBAC-04（通知一列）、AUDIT-REVIEWS、`docs/ref/features/tenant/NOTIFICATIONS.md`、健檢 NOTIFICATIONS 更新
