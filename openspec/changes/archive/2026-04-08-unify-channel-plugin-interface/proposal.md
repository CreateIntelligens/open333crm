## Why

The previous `migrate-channel-plugins` change introduced `packages/channel-plugins/src/adapters/` (line-webhook.ts, fb-webhook.ts, webchat-webhook.ts) which are simplified re-implementations of logic already present in `line/index.ts` and `facebook/index.ts`. This creates a third copy of LINE webhook parsing. The root cause is that the package's `ChannelPlugin` interface used `UniversalMessage[]` for `parseWebhook` while `apps/api` needed `ParsedWebhookMessage[]`, forcing a separate adapter layer. Unifying the interface eliminates the duplication entirely.

## What Changes

- **Delete** `packages/channel-plugins/src/adapters/` (3 files: line-webhook.ts, fb-webhook.ts, webchat-webhook.ts)
- **Delete** `packages/channel-plugins/src/webhook-adapter.ts`
- **Modify** `packages/channel-plugins/src/index.ts`: change `ChannelPlugin.parseWebhook` return type from `UniversalMessage[]` → `ParsedWebhookMessage[]`; add `ParsedWebhookMessage` and `OutboundPayload` to the package's own types; replace `registerPlugin`/`getPlugin` with `registerChannelPlugin`/`getChannelPlugin` (matching API caller names); add `hasChannelPlugin`/`getAllChannelPlugins`
- **Modify** `packages/channel-plugins/src/line/index.ts`: update `parseWebhook` to return `ParsedWebhookMessage[]` (richer event logic stays; return type adapts)
- **Modify** `packages/channel-plugins/src/facebook/index.ts`: same return type fix
- **Create** `packages/channel-plugins/src/webchat/index.ts`: webchat plugin (no external API calls)
- **Modify** `apps/api/src/index.ts`: import from `@open333crm/channel-plugins` (remove `/webhook` sub-path)
- **Modify** 8 `apps/api` service/route files: change import from `@open333crm/channel-plugins/webhook` → `@open333crm/channel-plugins`
- **Verify** `apps/workers`: already imports from `@open333crm/channel-plugins` — confirm `sendMessage` signature is compatible after unification

## Capabilities

### New Capabilities

- (none — consolidation of existing capability)

### Modified Capabilities

- `channel-plugins`: Single unified `ChannelPlugin` interface; `parseWebhook` returns `ParsedWebhookMessage[]`; registry functions renamed to `registerChannelPlugin`/`getChannelPlugin`; webchat plugin added to the package

## Impact

- `packages/channel-plugins/src/adapters/` removed (3 files gone)
- `packages/channel-plugins/src/webhook-adapter.ts` removed
- `apps/api` sub-path import `@open333crm/channel-plugins/webhook` → `@open333crm/channel-plugins`
- `apps/workers/src/index.ts` + `broadcast.handler.ts` import paths unchanged; `sendMessage` signature compatibility must be verified
- `./webhook` export in `channel-plugins/package.json` can be removed
