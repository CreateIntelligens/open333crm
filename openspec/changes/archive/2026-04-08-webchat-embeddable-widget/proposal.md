## Why

Currently the `WEBCHAT` channel type exists in the schema and `WebchatPlugin` is registered, but the widget (`apps/widget/`) is an empty stub and visitors have no way to initiate a conversation — meaning no webchat conversation will ever appear in the inbox. This change builds the full end-to-end embedded chat experience for anonymous visitors.

## What Changes

- **New**: `apps/widget/` built into a production JS bundle (`widget.js`) served as a static asset by the API at `GET /webchat/widget.js` (IIFE embed for general websites)
- **New**: `packages/webchat-sdk/` — npm-publishable ES module SDK (`@open333crm/webchat-sdk`) for customers using React/Vue/SPA frameworks; wraps the same session + socket logic with TypeScript types and a `createWebchatWidget()` entry point; shares core logic with `apps/widget/` via `packages/webchat-sdk/src/core/`
- **New**: Visitor session API — `POST /api/v1/webchat/:channelId/sessions` — issues a `visitorToken` (UUID) and returns greeting + conversation history for returning visitors
- **New**: Visitor Socket.IO namespace `/visitor` (separate from agent namespace `/`) — anonymous auth via `visitorToken` + `channelId`; supports `visitor:message` (send) and `agent:message` (receive) events
- **New**: Visitor room mapping — widget joins `visitor:${visitorToken}`; outbound messages from agents/bots are emitted to this room by `conversation.service.ts`
- **Fix**: `WebchatPlugin.sendMessage` currently only `console.log`s; real delivery is wired through Socket.IO emit in the conversation service so visitor receives agent replies in real time
- **New**: `apps/api/src/modules/webchat/` module — session service, Socket.IO namespace handler, routes
- Existing `webchat-embed.service.ts` (embed code generator) and `channel.routes.ts` embed endpoint are retained as-is

## Capabilities

### New Capabilities
- `webchat-widget`: Embeddable chat widget JS bundle (IIFE), visitor session lifecycle (anonymous identity via localStorage UUID), real-time bidirectional messaging over Socket.IO, welcome message, conversation history for returning visitors; plus npm SDK (`@open333crm/webchat-sdk`) with ES module build + TypeScript types for SPA customers

### Modified Capabilities
- `channel-plugins`: `WebchatPlugin.sendMessage` behaviour changes — from no-op console.log to actual delivery via Socket.IO emit (delivery is delegated to `conversation.service.ts` which already holds the `io` reference)

## Impact

- `apps/widget/src/` — implement full widget UI + Socket.IO client logic
- `apps/api/src/modules/webchat/` — new module: `webchat.routes.ts`, `webchat.service.ts`, `webchat.socket.ts`
- `apps/api/src/plugins/socket.plugin.ts` — add `/visitor` namespace registration (or delegate to `webchat.socket.ts`)
- `apps/api/src/modules/conversation/conversation.service.ts` — emit `agent:message` to `visitor:${visitorToken}` room when delivering outbound webchat message
- `packages/channel-plugins/src/webchat/index.ts` — `sendMessage` updated to return a proper `channelMsgId`; actual push is handled upstream
- `apps/api/src/index.ts` — serve `apps/widget/dist/widget.js` as static file at `/webchat/widget.js`
- `packages/webchat-sdk/` — new package: `@open333crm/webchat-sdk`; ESM + CJS + `.d.ts`; shares `core/` logic with `apps/widget/`
- No DB migrations required (existing Channel, ChannelIdentity, Contact, Conversation, Message models cover all needs)
- No new npm packages required (`socket.io-client` already in `apps/widget/`)
