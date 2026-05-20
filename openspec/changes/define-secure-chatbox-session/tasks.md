## 1. Shared Contracts and Database

- [ ] 1.1 Add shared chatbox/session/message types in a workspace package for API, web, and widget usage.
- [ ] 1.2 Add `ChatboxSession` Prisma model with tenant, channel, conversation, token digest, fingerprint hash/version, expiry, lastSeen, revokedAt, riskLevel, and timestamps.
- [ ] 1.3 Add any message idempotency or ordering fields needed to support `clientMessageId` and stable message display.
- [ ] 1.4 Create and verify the Prisma migration for chatbox sessions and message contract support.
- [ ] 1.5 Regenerate Prisma client and confirm generated delegates/types are available.

## 2. Security and Session Services

- [ ] 2.1 Implement secure opaque `sessionId` issuance using high-entropy random material and server-side signature or verifier.
- [ ] 2.2 Store only token digests and never persist raw public `sessionId` values.
- [ ] 2.3 Implement normalized fingerprint collection and hashing using coarse browser signals.
- [ ] 2.4 Implement chatbox session verification for signature/digest, expiry, revocation, channel state, and fingerprint policy.
- [ ] 2.5 Implement session creation that creates one new WEBCHAT conversation per newly issued chatbox session.
- [ ] 2.6 Implement refresh reuse so a valid existing `sessionId` continues the same session and conversation without creating duplicates.
- [ ] 2.7 Implement expired, revoked, and strong fingerprint mismatch handling without exposing conversation history.
- [ ] 2.8 Add rate limiting for chatbox session creation, verification, message sending, media upload, and visitor socket connection.

## 3. Fastify Extension Points

- [ ] 3.1 Add Fastify decorator typings for chatbox session verifier, message type registry, and chatbox i18n registry.
- [ ] 3.2 Implement built-in message type handlers for text, image, video, file, emoji, and system payloads.
- [ ] 3.3 Ensure message routes parse and serialize payloads only through registered message type handlers.
- [ ] 3.4 Ensure HTTP routes and Socket.IO auth share the same chatbox session verifier.
- [ ] 3.5 Register built-in handlers and locale behavior during API startup before chatbox routes are registered.
- [ ] 3.6 Add chatbox-to-WEBCHAT adapter code that reuses ChannelPlugin boundaries without modifying `WebchatPlugin`.

## 4. Chatbox Public APIs

- [ ] 4.1 Add public chatbox session create endpoint that resolves channel context and returns a redirect URL with `sessionId`.
- [ ] 4.2 Add public chatbox session verify/bootstrap endpoint returning session expiry, greeting, display name, and safe theme config only.
- [ ] 4.3 Add public chatbox message endpoint using the shared message input contract and `clientMessageId` idempotency.
- [ ] 4.4 Add public chatbox media endpoint using session verification and the existing storage upload constraints.
- [ ] 4.5 Ensure chatbox bootstrap and verify responses never include persisted conversation messages.
- [ ] 4.6 Emit immediate inbox updates from the API process when chatbox session creation creates a conversation, if product behavior requires empty rooms to appear immediately.

## 5. Visitor Socket and Message Delivery

- [ ] 5.1 Extend visitor Socket.IO authentication to accept verified chatbox `sessionId` credentials.
- [ ] 5.2 Join chatbox visitors to a channel/session isolated visitor room.
- [ ] 5.3 Deliver agent and bot outbound messages to chatbox sessions using the shared message output contract.
- [ ] 5.4 Preserve existing visitor-token socket behavior for embedded widgets.
- [ ] 5.5 Ensure invalid, expired, revoked, or fingerprint-mismatched sessions cannot connect to visitor sockets.

## 6. Public Chatbox Frontend

- [ ] 6.1 Add `/chatbox` public route in `apps/web`.
- [ ] 6.2 Implement missing/invalid `sessionId` flow that requests or receives a new session and redirects to the session URL.
- [ ] 6.3 Implement valid session bootstrap with fingerprint data, expiry handling, greeting, and theme config.
- [ ] 6.4 Build chat UI that uses `sessionId` rather than `open333crm_visitor`.
- [ ] 6.5 Ensure refresh continues the same server-side conversation but does not request or render persisted message history.
- [ ] 6.6 Render typed text, image, video, file, emoji, and system messages from the shared output contract.
- [ ] 6.7 Sort displayed messages by sequence when available, otherwise by server timestamp and id.
- [ ] 6.8 Handle expired, revoked, and fingerprint mismatch states with safe visitor-facing copy.

## 7. Admin Theme Configuration

- [ ] 7.1 Add API support for uploading or selecting tenant-owned WEBCHAT chatbox background images.
- [ ] 7.2 Add tenant ownership and RBAC checks for chatbox theme updates.
- [ ] 7.3 Save background image reference and rendering options in WEBCHAT channel settings.
- [ ] 7.4 Return only sanitized public-safe theme values in chatbox bootstrap config.
- [ ] 7.5 Add dashboard controls for configuring and previewing chatbox background image settings.

## 8. Compatibility and Migration

- [ ] 8.1 Preserve existing `/api/v1/webchat/:channelId/sessions`, messages, media, and visitor-token socket behavior for embedded widgets.
- [ ] 8.2 Keep existing `/webchat/widget.js` bundle behavior unchanged unless explicitly booted in chatbox mode.
- [ ] 8.3 Add compatibility adapters from shared message contracts to current `contentType/content` persistence shape where needed.
- [ ] 8.4 Verify `WebchatPlugin.sendMessage` and existing ChannelPlugin registry behavior remain unchanged.
- [ ] 8.5 Document channel resolution for `/chatbox`, including whether the first implementation uses a default channel or `channel` public key query.

## 9. Tests and Verification

- [ ] 9.1 Add backend tests for session issuance, token digest storage, expiry, revocation, refresh reuse, and per-session conversation creation.
- [ ] 9.2 Add backend tests for fingerprint exact match, partial mismatch, and strong mismatch behavior.
- [ ] 9.3 Add backend tests proving visitor bootstrap does not include persisted messages.
- [ ] 9.4 Add backend tests for message contract validation, unsupported message types, media flow, and `clientMessageId` idempotency.
- [ ] 9.5 Add backend tests for Fastify decorators and registered built-in message type handlers.
- [ ] 9.6 Add backend tests proving chatbox adapter reuse does not alter `WebchatPlugin` embedded-widget behavior.
- [ ] 9.7 Add frontend or focused manual verification for `/chatbox` session redirect, refresh, expiry/mismatch UI, message rendering, sorting, and background image rendering.
- [ ] 9.8 Run Prisma generation, API focused tests, widget build, web build, and OpenSpec validation.
