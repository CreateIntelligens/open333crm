## Why

`apps/api/src/channels/` contains simplified, duplicated implementations of LINE, FB, and webchat plugins that shadow the richer `@open333crm/channel-plugins` package. The package already provides full webhook parsing, rich menu, audience, analytics, and template management. Maintaining two parallel implementations creates drift and prevents api consumers from using the full feature set. The registry and base interface belong in the shared package so any app (api, workers) can use them without duplicating code.

## What Changes

- **Move** `ChannelPlugin` base interface and `ChannelRegistry` from `apps/api/src/channels/` into `packages/channel-plugins/`
- **Delete** `apps/api/src/channels/line/line.plugin.ts` — replaced by `packages/channel-plugins/src/line/index.ts`
- **Delete** `apps/api/src/channels/fb/fb.plugin.ts` — replaced by `packages/channel-plugins/src/facebook/index.ts`
- **Delete** `apps/api/src/channels/webchat/webchat.plugin.ts` — replaced by the webchat plugin in the package
- **Keep** `apps/api/src/channels/simulator/` for now (dev-only, no equivalent in package)
- **Update** all 8 files in `apps/api/src/` that import from `../../channels/registry.js` to import from `@open333crm/channel-plugins`
- **Update** `apps/api/src/index.ts` to register plugins from `@open333crm/channel-plugins`
- **BREAKING**: `ParsedWebhookMessage` type import path changes from local `base.plugin.ts` to `@open333crm/channel-plugins`

## Capabilities

### New Capabilities

- (none — existing functionality is being consolidated, not introduced)

### Modified Capabilities

- `channel-plugins`: Registry and base plugin interface moves from `apps/api/src/channels/` into `packages/channel-plugins/`; all channel integrations now sourced from the shared package

## Impact

- `apps/api/src/channels/` directory removed (except `simulator/`)
- 8 files updated: `index.ts`, `webhook.service.ts`, `conversation.service.ts`, `fb-login.routes.ts`, `line-login.routes.ts`, `csat.service.ts`, `canvas.worker.ts`, `marketing.service.ts`
- `packages/channel-plugins` gains `registry.ts` and `base.plugin.ts` (or re-exports the interface)
- No runtime behavior changes — same plugin methods, same webhook handling
