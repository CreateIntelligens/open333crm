## Context

**Inbound media — already working for both channels:**
- **LINE**: The LINE plugin distinguishes two content providers. When `contentProvider.type === 'external'`, the webhook contains `originalContentUrl` directly. When `contentProvider.type === 'line'` (user camera/upload), only a `contentId` is present and `downloadAndStoreLineMedia` is triggered in `webhook.service.ts`. Both paths are already implemented correctly — no changes needed.
- **FB**: The webhook always embeds a direct CDN URL in `attachment.payload.url`. The FB plugin already parses this into `content.url` and stores it in `Message.content` as-is. No download/storage step is needed.

**Outbound media — missing:**
- `POST /:id/send-image` returns HTTP 501 for non-LINE channels.
- There is no `send-video` endpoint.
- `FbPlugin.buildFbMessage` already handles `image` and `video` content types correctly (uses `attachment.payload.url`).

## Goals / Non-Goals

**Goals:**
- Enable `POST /:id/send-image` for FB conversations (remove 501 guard)
- Add `POST /:id/send-video` supporting both LINE and FB

**Non-Goals:**
- Inbound media changes for LINE or FB (already correct)
- Frontend changes (existing message rendering handles `url` field already)
- Webchat media support (separate concern)

## Decisions

### Outbound image: remove channel guard

`send-image` currently has `if (channelType !== 'LINE') return 501`. Change to `!['LINE', 'FB'].includes(channelType)`. No other logic changes — both plugins read `content.url` / `content.mediaUrl` which are already set by the route.

### Outbound video: new `send-video` route

Pattern mirrors `send-image`:
1. Accept multipart file (`video/mp4`, `video/quicktime`; max 25 MB — FB Graph API hard limit)
2. Upload to S3 via `uploadFile`
3. Call `sendMessage` with `contentType: 'video'`, `content: { url, mediaUrl, text: '[影片]', storageKey }`
4. Support `LINE` and `FB`; return 501 for other channel types

LINE video requires `previewImageUrl` in the LINE Messaging API call. `buildLineMessage` falls back to `content.mediaUrl` when `content.previewUrl` is absent, so passing the S3 video URL as both `url` and `mediaUrl` satisfies this without a separate thumbnail upload.

## Risks / Trade-offs

- **LINE video preview**: Using the video URL as `previewImageUrl` may not render a proper thumbnail on all LINE clients. Acceptable trade-off; a dedicated thumbnail upload can be added later.
- **25 MB FB video limit**: The Graph API rejects larger videos. Enforced at the route level before upload.
