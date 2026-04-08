## 1. API — Webchat Module

- [x] 1.1 Create `apps/api/src/modules/webchat/` directory with `webchat.routes.ts`, `webchat.service.ts`
- [x] 1.2 Implement `POST /api/v1/webchat/:channelId/sessions` — validate `visitorToken` (UUID format), load channel, return `{ visitorToken, greeting, history: Message[] }` (last 20 messages if conversation exists)
- [x] 1.3 Implement `POST /api/v1/webchat/:channelId/messages` — validate `visitorToken` + `content.text`, build `ParsedWebhookMessage`, call `processInboundMessage` from `webhook.service.ts`
- [x] 1.4 Register webchat routes in `apps/api/src/index.ts` (no auth guard — public endpoints)

## 2. API — Visitor Socket.IO Namespace

- [x] 2.1 Create `apps/api/src/modules/webchat/webchat.socket.ts` — register `/visitor` namespace on `fastify.io`
- [x] 2.2 Add auth middleware on `/visitor`: validate `socket.handshake.auth.visitorToken` (UUID format) + `socket.handshake.auth.channelId` (exists in DB); reject invalid connections
- [x] 2.3 On connection: join room `visitor:${channelId}:${visitorToken}`; log connection (channelId from socket.data)
- [x] 2.4 Call `registerVisitorNamespace(io, prisma)` from `socket.plugin.ts` after namespace setup

## 3. API — Outbound Delivery to Visitor

- [x] 3.1 In `apps/api/src/modules/conversation/conversation.service.ts` locate where OUTBOUND messages are emitted to the agent room
- [x] 3.2 Add: when `channel.channelType === 'WEBCHAT'`, also emit `agent:message` event with the message payload to room `visitor:${channel.id}:${contactUid}` on the `/visitor` namespace (`io.of('/visitor').to(...)`)
- [x] 3.3 Verify bot auto-reply (KB, LLM) also reaches visitor via the same path (no extra change needed if it goes through `deliverToChannel`)

## 4. Widget — Build Setup

- [x] 4.1 Update `apps/widget/vite.config.ts` (create if absent) — configure `lib` mode, entry `src/index.ts`, formats `['iife']`, filename `widget`, global name `Open333CRMWidget`
- [x] 4.2 Confirm `socket.io-client` is in `apps/widget/package.json` dependencies (already present)

## 5. Widget — Implementation

- [x] 5.1 Implement visitor session init in `apps/widget/src/session.ts` — load/create UUID from `localStorage`, call session API, return `{ visitorToken, greeting, history }`
- [x] 5.2 Implement Socket.IO client in `apps/widget/src/socket.ts` — connect to `/visitor` namespace with `visitorToken` + `channelId`; expose `onAgentMessage(cb)` and `disconnect()`
- [x] 5.3 Implement UI in `apps/widget/src/ui.ts` — create launcher button (bottom-right, fixed), chat panel (message list + input), render history + incoming `agent:message` events
- [x] 5.4 Implement send in `apps/widget/src/index.ts` — on submit call `POST /api/v1/webchat/:channelId/messages`, append optimistic message to UI, handle errors
- [x] 5.5 Wire together: `apps/widget/src/index.ts` reads `window.Open333CRM.channelId` + `window.Open333CRM.apiUrl`, init session, init socket, render UI

## 6. API — Serve Widget Bundle

- [x] 6.1 Build widget: `pnpm --filter @open333crm/widget build` — confirm `apps/widget/dist/widget.js` is generated
- [x] 6.2 In `apps/api/src/index.ts` register `@fastify/static` route for `GET /webchat/widget.js` pointing to `apps/widget/dist/widget.js`

## 7. Validation

- [x] 7.1 Build and typecheck all affected packages: `pnpm --filter @open333crm/channel-plugins build && pnpm --filter @open333crm/api typecheck && pnpm --filter @open333crm/widget build`
- [ ] 7.2 Manual test: install embed code on a test page, send a message from widget, confirm conversation appears in inbox
- [ ] 7.3 Manual test: agent replies in inbox, confirm reply appears in widget in real time
