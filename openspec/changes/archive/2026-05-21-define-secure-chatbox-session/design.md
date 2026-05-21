## Context

The current WebChat implementation has two public visitor entry styles:

- Embedded widget: visitor identity is a UUID stored in `sessionStorage` as `open333crm_visitor`; session init validates the WEBCHAT channel and returns greeting only.
- Direct open page: the widget can be auto-opened, but conversation creation still follows the SDK behavior unless a message is sent.

The proposed `/chatbox` flow is a different product surface. It needs a URL-carried `sessionId` that can survive refresh, expire, detect likely session leakage, and map to exactly one server-created conversation. The visitor client must not read server-side conversation history; only the backend agent surfaces can read persisted messages.

Existing WebChat media support already uses a two-step upload then message flow, and the inbound message path already converts visitor messages into `ParsedWebhookMessage` records through `processInboundMessage()`. This change should reuse those persistence semantics after chatbox session verification instead of inventing a parallel inbox pipeline.

The existing `ChannelPlugin` interface and `WebchatPlugin` behavior remain part of the boundary. Chatbox can reuse ChannelPlugin registry semantics for WEBCHAT channel normalization and outbound delivery contracts, but it must not change `WebchatPlugin.sendMessage` or make the plugin responsible for Socket.IO delivery.

## Goals / Non-Goals

**Goals:**

- Provide a fixed public `/chatbox` route that creates or verifies a secure `sessionId`.
- Create one new WEBCHAT conversation for every newly issued chatbox session, while refresh with the same valid session continues the same conversation.
- Store only token digests server-side; never store raw `sessionId`.
- Add expiry and weak fingerprint binding to detect likely leaked session URLs.
- Keep visitor bootstrap responses free of conversation history.
- Define a shared message input/output contract with timestamps, ordering, idempotency, and extension-friendly payloads.
- Allow tenant admins to configure a chatbox background image through tenant-owned storage.
- Centralize chatbox extensibility with Fastify decorators for session verification, message type handling, and locale behavior.

**Non-Goals:**

- Do not replace the existing embedded WebChat widget session model.
- Do not change the existing `WebchatPlugin` public contract or current embedded-widget message behavior.
- Do not expose a visitor history API in this change.
- Do not use browser-close callbacks, `beforeunload`, or `sendBeacon` as required lifecycle controls.
- Do not use invasive device fingerprinting such as canvas or WebGL fingerprinting.
- Do not move agent inbox history or message permissions into the public visitor API.

## Decisions

### D1. Use opaque signed session tokens with server-side session rows

The public `sessionId` will be an opaque token with a random component and a server signature. The API stores only a digest of the random component plus server-side metadata such as `expiresAt`, `fingerprintHash`, `conversationId`, and `riskLevel`.

Rationale: a self-describing token containing raw expiry and fingerprint data makes URL leaks more informative and creates more complicated token rotation. A server-side session row gives tighter revocation, expiry changes, and audit control.

Alternative considered: base64url JSON payload containing `{ random, exp, fp }` plus HMAC. This is acceptable cryptographically if signed correctly, but it exposes metadata in the URL and is less flexible for revocation.

### D2. Create a conversation when a chatbox session is issued

`/chatbox` differs from the embedded SDK. A new valid chatbox session creates a new WEBCHAT conversation immediately, and the `ChatboxSession` row stores the `conversationId`. Refreshing the same URL continues that same conversation.

Rationale: the user's required lifecycle is session-first, not message-first. Creating the conversation at session issuance makes the server-side room real before the first visitor message and gives the backend a stable object for agent visibility and future metadata.

Alternative considered: keep SDK behavior and create the conversation only on first message. That was explicitly rejected for this secure chatbox design.

### D3. Keep visitor history unavailable

Chatbox bootstrap and verification responses may include session status, expiry, greeting, display name, and public theme config. They must not include persisted conversation messages.

Rationale: the `sessionId` appears in the URL and may be copied. Even when a copied token passes validation, the visitor API should not provide a read endpoint for historical conversation content. Agent/admin APIs remain the source for server-side history.

### D4. Use weak fingerprint checks as risk controls, not identity proof

Fingerprinting will use coarse normalized client signals such as browser family, OS family, primary language, timezone, and screen bucket. Exact IP, full user-agent, canvas, and WebGL fingerprints are avoided for privacy and stability.

Rationale: fingerprint mismatch can detect obvious token reuse from a different browser context, but it is not reliable enough to be a hard identity system. The first implementation should use conservative strong-mismatch rejection and leave softer risk scoring as a later policy option.

### D5. Introduce a shared message contract and registry

Visitor message APIs and socket events will use a discriminated message contract with `type`, `payload`, `clientMessageId`, `createdAt`, and stable ordering fields. Message type parsing and serialization will be registered through a Fastify decorator instead of scattered conditionals.

