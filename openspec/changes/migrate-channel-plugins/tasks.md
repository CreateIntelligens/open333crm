## 1. Prepare `packages/channel-plugins`

- [x] 1.1 Copy `apps/api/src/channels/base.plugin.ts` to `packages/channel-plugins/src/base.ts` — keep `ChannelPlugin` interface and `ParsedWebhookMessage` type
- [x] 1.2 Create `packages/channel-plugins/src/registry.ts` — copy registry logic from `apps/api/src/channels/registry.ts` (in-memory Map, `registerChannelPlugin`, `getChannelPlugin`)
- [x] 1.3 Re-export `ChannelPlugin`, `ParsedWebhookMessage`, `registerChannelPlugin`, `getChannelPlugin` from `packages/channel-plugins/src/index.ts`
- [x] 1.4 Verify webchat plugin in `packages/channel-plugins/src/webchat/` implements the same `ChannelPlugin` interface methods used by `apps/api` (`verifySignature`, `parseWebhook`, `sendMessage`, `getProfile`)

## 2. Update `apps/api` Import Sites

- [x] 2.1 Update `apps/api/src/index.ts` — import `registerChannelPlugin`, `linePlugin`, `fbPlugin`, `webchatPlugin` from `@open333crm/channel-plugins`
- [x] 2.2 Update `apps/api/src/modules/webhook/webhook.service.ts` — change `getChannelPlugin` and `ParsedWebhookMessage` imports to `@open333crm/channel-plugins`
- [x] 2.3 Update `apps/api/src/modules/conversation/conversation.service.ts` — change `getChannelPlugin` import
- [x] 2.4 Update `apps/api/src/modules/fb-login/fb-login.routes.ts` — change `getChannelPlugin` import
- [x] 2.5 Update `apps/api/src/modules/line-login/line-login.routes.ts` — change `getChannelPlugin` import
- [x] 2.6 Update `apps/api/src/modules/csat/csat.service.ts` — change `getChannelPlugin` import
- [x] 2.7 Update `apps/api/src/modules/canvas/canvas.worker.ts` — change `getChannelPlugin` import
- [x] 2.8 Update `apps/api/src/modules/marketing/marketing.service.ts` — change `getChannelPlugin` import

## 3. Remove Old Channel Implementations

- [x] 3.1 Delete `apps/api/src/channels/line/line.plugin.ts`
- [x] 3.2 Delete `apps/api/src/channels/fb/fb.plugin.ts`
- [x] 3.3 Delete `apps/api/src/channels/webchat/webchat.plugin.ts`
- [x] 3.4 Delete `apps/api/src/channels/base.plugin.ts`
- [x] 3.5 Delete `apps/api/src/channels/registry.ts`
- [x] 3.6 Verify `apps/api/src/channels/simulator/` is untouched and still imports correctly

## 4. Build & Verify

- [x] 4.1 Run `pnpm --filter @open333crm/channel-plugins build` — confirm no errors
- [x] 4.2 Run `pnpm --filter @open333crm/api typecheck` (or `tsc --noEmit`) — confirm zero type errors
- [ ] 4.3 Manually test: restart API container, send a LINE webhook message, confirm it is received and processed normally
