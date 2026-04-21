## Context

`MessageInput.tsx` currently accepts 5 MIME types (jpeg, png, gif, webp, pdf). The upload flow stores to MinIO and calls `POST /conversations/:id/messages`, but the content shape uses `url` while the LINE plugin's `buildLineMessages` reads `content.mediaUrl`. For LINE to fetch the image, the URL must also be publicly reachable.

## Goals / Non-Goals

**Goals:**
- Restrict frontend file picker to `image/png` only
- New `POST /api/v1/conversations/:conversationId/send-image` endpoint: accepts multipart PNG, uploads to MinIO, persists outbound message, delivers to LINE via existing plugin
- Proper content shape so LINE plugin (`buildLineMessages`) picks up `mediaUrl` correctly
- Non-LINE channels (WEBCHAT, FACEBOOK) return HTTP 501 with TODO body

**Non-Goals:**
- Webchat or Facebook image push implementation
- Video or other media types
- Presigned upload (client-side direct upload to MinIO) — server-side upload only
- Any change to inbound image handling (already implemented)

## Decisions

### D1 — Dedicated `/send-image` route, not overloading existing `/messages`
The existing `POST /messages` accepts arbitrary JSON body. Image upload requires `multipart/form-data`. Mixing both in one endpoint complicates Fastify's multipart plugin configuration and validation. A separate route keeps concerns clean.

### D2 — Reuse `uploadFile()` from storage.service
`uploadFile(buffer, filename, mimeType, tenantId, 'media', conversationId)` already builds a scoped MinIO key and returns `{ url, key }`. No new storage logic needed.

### D3 — Reuse `sendMessage()` from conversation.service
After uploading, call `sendMessage(prisma, io, conversationId, tenantId, { contentType: 'image', content: { url, mediaUrl: url, text: '[圖片]', storageKey: key } })`. This handles DB write, socket emit, and LINE plugin delivery in one call.

### D4 — Content shape
LINE plugin (`buildLineMessages`) reads `content.mediaUrl` for the image URL. The content object stored in DB and sent to the plugin:
```json
{ "url": "<minioPublicUrl>", "mediaUrl": "<minioPublicUrl>", "text": "[圖片]", "storageKey": "<minioKey>" }
```
`storageKey` enables future signed URL generation if needed.

### D5 — 501 for non-LINE channels
The endpoint first resolves the conversation's channel type. If `channel.channelType !== 'LINE'`, respond with 501 and a body `{ code: 'NOT_IMPLEMENTED', message: 'Image push not yet supported for this channel type' }`.

## Risks / Trade-offs

- **MinIO must be publicly accessible** — LINE servers pull the image via the stored URL. Requires `mc anonymous set public local/open333crm` (or equivalent). Documented as prerequisite; not enforced in code.
- **PNG only** — restricts what agents can send. Chosen because LINE supports it well and scoping helps validate the flow before expanding types.
