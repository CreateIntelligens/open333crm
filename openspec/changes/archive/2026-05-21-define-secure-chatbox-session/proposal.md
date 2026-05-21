## Why

The current WebChat widget uses a client-generated visitor token and creates conversations from visitor messages, which is appropriate for embedded widgets but too weak for a fixed public chatbox route that must survive refresh, expire predictably, and detect leaked session URLs. We need a secure `/chatbox` session model that creates a new conversation per issued session while preventing visitors from reading server-side history.

## What Changes

- Add a fixed public chatbox route, such as `/chatbox`, that creates or verifies a signed `sessionId` and redirects invalid or missing sessions into a valid session URL.
- Introduce server-side `ChatboxSession` records with token digest storage, expiry, weak fingerprint binding, risk state, and a linked WEBCHAT conversation.
- Create a new conversation when a new chatbox session is issued; refresh with the same valid `sessionId` continues the same conversation without replaying history to the visitor client.
- Add a unified WebChat message input/output contract with server timestamps, stable ordering rules, `clientMessageId` idempotency, and typed payloads for text, image, video, file, emoji, and system messages.
- Add admin-managed chatbox theme settings so agents can upload or select a tenant-owned background image for public chatbox pages.
- Add Fastify decorator extension points for message type handlers, chatbox session verification, and locale/i18n behavior.
- Reuse the existing ChannelPlugin abstraction where chatbox messages need to enter shared channel/inbox semantics, without changing the current `WebchatPlugin` contract or embedded-widget behavior.
- Preserve the existing embeddable widget behavior unless the `/chatbox` route or chatbox APIs are explicitly used.

## Capabilities

### New Capabilities

- `webchat-secure-session`: Public `/chatbox` route, signed sessionId lifecycle, fingerprint checks, expiry, and conversation creation per issued session.
- `webchat-message-contract`: Shared visitor/agent message input and output format, idempotency, timestamps, ordering, and extensible message types.
- `webchat-admin-theme`: Admin-managed WebChat/chatbox theme settings, including tenant-owned background image upload and public-safe theme exposure.
- `webchat-extension-registry`: Fastify decorator-based registries for chatbox session verification, message type parsing/serialization, and i18n.

### Modified Capabilities

- `webchat-widget`: Clarify that existing embedded widget sessions remain visitor-token based, while chatbox mode uses `sessionId` and does not expose server-side history to the visitor client.

## Impact

- `apps/web`: Add the public `/chatbox` page and session redirect/verification bootstrap behavior.
- `apps/widget`: Support a chatbox bootstrap mode that uses `sessionId`, typed message contracts, server timestamps, and no history replay.
- `apps/api`: Add chatbox session APIs, session verification, message/media APIs, Fastify decorators, rate limits, and background theme config responses.
- `packages/database`: Add `ChatboxSession` and any idempotency or message sequencing fields required for stable ordering and replay protection.
- `packages/shared`: Add shared TypeScript types for WebChat message input/output, payload discriminators, and chatbox config.
- `packages/channel-plugins`: Reuse the existing ChannelPlugin boundary and registry semantics; do not change `WebchatPlugin.sendMessage` behavior or its current no-socket-delivery responsibility.
- `storage-layer`: Reuse tenant-owned storage for chatbox background assets and existing visitor media uploads.
- Socket.IO: Authenticate visitor sockets with verified `sessionId` for chatbox sessions and continue using tenant/channel isolated visitor rooms.
