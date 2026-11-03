## 1. 測試（先寫，在斷言上失敗）

- [x] 1.1 `apps/api/tests/feature/modules/socket/socket-channel-rooms.test.ts`：channel-scoped-visibility「socket 與列表一致」「看得到的成員與總店照常收到」（進站 WebChat 訊息，真實 socket plugin 與 socket.io-client 連線）。修正前沒有授權的成員收到 `message.new` 全文，斷言失敗
- [x] 1.2 同檔：channel-scoped-visibility「客服操作的對話更新也依渠道送出」（標為已讀）。修正前斷言失敗
- [x] 1.3 同檔：socket-room-authorization「新授權的渠道開始收到推播」「撤銷後離開渠道房間與已訂閱的對話房間」。修正前「授權前不收」斷言失敗；突變：拿掉重新授權已訂閱房間的 `socket.leave`，「撤銷後離開已訂閱的對話房間」失敗
- [x] 1.4 `apps/api/tests/unit/lib/tenant-ctx.test.ts`：tenant-transaction-context「渠道推播」；commit 之後才重新計算房間、rollback 不算
- [x] 1.5 `apps/api/tests/unit/modules/socket/socket-room-handlers.test.ts`：「連線後加入自己的租戶與成員房間」「連線後加入看得到的渠道房間」
- [x] 1.6 `apps/api/tests/unit/plugins/socket-bridge-rooms.test.ts`：core-inbox「Malformed message received on socket:emit channel」（`rooms` 格式）
- [x] 1.7 `apps/workers/tests/unit/lib/automation-issue-coupon-*.test.ts`、`apps/workers/tests/unit/handlers/automation.handler.test.ts`：core-inbox「Worker sends a channel event to several rooms」；`automation.executed` 只帶 ID
- [x] 1.8 `apps/api/tests/unit/modules/agent/agent.flow.test.ts`、`apps/api/tests/unit/modules/role/role.flow.test.ts`：授權變更 commit 之後重新計算房間

## 2. 實作

- [x] 2.1 `@open333crm/shared` 的 `constants/socket-rooms.ts`：房間名稱（API 與 workers 共用）
- [x] 2.2 `events/socket-push.ts`：`ChannelPushName`、`notifyChannel`、`emitToChannel`、`resyncChannelRooms`；`message.new`／`conversation.*` 從 `TenantPushName` 移除
- [x] 2.3 `modules/socket/socket-channel-rooms.ts`、`plugins/socket.plugin.ts`：連線前算渠道房間、`fastify.syncSocketChannelRooms`、bridge 支援 `rooms`
- [x] 2.4 所有推 `message.new`／`conversation.*` 到租戶房間的入口改用渠道推播（conversation、webhook 進站、csat、kb-autoreply、agent、automation worker、canvas、chatbox、simulator、identity-binding、coupon）
- [x] 2.5 workers：`publishChannelSocketEvent`；channel-delivery、rule-coupon-issue、automation.executed 改推渠道房間
- [x] 2.6 授權變更入口呼叫重新計算：agent（可用渠道、角色）、role（權限）、channel（新增、停用／啟用、刪除、團隊授權）、meta-connect（連結粉專）

## 3. 完成條件

- [x] 3.1 `pnpm test`（api、workers、web 單元測試）通過
- [x] 3.2 相關 feature 測試通過（socket、webhook、channel、agent、role、coupon、csat、identity-binding、contact、case、analytics 等）
- [x] 3.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 通過；api、workers 的 tsc 無錯誤；`pnpm --filter @open333crm/web build` 通過
- [x] 3.4 docs/ref（EVENTS、INBOX 功能文件、健檢）與 feature skill 更新
- [x] 3.5 CHANGELOG、AUDIT RBAC-04、AUDIT-REVIEWS 的文字交給維護者（本次不直接修改）
