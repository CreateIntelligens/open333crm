## Why

The agent `send-image` route returns HTTP 501 for FB conversations, and there is no `send-video` route at all. FB and LINE inbound media already arrive with usable URLs — FB always embeds a direct CDN URL in the webhook payload, and LINE's plugin already handles both cases (external URL vs content-ID download). No inbound storage changes are needed; only outbound delivery is missing.

## What Changes

- **Modified** `conversation.routes.ts` — remove the LINE-only 501 guard from `POST /:id/send-image`; also support FB
- **New** `POST /:id/send-video` route — upload video to S3 and deliver outbound via plugin for both LINE and FB

## Capabilities

### New Capabilities

- `fb-chat-media`: Outbound image/video delivery from agents is supported for FB conversations via `send-image` and the new `send-video` endpoint

### Modified Capabilities

- `line-messaging`: `send-image` route guard relaxed to include FB; `send-video` route added (also benefits LINE)

## Impact

- `packages/channel-plugins/src/facebook/index.ts` — `buildFbMessage` already handles `image`/`video` with `attachment.payload.url`; no changes required
- `apps/api/src/modules/webhook/webhook.service.ts` — no changes required; FB inbound URL is already stored in `Message.content.url` directly from the webhook payload
- `apps/api/src/modules/conversation/conversation.routes.ts` — channel guard change + new route
- No DB schema changes; `Message.content` JSON already stores `url` / `storageKey`
- No new dependencies
