## Why

LINE reply tokens are only useful during the short webhook reply window, while Agent research and asynchronous automation can finish later. The current system has reply and push strategies but no unified timeout-aware fallback, so a late or failed reply can be lost.

## What Changes

- Add a shared SafeReply delivery policy for API and worker outbound messages.
- Attempt LINE reply only while the 30-second safety window is still valid.
- Automatically use LINE push when the window has elapsed or reply fails.
- Carry the original inbound timestamp and reply token through Agent, KB, and keyword automation paths.
- Preserve existing behavior for non-LINE channels and normal push messages.
- Add tests and update `CHANGELOG.md`.

## Capabilities

### New Capabilities

- `line-safe-reply`: Timeout-aware LINE reply/push selection and fallback delivery.

### Modified Capabilities

- None.

## Impact

- API conversation delivery, Agent/KB auto-reply, webhook event payloads.
- Worker automation delivery and LINE plugin payload selection.
- No database migration or new external dependency.
