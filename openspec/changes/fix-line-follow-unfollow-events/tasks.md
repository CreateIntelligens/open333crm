## 1. 封鎖狀態與沒見過的顧客封鎖

- [x] 1.1 測試 `apps/api/tests/feature/modules/webhook/line-system-events.test.ts`：「Unknown user blocks the official account」「Unfollow event records the block」「Follow event updates contact」「Unfollow of another channel does not change this channel」，在現有程式上斷言失敗
- [x] 1.2 `ChannelIdentity.blockedAt` 與 migration `20261113100000_add_channel_identity_blocked_at`；`pnpm db:generate`
- [x] 1.3 新增 `inbound-system-events.ts`（design D1）；`processInboundMessage()` 在解析聯絡人前略過查不到身分的 unfollow（D2）；`inbound-follow-tracking.ts` 新增 `recordInboundUnfollow()`，follow 清空 `blockedAt`（D3）
- [x] 1.4 既有 `follow-tracking.test.ts` 照常通過；文件 `docs/ref/features/tenant/README.md`、`SETTINGS.md`、`docs/ref/features/health/LINE.md`（HC-LINE-10 部分修正）、`.claude/skills/feature-line/SKILL.md` 同步

## 2. 系統事件不觸發非營業時間自動回覆

- [x] 2.1 測試 `line-system-events.test.ts`：「非營業時間有人加好友」「非營業時間有人封鎖」在現有程式上斷言失敗；「非營業時間的一般訊息照舊自動回覆」是既有行為，以突變驗證：把系統事件判斷反過來（`if (!isSystemEventContentType(...)) return`）時失敗
- [x] 2.2 `sendOutsideHoursAutoReply()` 遇到系統事件直接返回

## 3. 加好友招呼語用 replyToken

- [x] 3.1 測試 `line-system-events.test.ts`（走真正的 `processWebhookEvent()`、LINE 外掛與 `deliverToChannel()`，只攔截對 LINE 的 fetch）：「LINE 加好友當下即招呼」「加好友的 reply 失敗時改用 push」在現有程式上斷言失敗；「一般訊息的招呼語不用該訊息的 replyToken」是既有行為，以突變驗證：拿掉 `greetingPayload()` 的 `contentType !== 'follow'` 條件時失敗
- [x] 3.2 `sendFirstContactGreeting()` 在 follow 事件以 `delivery.replyToken` 呼叫 `deliverToChannel()`（D4）
- [x] 3.3 既有 `first-contact-greeting.test.ts`（unit）照常通過

## 4. Canvas 依事件類型觸發

- [x] 4.1 測試 `line-system-events.test.ts`：「加好友觸發「加好友」流程」「加好友不觸發「收到訊息」流程」「封鎖不觸發流程」在現有程式上斷言失敗；「文字訊息觸發「收到訊息」流程」是既有行為，以突變驗證：`canvasEventTypeOf()` 的一般訊息改回傳 `contentType` 時失敗
- [x] 4.2 `triggerWebhookFlow()` 以 `canvasEventTypeOf()` 推導事件類型，unfollow 不觸發（D5）

## 5. 聯絡人詳情顯示封鎖狀態

- [x] 5.1 測試 `apps/web/tests/unit/app/contact-detail-blocked.test.tsx`（從聯絡人詳情頁渲染，API 回應到清單的欄位對應一起測）：「顧客封鎖了其中一個官方帳號」在現有程式上斷言失敗；「顧客重新加入好友後不再顯示」在現有程式上本來就不顯示，以突變驗證：徽章改成一律顯示時兩個都失敗；另外拿掉頁面傳入的 `blockedAt` 時第一個失敗
- [x] 5.2 `ChannelIdentityList` 顯示「已封鎖官方帳號」；`ContactDetail` 與聯絡人詳情頁傳入 `blockedAt`
- [x] 5.3 `GET /api/v1/contacts/:id` 帶 `blockedAt`：`getContact()` 以 include 取整列渠道身分，已包含，不需修改；`line-system-events.test.ts`「Unfollow event records the block」以 `getContact()` 斷言

## 6. 完成定義

- [x] 6.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test`、`pnpm --filter @open333crm/channel-plugins test`
- [x] 6.2 feature：`modules/webhook/` 全部（獨立測試庫 `open333crm_test_362line`）
- [x] 6.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`
- [x] 6.4 `node scripts/validate-openspec.mjs fix-line-follow-unfollow-events` 與 `--specs`
- [x] 6.5 `pnpm build`
- [x] 6.6 `CHANGELOG.md` 條目（由整合 #362 的人統一撰寫）
- [ ] 6.7 歸檔
