## Context

After `migrate-channel-plugins`, two `ChannelPlugin` interfaces coexist:

1. **`packages/channel-plugins/src/index.ts`** — the rich interface: `parseWebhook` returns `UniversalMessage[]`; `sendMessage` takes `OutboundMessage`; used by `apps/workers`
2. **`packages/channel-plugins/src/webhook-adapter.ts`** — the API-facing interface: `parseWebhook` returns `ParsedWebhookMessage[]`; `sendMessage` takes `OutboundPayload`; used by `apps/api`

This created `adapters/line-webhook.ts` and `adapters/fb-webhook.ts` as simplified re-implementations of `line/index.ts` and `facebook/index.ts`. Both files parse LINE/FB webhooks, but `line/index.ts` handles 12+ event types while `line-webhook.ts` handles only ~5.

The divergence happened because `UniversalMessage` requires `channelId` and `id` fields that the plugin cannot populate — those require HTTP request context the parser doesn't have. `ParsedWebhookMessage` was the right shape all along.

## Goals / Non-Goals

**Goals:**
- Single `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`
- `parseWebhook` returns `ParsedWebhookMessage[]` — the correct type for a raw parse step
- Registry functions: `registerChannelPlugin` / `getChannelPlugin` (matching existing API call sites)
- `line/index.ts` and `facebook/index.ts` implement the unified interface (richer logic preserved)
- `webchat/index.ts` created in the package
- `adapters/` and `webhook-adapter.ts` deleted
- `apps/api` imports from `@open333crm/channel-plugins` (no `/webhook` sub-path)
- `apps/workers` continues to compile cleanly

**Non-Goals:**
- Migrating `apps/api` `sendMessage` callers to use the richer `OutboundMessage` type (separate concern)
- Adding `UniversalMessage` enrichment to `parseWebhook` output
- Changing any business logic in webhook parsing or message delivery

## Decisions

### D1: `parseWebhook` returns `ParsedWebhookMessage[]`, not `UniversalMessage[]`
`UniversalMessage` requires `id`, `channelId`, `channelType`, `direction` — none of which the parser can supply. The webhook router fills in `channelId` and `channelType` from URL params after parsing. `ParsedWebhookMessage` models what the parser actually knows: `contactUid`, `timestamp`, `contentType`, `content`, `rawPayload`.

**Alternative considered**: Pass `channelId`/`channelType` into `parseWebhook`. Rejected — parser should be pure, stateless, and unaware of routing context.

### D2: Registry function names: `registerChannelPlugin` / `getChannelPlugin`
The previous package used `registerPlugin` / `getPlugin`. The 8 API call sites use `registerChannelPlugin` / `getChannelPlugin`. Rename in the package to match existing call sites — avoids updating all 8 API files for a cosmetic rename.

**Alternative considered**: Keep `registerPlugin`/`getPlugin` and update API files. Rejected — unnecessary churn.

### D3: `sendMessage` signature kept as `OutboundPayload` (`{ contentType, content }`)
`apps/workers/broadcast.handler.ts` calls `plugin.sendMessage(to, message, credentials)`. Currently the package uses `OutboundMessage` (richer). After unification, the signature becomes `(to, { contentType, content }, credentials)`.

Workers currently constructs an `OutboundMessage` with `type: 'text'`. After change, workers must use `contentType: 'text', content: { text: ... }`. This is a small callers update in workers but keeps the interface consistent with the simpler, more universal `OutboundPayload` shape.

**Alternative considered**: Keep `OutboundMessage` and update API callers. Rejected for now — API has 8 call sites vs workers' 1. Revisit if richer sending strategies (multicast, narrowcast) are needed in API.

### D4: `getProfile` return: keep `{ uid, displayName, avatarUrl? }`
`ContactProfile` from `@open333crm/types` uses `pictureUrl`. The API callers use `avatarUrl`. Keeping `avatarUrl` avoids updating API callers. Workers don't use `getProfile`. This discrepancy can be aligned with `@open333crm/types` in a future cleanup.

## Risks / Trade-offs

- [workers sendMessage] `broadcast.handler.ts` currently passes an `OutboundMessage`-shaped object → must be updated to `OutboundPayload` shape. → Mitigation: TypeScript build will catch it; small change.
- [LINE event coverage] `adapters/line-webhook.ts` had simpler event coverage; `line/index.ts` has the full 12-event implementation. Switching means all events flow through the richer parser — this is an improvement, not a risk.
- [No webchat in package] `packages/channel-plugins` has no webchat implementation yet. Must create `webchat/index.ts`. → Mitigation: simple, no external API calls.

## Migration Plan

1. Add `ParsedWebhookMessage`, `OutboundPayload` types + rename registry functions in `packages/channel-plugins/src/index.ts`
2. Update `line/index.ts` and `facebook/index.ts` `parseWebhook` return type → `ParsedWebhookMessage[]`
3. Create `packages/channel-plugins/src/webchat/index.ts`
4. Export `webchatPlugin` from package index + remove `./webhook` export from `package.json`
5. Delete `adapters/` and `webhook-adapter.ts`
6. Update `apps/api` imports: `/webhook` → root package
7. Update `apps/workers` `sendMessage` call to `OutboundPayload` shape
8. Build + typecheck both apps

**Rollback**: git revert — no DB changes, no migrations.
