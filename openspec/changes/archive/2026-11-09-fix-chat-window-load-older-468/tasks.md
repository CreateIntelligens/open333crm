## 1. 後端游標分頁

- [x] 1.1 測試 `apps/api/tests/feature/modules/conversation/conversation-messages-cursor.test.ts`：「60 則訊息分頁取完」「同一時間的多則訊息」「游標格式錯誤」「游標搭配 page 或升冪」，在現有程式上斷言失敗
- [x] 1.2 同檔「其他租戶的對話」「不帶 before 的舊呼叫」：既有行為（RLS 與 offset 分頁），寫好就通過；以突變驗證
- [x] 1.3 測試 `apps/api/tests/unit/modules/conversation/get-messages-tenant-scope.test.ts`：`getMessages()` 的查詢與計數條件帶 `conversation.tenantId`（feature 測試走 RLS，拿掉 `tenantId` 也看不出來，第一層由單元測試檢查），在現有程式上斷言失敗
- [x] 1.4 新增 `apps/api/src/shared/utils/message-cursor.ts`，`contact.service.ts` 改用它（重構，`contact` 既有測試前後都通過）
- [x] 1.5 `messagesQuerySchema` 改用 `paginationSchema.extend()` 加 `before`；`getMessages()` 改收 `TenantCtx`、加游標與 `tenantId`；新增 `conversation.flow.ts` 的 `getMessagesFlow`

## 2. 前端

- [x] 2.1 測試 `apps/web/tests/unit/components/inbox/chat-window-load-older.test.tsx`：「有更早的訊息」「已載入全部」「往上載入保持捲動位置」「新訊息捲到底」「更早的訊息載入失敗」「最新訊息載入失敗」「已載入更早的訊息時收到新訊息」，在現有程式上斷言失敗
- [x] 2.2 `useMessages()`：`loadOlder()` 改用 `before`，`hasMore` 依 `nextCursor`，回傳 `olderError`；最新一頁重新抓取時保留被擠出的訊息（design D4）
- [x] 2.3 `ChatWindow`：「載入更早的訊息」、捲動位置、只在最新一則改變時捲到底、錯誤與重試（design D1、D5）
- [x] 2.4 「Download finishes right after the message arrives」：既有測試在改寫後仍通過

## 3. 文件

- [x] 3.1 `docs/ref/features/health/INBOX.md`（HC-INBOX-07）、`docs/ref/system/AUDIT-REVIEWS.md` 新增紀錄
- [x] 3.2 `docs/ref/features/tenant/INBOX.md`、`.claude/skills/feature-inbox/SKILL.md`
- [x] 3.3 操作手冊 `apps/web/public/manual/ch01-inbox.html` 改寫 50 則限制的說明
- [x] 3.4 `CHANGELOG.md` 的 `## [2026-11-09]` Fixed 加條目

## 4. 完成定義

- [x] 4.1 `pnpm test`
- [x] 4.2 `pnpm test:feature`（獨立測試庫 `open333crm_test_p6f`）
- [x] 4.3 `pnpm --filter @open333crm/web build`
- [x] 4.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`；`feature-impact --check`
- [x] 4.5 `node scripts/validate-openspec.mjs fix-chat-window-load-older-468` 與 `--specs`
- [x] 4.6 以 `pnpm exec openspec archive` 歸檔

## 突變紀錄

每項改壞後執行對應測試，確認失敗後還原：

- `getMessages()` 拿掉 `conversation: { tenantId }`：單元「getMessages：查詢與計數都限定目前租戶的對話」失敗；feature 全部通過（RLS 擋住）。
- flow 改用 BYPASSRLS 連線並拿掉 `tenantId`：feature「其他租戶的對話」失敗（只換連線、保留 `tenantId` 時通過）。
- page 模式 `skip` 改成 0：feature「不帶 before 的舊呼叫」失敗。
- 游標條件只比 `createdAt`：feature「同一時間的多則訊息」失敗。
- 拿掉 `useLayoutEffect` 的捲動還原，或捲到底改回依賴整份訊息：元件「往上載入保持捲動位置」失敗。
- 不保留被擠出最新一頁的訊息：元件「已載入更早的訊息時收到新訊息」失敗。
- `hasMore` 永遠為 `true`：元件兩個「已載入全部」失敗。
- 失敗時丟掉游標：元件「更早的訊息載入失敗」失敗。
- 拿掉最新一頁的錯誤訊息：元件「最新訊息載入失敗」失敗。
- 拿掉最新一則改變時的捲到底：元件「新訊息捲到底」失敗。
- `loadOlder()` 改送 `page=2`：元件 6 項失敗。
