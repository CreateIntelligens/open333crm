## Context

The API service has accumulated two generations of bootstrap structure. The active runtime is currently centered on `apps/api/src/main.ts`, while `apps/api/src/index.ts` has historically represented an older entrypoint and architecture direction. This split allows route registration, plugin setup, workers, and deployment scripts to attach to different files over time, which is exactly how the codebase drifted away from the original document-first architecture.

This change is cross-cutting because the API bootstrap touches Fastify plugin order, route availability, channel plugin registration, background workers, build outputs, and deployment scripts. The goal is not to redesign API behavior, but to force all active behavior to pass through one authoritative entrypoint: `apps/api/src/index.ts`.

## Goals / Non-Goals

**Goals:**
- Make `apps/api/src/index.ts` the sole API bootstrap entrypoint in development, build, and production.
- Preserve all currently active runtime behavior that is now composed in `main.ts`.
- Prevent future drift by ensuring any retained `main.ts` delegates to `index.ts` rather than building a second server.
- Keep module and route registration behaviorally equivalent during the entrypoint consolidation.
- Align the API runtime with the document-first architecture the team wants to re-establish.

**Non-Goals:**
- Redesign route contracts, module boundaries, or business logic during this change.
- Remove all legacy `routes/*` files as part of the bootstrap consolidation alone.
- Refactor unrelated schema, domain, or frontend issues.

## Decisions

### Decision: `src/index.ts` becomes the sole runtime bootstrap
`index.ts` will own Fastify construction, plugin registration, channel plugin registration, route registration, scheduler/worker setup, and process startup.

Rationale:
- `index.ts` is the architectural anchor the team wants to preserve.
- A single canonical bootstrap reduces ambiguity in docs, package scripts, and collaboration.

Alternative considered:
- Keep `main.ts` as primary and let `index.ts` delegate. Rejected because it preserves the current architectural inversion and keeps the docs-to-code mismatch in place.

### Decision: `main.ts` may exist only as a compatibility delegate
If `main.ts` must remain temporarily for tooling or external references, it must import and start the `index.ts` bootstrap instead of constructing its own server.

Rationale:
- This allows short-term compatibility without preserving a second implementation path.

Alternative considered:
- Delete `main.ts` immediately. Rejected as the default because the repo may still contain scripts or IDE assumptions that reference it during transition.

### Decision: Startup configuration must be updated atomically
`apps/api/package.json`, Docker/runtime scripts, and any deployment references will be changed in the same implementation step as the bootstrap move.

Rationale:
- A partial switch is how the current split happened.
- Entry file, build output, and runtime command must point at the same source of truth.

Alternative considered:
- Move code first and update scripts later. Rejected because it leaves the repo in another transitional state.

### Decision: Functional parity is verified through route/plugin/worker inventory
Before removing the `main.ts` bootstrap logic, its active registrations will be inventoried and reproduced under `index.ts`.

Rationale:
- The risk is not syntax migration; it is silently dropping a route, worker, or plugin.
- Inventory-based consolidation is safer than manually re-creating behavior from memory.

Alternative considered:
- Rewrite `index.ts` from docs only. Rejected because it risks deleting large amounts of currently working functionality.

## Risks / Trade-offs

- [Bootstrap parity misses a registration] → Mitigation: inventory every plugin, route, scheduler, and worker currently created by `main.ts` and verify equivalent registration under `index.ts`.
- [Hidden references still point to `main.ts`] → Mitigation: search scripts, docs, Docker, and build outputs as part of the same change.
- [Legacy `routes/*` and `modules/*` continue to blur architecture] → Mitigation: treat that as a follow-up audit; this change only establishes one bootstrap owner first.
- [Short-term compatibility file masks unfinished migration] → Mitigation: document whether `main.ts` is temporary and add a cleanup task with explicit acceptance criteria.

## Migration Plan

1. Inventory current `main.ts` runtime behavior: plugins, route prefixes, channel plugins, workers, schedulers, and startup flow.
2. Rebuild the canonical bootstrap in `index.ts` using that inventory.
3. Point package scripts and runtime outputs to `index.ts`.
4. Convert `main.ts` into a delegate or remove it once no runtime references remain.
5. Build and smoke-test the API to confirm route availability and startup behavior.
6. Update contributor docs to state that new runtime wiring must extend `index.ts`.

Rollback:
- Restore package scripts and runtime commands to `main.ts`.
- Revert the bootstrap delegation if startup parity is not achieved.

## Open Questions

- Are there any non-repo deployment systems or IDE launch configs that still hardcode `src/main.ts`?
- Should `main.ts` remain as a compatibility delegate for one release cycle, or should it be removed in the same change once all references are updated?
