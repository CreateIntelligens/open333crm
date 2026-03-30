## Why

The API service currently carries multiple generations of bootstrap code, with active runtime behavior centered on `src/main.ts` while legacy references and older composition patterns still exist around `src/index.ts`. This keeps the codebase out of alignment with the original document-first architecture and makes it too easy for routing, plugin registration, and worker wiring to drift into parallel entrypoints again.

## What Changes

- Make `apps/api/src/index.ts` the single authoritative API bootstrap entrypoint.
- Fold the currently active runtime composition from `apps/api/src/main.ts` back into `apps/api/src/index.ts`.
- Remove or strictly demote `main.ts` so it cannot become a second independent server bootstrap.
- Update package scripts, build outputs, and deployment references so development and production both start from `index.ts`.
- Audit route/module/plugin/worker registration to ensure all currently active behavior remains reachable after the entrypoint consolidation.
- Add explicit guardrails in code and docs so future changes extend the single bootstrap instead of creating a new one.

## Capabilities

### New Capabilities
- `api-bootstrap`: Defines the API service bootstrap contract, including the requirement that `src/index.ts` is the sole runtime entrypoint and that any legacy or transitional bootstraps delegate into it instead of creating a second server setup.

### Modified Capabilities
- `core-inbox`: The API bootstrap path that exposes inbox and related route behavior changes from a `main.ts`-centered runtime to an `index.ts`-centered runtime.
- `channel-plugins`: Channel plugin registration and webhook availability move under the authoritative `index.ts` bootstrap path.

## Impact

- Affected code: `apps/api/src/index.ts`, `apps/api/src/main.ts`, API route/module registration, startup scripts, and deployment/build configuration.
- Affected runtime: Fastify plugin registration order, channel plugin registration, workers/schedulers, and health/startup flow.
- Affected docs: architecture and contributor guidance around API entrypoints.
