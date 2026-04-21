## Context

`apps/api/src/channels/` contains hand-rolled LINE, FB, and webchat plugins (~200–400 lines each) that duplicate logic already present in `packages/channel-plugins`. The shared package has the richer implementation: full event parsing, rich menu, audience, analytics, and multicast. Eight files in `apps/api` import `getChannelPlugin()` and `ParsedWebhookMessage` from the local channels directory.

The registry (`registry.ts`) and base interface (`base.plugin.ts`) are also local to `apps/api`. Moving them to `packages/channel-plugins` makes the contract available to both `apps/api` and `apps/workers` without duplication.

## Goals / Non-Goals

**Goals:**
- Remove `apps/api/src/channels/line`, `/fb`, `/webchat` — all 3 replaced by package equivalents
- Move `ChannelPlugin` interface + `ChannelRegistry` into `packages/channel-plugins/src/`
- Update all 8 import sites to use `@open333crm/channel-plugins`
- `apps/api/src/index.ts` registers plugins from the package
- Types (`ParsedWebhookMessage`, `ChannelPlugin`) exported from package index

**Non-Goals:**
- Rewriting simulator (dev-only tool, no package equivalent)
- Changing webhook routing logic (`webhook.service.ts` behavior unchanged)
- Changing plugin method signatures — pure refactor

## Decisions

### D1: Registry lives in `packages/channel-plugins`
The registry is a simple in-memory Map. Both `apps/api` and `apps/workers` need plugin lookup. Placing it in the package avoids duplication and makes the full plugin surface area accessible to workers.

**Alternative considered**: Keep registry in `apps/api`, export via internal package path. Rejected — workers would need to import from an app, violating the dependency direction (packages ← apps).

### D2: `base.plugin.ts` interface moved to `packages/channel-plugins/src/base.ts`, re-exported from index
`ParsedWebhookMessage` and `ChannelPlugin` are referenced in 8 files. Exporting from the package index (`@open333crm/channel-plugins`) gives a single stable import path.

**Alternative considered**: Keep base in a new `@open333crm/types` entry. Rejected — types are tightly coupled to plugin method shapes; keeping them in the channel-plugins package is cohesive.

### D3: Simulator stays in `apps/api/src/channels/simulator/`
Simulator is a dev/test tool with no production use. It has no equivalent in the package and requires Fastify-specific route registration. Moving it is out of scope.

### D4: Import sites updated from `../../channels/registry.js` → `@open333crm/channel-plugins`
All 8 files change the import. No interface changes — `getChannelPlugin()` signature stays identical.

## Risks / Trade-offs

- [Build order] `packages/channel-plugins` must build before `apps/api` — already true in turbo.json (api depends on channel-plugins). No change needed.
- [Type drift] `packages/channel-plugins/src/line/index.ts` has richer types than the old local plugin. Callers that relied on narrow local types may need type cast updates. → Mitigation: TypeScript will surface these at build time.
- [Webchat plugin] `packages/channel-plugins` exports a `./webchat` path — verify the implementation matches the API's expectations before removing the local version.

## Migration Plan

1. Add `registry.ts` + `base.ts` to `packages/channel-plugins/src/`
2. Re-export from `packages/channel-plugins/src/index.ts`
3. Update each of the 8 import sites in `apps/api/src/`
4. Delete `apps/api/src/channels/line/`, `/fb/`, `/webchat/`, `base.plugin.ts`, `registry.ts`
5. `tsc --noEmit` across the monorepo to verify no type errors
6. Run existing tests

**Rollback**: git revert — no DB changes, no migrations, pure source refactor.
