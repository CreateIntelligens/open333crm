## 1. 進站（網站聊天室與共用入口）

- [x] 1.1 測試 `apps/api/tests/feature/modules/chatbox/chatbox-disabled-tenant.test.ts`：「既有的工作階段在租戶停用後送訊息」「租戶停用後新訪客建立工作階段」「租戶停用後訪客 socket 驗證工作階段」「共用入口 processInboundMessage 丟棄停用租戶的進站事件」，在現有程式上斷言失敗
- [x] 1.2 同檔：「啟用中的租戶：訪客送訊息照常寫入（對照組）」（既有行為，修正前就通過）
- [x] 1.3 `webhook.service.ts`：`processInboundMessage()` 先查租戶是否啟用，停用時丟棄（design D1）
- [x] 1.4 `chatbox.service.ts`：`resolveChatboxChannel()` 與 `verifyChatboxSession()` 加上租戶條件，停用時回 404（design D2）
- [x] 1.5 既有單元測試的 Prisma 替身補上 `tenant.findUnique` 與工作階段渠道的 `tenant`（`inbound-message-refactor`、`inbound-channel-msg-dedup`、`chatbox.service`、`chatbox-public-limits`）

## 2. 排程群發

- [x] 2.1 測試 `apps/api/tests/feature/modules/marketing/broadcast-disabled-tenant.test.ts`：「Due broadcast of a disabled tenant」「Due coupon broadcast of a disabled tenant」「Queued coupon broadcast job of a disabled tenant」，在現有程式上斷言失敗（群發照常 `completed` 並送出）
- [x] 2.2 同檔：「Active tenant sends the due broadcast (control)」（既有行為，修正前就通過）
- [x] 2.3 新檔 `broadcast-tenant-active.ts`；`broadcast.scheduler.ts` 與 `broadcast-coupon.worker.ts` 送出前檢查，停用時以條件更新標 `failed`（design D3）

## 3. 滿意度問卷

- [x] 3.1 測試 `apps/api/tests/feature/modules/csat/csat-disabled-tenant.test.ts`：「停用租戶的工單到了寄送時間」，在現有程式上斷言失敗（寫入了 `csatSentAt`）
- [x] 3.2 `csat.scheduler.ts`：寄送問卷的查詢加上 `tenant: { isActive: true }`（design D4）

## 4. 完成定義

- [x] 4.1 `pnpm test`（api、workers unit）
- [x] 4.2 api feature：本 change 的三個測試檔，以及 marketing、webhook、chatbox、csat、coupon 進站相關檔案，以獨立測試庫逐檔執行
- [x] 4.3 tsc（api）
- [x] 4.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 4.5 `node scripts/validate-openspec.mjs stop-disabled-tenant-activity-410`
- [x] 4.6 `docs/ref/features/health/PLATFORM-TENANTS.md`、`PLATFORM-TRIALS.md` 等文件與 `.claude/skills/feature-platform-tenants` 更新；CHANGELOG、AUDIT、AUDIT-REVIEWS 由維護者處理（本次不改）
