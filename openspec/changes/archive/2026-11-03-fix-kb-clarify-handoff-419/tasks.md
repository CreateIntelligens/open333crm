## 1. 知識庫追問用完或 AI 失敗時轉接真人

- [x] 1.1 測試 `apps/api/tests/unit/modules/ai/kb-clarify-handoff.test.ts`：「追問次數用完」「LLM 呼叫失敗」（月額度用完、其他錯誤）「轉接後客人再傳訊息」「同一則訊息處理兩次」「寫入系統訊息失敗」，在現有程式上斷言失敗（對話仍是 `BOT_HANDLED`、第二則訊息又收到轉接句）
- [x] 1.2 「還沒用完追問次數」寫好就通過（既有行為）；突變驗證：拿掉 handoff.flow 的 `conversation.updated` 推播時 1.1 的三個轉接測試失敗
- [x] 1.3 新增 `handoff.service.ts`（`markConversationHandedOff`，收 `TenantCtx`）與 `handoff.flow.ts`（`handOffConversation`，發 `conversation.handoff`、`notifyChannel`）；`checkAutoHandoff()` 改用它；`attemptKbAutoReply()` 收 `EventPublisher`，`clarify_handoff` 在 bot_reply 認領的交易內轉接，追問次數歸零
- [x] 1.4 測試 `apps/api/tests/feature/modules/automation/handoff-flow.test.ts`（真實 PostgreSQL、app_tenant）：「追問次數用完」「同一則訊息處理兩次」與別的租戶的對話不轉接；突變驗證：條件更新拿掉 `status: 'BOT_HANDLED'` 時「同一則訊息處理兩次」失敗
- [x] 1.5 `inbox-realtime-source.test.ts` 的原始碼斷言改讀 `handoff.flow.ts`（`ConversationUpdatedPayload` 搬到共用步驟）

## 2. 轉接後關鍵字規則照常回覆

- [x] 2.1 測試 `kb-clarify-handoff.test.ts`：「轉接後客人傳送關鍵字」寫好就通過（workers 執行關鍵字規則不看對話狀態）；突變驗證：`message.received` 的評估不帶 `messageContent` 時失敗
- [x] 2.2 改寫 `kb-autoreply.service.ts` 步驟 2.5 的註解

## 3. 轉接真人時通知客服

- [x] 3.1 測試 `apps/api/tests/unit/modules/notification/notification.worker.test.ts`：「未指派的對話轉接」在現有程式上斷言失敗（`conversation.handoff` 不在通知訂閱者）；「已指派的對話轉接」突變驗證：收件人一律改成主管與管理員時失敗
- [x] 3.2 `packages/core/src/outbox/queues.ts` 的通知訂閱事件加上 `conversation.handoff`；`notification.worker.ts` 新增處理；web 鈴鐺與通知頁加上 `conversation_handoff`
- [x] 3.3 測試 `apps/web/tests/unit/app/notifications-type-labels.test.tsx` 加上 `conversation_handoff` 顯示「轉接真人」（沒有設定時退回「通知」，斷言失敗）

## 4. 完成定義

- [x] 4.1 `pnpm test`（api、core、workers unit；web 只跑通知類型測試）
- [x] 4.2 feature 測試 `handoff-flow.test.ts` 以獨立測試庫（`TEST_DATABASE_NAME=open333crm_test_p419`）執行
- [x] 4.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 皆 `--strict` 通過；`tsc --noEmit`（api）
- [x] 4.4 更新 `docs/ref/features/tenant/KNOWLEDGE.md`、`docs/ref/features/health/KNOWLEDGE.md` 與相關 feature skill
- [x] 4.5 CHANGELOG、AUDIT KB-01 與 AUDIT-REVIEWS 由合併者統一寫入（本分支不改這三個檔案）
