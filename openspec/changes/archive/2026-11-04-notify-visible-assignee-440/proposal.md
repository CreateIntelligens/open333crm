## Why

對話已指派時，「收到新訊息」與「轉接真人」通知直接發給負責客服，不檢查這位客服現在是否仍啟用、是否仍看得到這個渠道。管理員拿掉客服的渠道權限、但沒有改指派時，這位客服會繼續收到客人名稱與轉接原因（PR #440 第五輪審查）。

## What Changes

- 已指派對話的通知，只在負責客服仍啟用、且看得到該渠道時發給他。
- 負責客服不符合時，通知改發給看得到該渠道的啟用中主管與管理員，與未指派對話相同，訊息不會沒人知道。
- 可見範圍用與未指派通知相同的判斷（`resolveAgentChannelVisibility`）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `channel-scoped-visibility`：新增「已指派對話的通知只發給看得到渠道的負責客服」。
- `bot-handoff-config`：「轉接真人時通知客服」的已指派分支加上同樣的條件。

## Impact

- `apps/api/src/modules/notification/notification.worker.ts` 的 `message.received` 與 `conversation.handoff`。
- 不影響 `conversation.assigned`（指派當下才發的「對話已指派給您」）與工單通知。
