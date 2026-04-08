## 1. Unify `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`

- [x] 1.1 Add `ParsedWebhookMessage` and `OutboundPayload` types directly to `index.ts` (same shape as in `webhook-adapter.ts`)
- [x] 1.2 Change `ChannelPlugin.parseWebhook` return type: `Promise<UniversalMessage[]>` → `Promise<ParsedWebhookMessage[]>`
- [x] 1.3 Change `ChannelPlugin.sendMessage` signature: `OutboundMessage` → `OutboundPayload`, `ChannelCredentials` → `Record<string, unknown>`, return `{ success: boolean; channelMsgId?: string; error?: string }`
- [x] 1.4 Change `ChannelPlugin.getProfile` return type to `{ uid: string; displayName: string; avatarUrl?: string }` (match API callers)
- [x] 1.5 Rename registry functions: `registerPlugin` → `registerChannelPlugin`, `getPlugin` → `getChannelPlugin`; add `hasChannelPlugin`, `getAllChannelPlugins`
- [x] 1.6 Remove `./webhook` export from `packages/channel-plugins/package.json`

## 2. Update channel plugin implementations

- [x] 2.1 Update `packages/channel-plugins/src/line/index.ts`: change `parseWebhook` return type to `ParsedWebhookMessage[]` (map `UniversalMessage` fields → `ParsedWebhookMessage` fields; keep all 12+ event types)
- [x] 2.2 Update `packages/channel-plugins/src/line/index.ts`: update `sendMessage` and `getProfile` signatures to match unified interface
- [x] 2.3 Update `packages/channel-plugins/src/facebook/index.ts`: same fixes as 2.1/2.2
- [x] 2.4 Create `packages/channel-plugins/src/webchat/index.ts` — simple plugin: `verifySignature` returns `true`; `parseWebhook` returns `[{ contactUid, timestamp, contentType, content }]`; `sendMessage` logs and returns `success: true`; export `webchatPlugin` instance
- [x] 2.5 Export `webchatPlugin` from `packages/channel-plugins/src/index.ts`

## 3. Remove duplicate adapter files

- [x] 3.1 Delete `packages/channel-plugins/src/adapters/line-webhook.ts`
- [x] 3.2 Delete `packages/channel-plugins/src/adapters/fb-webhook.ts`
- [x] 3.3 Delete `packages/channel-plugins/src/adapters/webchat-webhook.ts`
- [x] 3.4 Delete `packages/channel-plugins/src/adapters/` directory
- [x] 3.5 Delete `packages/channel-plugins/src/webhook-adapter.ts`

## 4. Update `apps/api` import sites

- [x] 4.1 Update `apps/api/src/index.ts`: `@open333crm/channel-plugins/webhook` → `@open333crm/channel-plugins`; import `webchatPlugin` from package
- [x] 4.2 Update `apps/api/src/modules/webhook/webhook.service.ts`: change import path + update `ParsedWebhookMessage` import
- [x] 4.3 Update all remaining 6 `apps/api` files that import from `@open333crm/channel-plugins/webhook`: `conversation.service.ts`, `fb-login.routes.ts`, `line-login.routes.ts`, `csat.service.ts`, `canvas.worker.ts`, `marketing.service.ts`

## 5. Update `apps/workers`

- [x] 5.1 Update `apps/workers/src/index.ts`: change `LinePlugin`/`FbPlugin` class instantiation to use exported instances (`linePlugin`, `fbPlugin`); update `ChannelPlugin` type import if needed
- [x] 5.2 Update `apps/workers/src/handlers/broadcast.handler.ts`: change `OutboundMessage`-shaped object to `OutboundPayload` shape (`{ contentType: 'text', content: { text: ... } }`)

## 6. Build & Verify

- [x] 6.1 Run `pnpm --filter @open333crm/channel-plugins build` — confirm no errors
- [x] 6.2 Run `pnpm --filter @open333crm/api exec tsc --noEmit` — confirm zero errors
- [x] 6.3 Run `pnpm --filter @open333crm/workers exec tsc --noEmit` — confirm zero errors
- [ ] 6.4 Manually test: restart API + worker containers, send a LINE webhook message, confirm received and processed
