## Why

Agents need to send images to LINE contacts from the inbox chat window, but the current text-only send path lacks a proper image-upload-then-push flow for LINE. The frontend file picker also accepts too many MIME types, causing confusion about what can actually be delivered.

## What Changes

- **Frontend attachment picker** restricted to `image/png` only (narrows `ACCEPTED_TYPES` constant in `MessageInput.tsx`)
- **New API endpoint** `POST /api/v1/conversations/:conversationId/send-image` — accepts multipart `image/png`, uploads to MinIO, constructs LINE-compatible `mediaUrl`, writes outbound `Message` to DB, and pushes to LINE via the existing channel plugin
- LINE delivery uses the existing `sendMessage()` service path; no new LINE SDK calls needed
- Webchat and Facebook channel types are **not implemented** — endpoint returns 501 with TODO note for those channel types

## Capabilities

### New Capabilities

- `conversation-image-send`: New multipart endpoint for uploading and pushing an image in a conversation; LINE channel only, other channels return 501

### Modified Capabilities

- `core-inbox`: Frontend attachment picker MIME filter changes from multi-type to `image/png` only

## Impact

- `apps/web/src/components/inbox/MessageInput.tsx` — ACCEPTED_TYPES constant
- `apps/api/src/modules/conversation/conversation.routes.ts` — new route added
- `apps/api/src/modules/conversation/conversation.service.ts` — new `sendImageMessage()` function or reuse of `sendMessage()` with validated content shape
- Requires MinIO bucket policy to be set public so LINE servers can fetch the image URL
