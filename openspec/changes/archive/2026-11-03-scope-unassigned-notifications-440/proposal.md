## Why

PR #440 審查發現：未指派對話的「轉接真人」通知（#419 新增）發給所有啟用中的主管與管理員，不看渠道可見範圍。只看得到分店渠道的主管會收到其他分店客人的名稱與轉接原因，點進去才 404。未指派對話的「收到新訊息」通知原本就有同樣的問題（AUDIT RBAC-04，HC-NOTIFICATIONS-01），轉接通知照用同一段收件人邏輯。

## What Changes

- 未指派對話的 `conversation_handoff` 與 `new_message` 通知，只發給看得到該對話渠道的啟用中主管與管理員（持有 `channel.view_all` 或被授權該渠道）。可見範圍用與 socket、群發相同的 `resolveAgentChannelVisibility()`。
- 已指派對話的通知不變：只通知負責的客服。指派給看不到渠道的成員另見 AUDIT CONV-06。

## Capabilities

### Modified Capabilities
- `bot-handoff-config`：「轉接真人時通知客服」的未指派收件人加上渠道可見範圍
- `channel-scoped-visibility`：新增「未指派對話的通知只發給看得到渠道的人」

## Impact

- `apps/api/src/modules/notification/notification.worker.ts`：`setupNotificationWorker(prisma, { visibility })`，預設 `agentVisibilityResolver(prisma)`
- 每則未指派對話的通知多查各主管與管理員的可見渠道（權限有 Redis 快取）