Rationale: current `contentType` plus flexible `content` works for text/image/video, but new capabilities such as emoji, files, localized system messages, and richer payloads need a single contract shared by API, widget, and agent UI.

### D5a. Reuse ChannelPlugin boundaries without changing WebchatPlugin

Chatbox should reuse existing channel plugin boundaries where a chatbox message becomes a WEBCHAT channel message or where outbound agent/bot delivery needs to remain consistent with WEBCHAT conversations. The chatbox layer should adapt verified `sessionId` requests into the existing WEBCHAT channel identity/message pipeline; it should not change `WebchatPlugin.sendMessage`, which currently returns success/channel message ids and leaves actual visitor Socket.IO delivery to service-layer code.

Rationale: `ChannelPlugin` already defines channel-level parsing/sending contracts. Reusing that boundary keeps chatbox aligned with the channel architecture, while keeping `WebchatPlugin` stable avoids regressions in existing embedded WebChat and agent outbound flows.

Alternative considered: add chatbox-specific behavior directly inside `WebchatPlugin`. Rejected because it would couple signed session concerns to the generic WEBCHAT plugin and risk changing existing widget behavior.

### D6. Use API process direct socket emits for chatbox session results

When the API creates a chatbox session and conversation, any immediate inbox update is a direct result of the HTTP request and the tenant room is known. Use Path A direct `fastify.io` emit where needed. Background notifications or role-derived side effects remain Path B via BullMQ/workers.

Rationale: session creation is synchronous and tied to the current HTTP request. Using eventBus alone would not guarantee immediate dashboard refresh and would mix direct request results with background side effects.

### D7. Store theme config on the WEBCHAT channel

The chatbox background image and display theme should live under channel settings and reference tenant-owned storage assets. Public config responses expose only sanitized, public-safe values.

Rationale: WebChat channel settings are already the owner of welcome message and chat channel config. Keeping theme there avoids a separate theme ownership model for the first iteration.

## Risks / Trade-offs

- [Risk] A copied URL may still be usable if fingerprint is similar. -> Mitigation: use short expiry, token digest storage, strong-mismatch rejection, and rate limits.
- [Risk] Strict fingerprint checks may block legitimate users after browser or device changes. -> Mitigation: use coarse signals and only reject strong mismatch; allow future policy tuning.
- [Risk] Creating conversations on session creation may create empty rooms. -> Mitigation: distinguish chatbox source metadata and keep unread count at zero until real inbound messages arrive.
- [Risk] Not replaying history after refresh can surprise visitors. -> Mitigation: treat this as a deliberate security boundary and keep the input usable for continuing the same server-side conversation.
- [Risk] Message contract migration may touch multiple UI/API surfaces. -> Mitigation: introduce shared types first, keep compatibility adapters for current `contentType/content` storage, and migrate route by route.
- [Risk] Reusing ChannelPlugin incorrectly could change existing WebchatPlugin behavior. -> Mitigation: add adapter code around chatbox verification and message normalization, keep `WebchatPlugin` contract unchanged, and test embedded widget flows.
- [Risk] Background images may leak tenant assets if arbitrary URLs are allowed. -> Mitigation: only allow tenant-owned storage assets and return sanitized asset URLs in public config.

## Migration Plan

1. Add shared chatbox/session/message contract types without changing existing WebChat routes.
2. Add database migration for `ChatboxSession` and any idempotency or sequencing fields needed for messages.
3. Add Fastify decorators for session verification, message type registry, and i18n.
4. Add chatbox-to-WEBCHAT adapter code that reuses ChannelPlugin boundaries without modifying `WebchatPlugin`.
5. Add chatbox APIs and public `/chatbox` page behind the new route.
6. Add background image upload/settings in the admin channel UI.
7. Add tests for session creation, refresh reuse, expiry, fingerprint mismatch, no-history bootstrap, message ordering, ChannelPlugin compatibility, and media/message compatibility.
8. Keep existing embed widget routes working during rollout.

Rollback strategy: disable or hide `/chatbox` routing and leave existing `/webchat/*` widget endpoints intact. Chatbox conversations already created remain normal WEBCHAT conversations in the inbox.

## Open Questions

- Should fixed `/chatbox` resolve a single deployment default channel, or require `?channel=<publicKey>`?
- Should strong fingerprint mismatch reject with 403 or revoke the leaked session and issue a new one?
- What is the first expiry policy: fixed TTL only, or fixed TTL plus idle timeout?
- Should empty chatbox conversations appear immediately in inbox, or only after the first visitor message even though the conversation row exists?
- Should message sequence be a new database column now, or should initial sorting use `createdAt, id` until a later sequencing change?
