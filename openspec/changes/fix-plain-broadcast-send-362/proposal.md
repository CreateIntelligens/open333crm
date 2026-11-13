## Why

Issue #362 的群發部分。附券廣播已經在背景發送、發送前查 LINE 訊息額度、每位收件人的原因寫進 `BroadcastRecipient.skipReason`、
排程以 `inTenant()` 執行；一般群發（不附券）都還沒有：

1. 一般群發不查訊息額度。LINE 額度不夠時照樣送，送到一半被 LINE 拒收，結果是部分人收到、部分人失敗。
2. 排程器以 `prismaAdmin`（BYPASSRLS）直接執行 `executeBroadcast()`，`executeBroadcast()` 讀廣播時 `where` 只有 `id`，沒有 `tenantId`。
   排程也沒有 `withoutOverlapping`：一期跑超過 60 秒時，下一期會同時開始。
3. 一般群發每位收件人失敗時只寫 `deliveryStatus = failed`，沒有原因；逐人送出時只記第一個錯誤，而且只有全部失敗才寫進 `failureReason`。
   前端的結果按鈕只給附券廣播，一般群發看不到哪些人失敗。
4. 「立即發送」在 HTTP 請求內同步送完整份名單，名單大時請求逾時，前端看到錯誤但訊息其實還在送。
5. 附券廣播的名額確認（C3）：受眾預估還沒回來、或預估失敗時，名額警示是空的，「建立」按鈕可以按，管理者沒看到名額不足就建立了。

## What Changes

- 附券廣播的額度檢查抽成共用函式（`broadcast-quota.ts`），一般群發找完受眾、發送前也呼叫。只對渠道外掛有
  `extensions.analytics.getMessageQuota` 的渠道檢查（依外掛能力，不判斷渠道類型）。額度不足或查不到時整則不送，廣播標失敗，
  `failureCode` 與附券廣播相同：`LINE_QUOTA_INSUFFICIENT`、`LINE_QUOTA_CHECK_FAILED`。
- 一般群發失敗時也寫 `failureCode`（`AppError` 的 code，其他錯誤 `UNEXPECTED_ERROR`），與附券廣播一致；開始發送時清掉。
- 排程器跨租戶只查到期清單（`id`、`tenantId`），每一則交給與佇列 job 相同的執行函式：租戶停用檢查 → 發送權限重驗 → 發送。
  一般群發以綁定租戶的連線（`tenantScopedClient()`，每個查詢各自 `withTenant()`）執行；`executeBroadcast()` 讀廣播帶 `tenantId`。
  排程加上 `withoutOverlapping`。
- 一般群發每位收件人送不出時，收件紀錄寫 `skipReason = 'DELIVERY_FAILED'`（與附券廣播同一個代碼）；LINE multicast 整批失敗時，
  整批收件人共用這個原因。重新發送時更新既有收件紀錄的狀態與原因。
- 前端：所有已發送、發送中或失敗的廣播都有結果按鈕；一般群發的結果顯示成功、失敗、略過人數與失敗的收件人和原因。
- 「立即發送」一般群發改成排入背景發送：與附券廣播相同，路由把廣播設為 `scheduled`、排程時間為現在、`scheduledById` 為按下的人，
  同一個交易在 outbox 寫一個 `coupon-broadcast` job，回 **202** `{ id, status: 'scheduled', scheduledAt }`。job 與排程器只搶「已排程且時間已到」
  的廣播，誰先搶到誰發送；發送失敗後 job 重試搶不到，不會重送。
- 修正前建立的網站聊天室一般群發：按下送出仍回 400 `CHANNEL_PUSH_NOT_SUPPORTED` 並把廣播標為失敗。
- C3：建立附券廣播時，受眾預估還沒完成或失敗，「建立」按鈕停用；失敗時顯示原因與「重試」按鈕。

### API 回應的改變

`POST /api/v1/marketing/broadcasts/:id/send` 對一般群發的回應：

| | 修正前 | 修正後 |
| --- | --- | --- |
| 成功 | 200 `{ total, success, failed, skipped }`（送完才回應） | 202 `{ id, status: 'scheduled', scheduledAt }`（排入就回應） |
| 受眾為空、額度不足、憑證解不開等發送時的錯誤 | 400，`error.code` 為原因代碼 | 202；結果寫在廣播的 `status = failed`、`failureCode`、`failureReason` |
| 已在發送中 | 409 `BROADCAST_ALREADY_SENDING` | 不變 |
| 網站聊天室 | 400 `CHANNEL_PUSH_NOT_SUPPORTED`，廣播標失敗 | 不變 |

MCP 工具 `crm_line_broadcast_initiate` 仍同步呼叫 `executeBroadcast()`，回應不變（只改傳入 `tenantId`）；CLI 沒有呼叫發送 API。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `broadcast-audience`：修改「A Broadcast Is Sent Once At A Time」（立即發送改排入背景，job 與排程只搶已排程的廣播）；
  新增「立即發送的一般群發在背景執行」「一般群發發送前檢查訊息額度」「附券廣播在名額預估完成前不能建立」。
- `broadcast-failure-reason`：新增「一般群發記錄每位收件人的失敗原因」「所有廣播都可以查看收件人結果」。
- `marketing-scheduling`：修改「The Scheduler Rechecks The Scheduling Member's Permissions」「The Scheduler Does Not Send Broadcasts Of A Disabled Tenant」
  （佇列 job 也執行一般群發）；新增「排程器以綁定租戶的連線發送且兩期不重疊」。

open change `fix-coupon-broadcast-immediate-run` 修改 `coupon-management`；本 change 不動 `coupon-management`，兩者歸檔沒有先後限制。

## Platform layer

沒有適用的項目：不新增權限碼、功能模組、方案上限、AI 呼叫、渠道類型或平台設定；一般群發沿用既有的 `coupon-broadcast` 佇列，
不新增 BullMQ 佇列（佇列監控已列入這個佇列）。

## Impact

- `apps/api/src/modules/marketing/marketing.service.ts`（`executeBroadcast()`）、`broadcast-quota.ts`（新）、`broadcast-coupon.flow.ts`、
  `broadcast-coupon.service.ts`（`queueBroadcast()`）、`broadcast-coupon.worker.ts`、`broadcast.scheduler.ts`、`marketing.routes.ts`、
  `apps/api/src/modules/mcp/mcp.server.ts`（呼叫簽名）
- `apps/web/src/app/dashboard/marketing/page.tsx`、`apps/web/src/components/marketing/BroadcastCouponResult.tsx`
- 文件：`docs/ref/features/tenant/MARKETING.md`、`docs/ref/system/AUDIT.md`（MKT-01）、`.claude/skills/feature-marketing/SKILL.md`
