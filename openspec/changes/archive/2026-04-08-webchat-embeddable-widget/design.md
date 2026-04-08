## Context

The `WEBCHAT` channel type is fully scaffolded in the DB schema and plugin registry, but `apps/widget/src/index.ts` is an empty stub and there is no visitor-facing Socket.IO namespace. The existing agent Socket.IO namespace (`/`) requires a signed JWT — unsuitable for anonymous website visitors.

The API already holds a `SocketIOServer` instance (`fastify.io`) and passes it through to `processInboundMessage`. The `processWebhookEvent` pipeline (verify → parse → contact → conversation → message → emit) is reused; webchat inbound messages enter via a dedicated HTTP endpoint instead of a LINE/FB webhook.

## Goals / Non-Goals

**Goals:**
- Anonymous visitor identity: UUID generated on first visit, persisted in `localStorage`
- Widget JS bundle served from `GET /webchat/widget.js`
- Visitor session API: `POST /api/v1/webchat/:channelId/sessions` → `visitorToken` + greeting + history
- Real-time bidirectional messaging: visitor ↔ agent/bot over Socket.IO namespace `/visitor`
- Agent/bot outbound messages delivered to visitor in real time
- Conversation appears in inbox identically to LINE/FB messages

- Build npm SDK `packages/webchat-sdk/` (ESM + CJS + types)

**Non-Goals:**
- Visitor login / account linking (deferred — see identity-stitching-engine spec)
- File/image upload from visitor (deferred)
- Custom widget theming via channel settings (deferred)
- Read receipts / typing indicators (deferred)
- Offline message queuing (deferred)

## Decisions

### 1. Visitor identity: UUID in localStorage (no cookie, no login)
**Decision**: Generate a `visitorToken` (UUID v4) on first widget load. Store in `localStorage` under `open333crm_visitor`. Pass this as `contactUid` in all messages.

**Why**: No member login is assumed. `localStorage` survives page reloads and tab closes on the same browser/device — adequate for continuity without accounts. Cookies have cross-origin complications for embedded iframes.

**Alternative considered**: Session cookie (httpOnly) — rejected because the widget runs in the customer's domain context, making cross-origin cookie sharing complex.

### 2. Separate Socket.IO namespace `/visitor` (not reusing `/`)
**Decision**: Create a `/visitor` Socket.IO namespace. Auth middleware validates `visitorToken` (non-empty UUID format) + `channelId` (must exist in DB). No JWT required.

**Why**: Reusing the agent namespace would require bypassing JWT auth for visitors, widening the security surface. A separate namespace has its own middleware and event set, keeping agent and visitor concerns isolated.

**Security note**: `visitorToken` is not a secret — it's equivalent to a session ID. Anyone who obtains a token can impersonate that visitor's conversation. This is acceptable for anonymous chat (no PII beyond the conversation content itself). Future identity linking can be added on top.

### 3. Inbound message flow: dedicated HTTP endpoint, not raw webhook
**Decision**: Widget sends messages via `POST /api/v1/webchat/:channelId/messages` (JSON body) rather than connecting to the existing `/api/v1/webhooks/webchat/:channelId` endpoint.

**Why**: The webhook endpoint is designed for platform-push (LINE, FB server → our server) and passes a `Buffer` through the plugin's `parseWebhook`. The webchat widget is our own client — a REST call with a validated JSON body is cleaner and avoids raw body gymnastics. The service layer (`processWebhookEvent`) is still called after constructing a synthetic `ParsedWebhookMessage`.

**Alternative considered**: Socket.IO-only (emit event, no HTTP for inbound) — rejected to keep inbound message persistence synchronous and return a proper HTTP error to the widget on failure.

### 4. Outbound delivery: `conversation.service.ts` emits to visitor room
**Decision**: When `conversation.service.ts` creates an outbound message for a WEBCHAT channel, it emits `agent:message` to `visitor:${channel.id}:${contactUid}` Socket.IO room (visitor namespace). Including `channelId` in the room key ensures cross-tenant isolation — two visitors from different tenants who happen to share the same UUID cannot receive each other's messages. `WebchatPlugin.sendMessage` remains a no-op (returns success) — the actual push happens in the service layer which already holds `io`.

**Why**: `ChannelPlugin.sendMessage` receives `credentials` but not `io`. Injecting Socket.IO into the plugin breaks the plugin interface contract. The conversation service already emits `message.new` to the agent room — extending it for the visitor room is the minimal change.

**Alternative considered**: Pass `io` into plugin via credentials map — rejected: credentials should be channel secrets, not infrastructure references.

### 5. Widget build: Vite IIFE bundle, served as static file by Fastify
**Decision**: `apps/widget/` builds to `dist/widget.js` as an IIFE (no ES modules) using Vite `lib` mode. The API serves this file from `GET /webchat/widget.js` via `@fastify/static` (already a dependency for other static assets).

**Why**: IIFE is the universal embed pattern — customers paste one `<script>` tag, no bundler required. The widget must not conflict with the host page's JS environment.

### 6. Shared core: `packages/webchat-sdk/src/core/` used by both widget and SDK
**Decision**: Extract session init, socket client, and message sending into `packages/webchat-sdk/src/core/` (framework-agnostic TypeScript). `apps/widget/src/` imports from this core and adds DOM UI. `packages/webchat-sdk/` re-exports core as the public npm API with `createWebchatWidget()`.

**Why**: Avoids duplicating the networking logic. Widget gets DOM-attached UI; SDK gets headless API. Both built from the same source.

**SDK exports:**
```ts
// @open333crm/webchat-sdk
export function createWebchatWidget(options: {
  channelId: string;
  apiUrl: string;
  visitorToken?: string; // override localStorage
}): WebchatWidget

interface WebchatWidget {
  on(event: 'message', cb: (msg: Message) => void): void;
  send(text: string): Promise<void>;
  getHistory(): Message[];
  destroy(): void;
}
```

**Build targets:**
- `packages/webchat-sdk/` → `tsup` → `dist/index.js` (ESM) + `dist/index.cjs` (CJS) + `dist/index.d.ts`
- `apps/widget/` → Vite IIFE → `dist/widget.js` (imports core via workspace dep)



- **`visitorToken` theft** → An attacker who reads `localStorage` can inject messages into that visitor's conversation. Mitigation: acceptable for anonymous chat; add HMAC signing in future if sensitive use cases emerge.
- **Socket.IO reconnection** → If the visitor disconnects and reconnects, they rejoin `visitor:${visitorToken}` automatically. Messages sent while offline are not delivered retroactively — but the widget can fetch history via the session API on reconnect.
- **Widget bundle size** → `socket.io-client` adds ~40KB gzipped. Mitigation: Vite tree-shaking; acceptable for a support widget.
- **Multiple tabs** → Two tabs with the same `visitorToken` both connect to the visitor room; both receive messages. This is fine — same visitor, same conversation.
