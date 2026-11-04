## 1. 共用的推送渠道清單

- [x] 1.1 測試 `packages/shared/tests/unit/channel-push.test.ts`：LINE、FB、THREADS 可以推送，WEBCHAT 不行
- [x] 1.2 新增 `packages/shared/src/constants/channel-push.ts`，匯出 `PROACTIVE_PUSH_CHANNEL_TYPES` 與 `supportsProactivePush()`

## 2. 後端拒絕不能推送的渠道

- [x] 2.1 測試 `apps/api/tests/unit/modules/marketing/broadcast-push-channel.test.ts`：「建立網站聊天室的群發」「送出網站聊天室的舊草稿」「送出網站聊天室的附券廣播」「排程到期的網站聊天室附券廣播」「LINE 群發不受影響」，在現有程式上斷言失敗
- [x] 2.2 測試 `apps/api/tests/feature/modules/coupon/coupon-batch-issue.test.ts`：「選網站聊天室渠道發券」「排程到期的網站聊天室附券廣播」（真資料庫執行 `runCouponBroadcast()`），在現有程式上斷言失敗
- [x] 2.3 既有測試的假資料改用能主動推送的渠道：`broadcast-messaging-window.test.ts` 的假渠道 `LINE_TEST` 改 `THREADS`、`broadcast-coupon-immediate-run.test.ts` 的 mock 加 `channel.findFirst`、`channel-scoped-visibility.test.ts` 的群發改用可見的 LINE 渠道（原本借用 WebChat 渠道建立群發，這個 change 起回 400）
- [x] 2.4 `createBroadcast()`、`executeBroadcast()`、`queueCouponBroadcast()`、`claimCouponBroadcast()` 加上檢查（design D2）

## 3. 群發頁的渠道選單

- [x] 3.1 測試 `apps/web/tests/unit/lib/marketing/push-channels.test.ts`：「群發頁的渠道選單」，在現有程式上失敗（`activePushChannels` 不存在）
- [x] 3.2 群發頁與券詳情「發送給…」的渠道選單改用 `activePushChannels()`；移除 `COUPON_PUSH_CHANNEL_TYPES`

## 4. 文件

- [x] 4.1 更新 `docs/ref/features/tenant/MARKETING.md`、`docs/ref/modules/CHANNEL-PLUGINS.md`、`docs/ref/features/health/MARKETING.md`、`.claude/skills/feature-marketing`、`feature-channels` 描述到的行為

## 5. 完成定義

- [x] 5.1 `pnpm test`（shared、api、web、workers）
- [x] 5.2 相關 feature 測試（`coupon-batch-issue.test.ts`、`broadcast-coupon.test.ts`）
- [x] 5.3 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict`、`check-tenant-ctx` 通過
- [x] 5.4 CHANGELOG、AUDIT CHAN-02、AUDIT-REVIEWS 的條目交由使用者寫入（這次不改這三個檔案，條目文字附在回報）
- [x] 5.5 `node scripts/validate-openspec.mjs reject-webchat-push-415` 通過後歸檔
