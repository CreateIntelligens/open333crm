# Proposal

## Why

#430 讓分店帳號的群發只能用看得到的渠道，分群預覽也只算看得到的聯絡人。但實際送出分群群發時，`resolveAudience()` 以 `ALL_CHANNELS` 計算分群：「有 FB 帳號」這類條件會用到其他分店渠道的身分。分店成員對自己的 WebChat 渠道建立「有 FB 帳號」的群發，送出後從收件人數就能推測自己的客人在其他分店的渠道有沒有帳號；預估人數與實際送出的人數也不一致（PR #430 code review）。

## What Changes

- 分群群發的條件以群發**建立者**的可見範圍判斷：總店（`channel.view_all`）照舊以所有渠道判斷，分店只以自己看得到的渠道判斷。收件人仍以群發渠道的身分限定。
- 送出時依建立者判斷，不依按下送出的人：排程器與附券廣播在背景送出，沒有當下操作的人。建立者的權限比照 guard：角色權限 ∩ 方案天花板；成員不存在時視為沒有可見渠道。
- 預估人數（`/marketing/broadcasts/audience-preview`、券詳情頁的批次發放預覽）與批次發放建立時的人數檢查，以操作的人的可見範圍判斷，與之後送出時一致。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `broadcast-audience`：新增「分群條件依群發建立者的可見範圍判斷」。

## Impact

- API：`apps/api/src/services/channel-visibility.ts`（`resolveAgentChannelVisibility()`、`agentVisibilityResolver()`）、`modules/marketing/marketing.service.ts`（`resolveAudience()`、`executeBroadcast()`、`previewBroadcastAudience()`）、`broadcast-coupon.service.ts`、`broadcast-coupon.flow.ts`、`broadcast.scheduler.ts`、`marketing.routes.ts`、`coupon/coupon.flow.ts`、`coupon.routes.ts`、`mcp/mcp.server.ts`、`index.ts`。
- 沒有 API 合約與資料庫變更。
