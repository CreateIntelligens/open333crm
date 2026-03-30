## 1. Inventory Current Bootstrap Behavior

- [x] 1.1 Inventory every plugin, route prefix, channel plugin, worker, and scheduler currently registered from `apps/api/src/main.ts`
- [x] 1.2 Identify any runtime-only behavior in `main.ts` that is not present in `index.ts`
- [x] 1.3 Search package scripts, Dockerfiles, docs, and build references for `main.ts` entrypoint usage

## 2. Rebuild the Canonical Entrypoint

- [x] 2.1 Move the active Fastify bootstrap flow into `apps/api/src/index.ts`
- [x] 2.2 Ensure `index.ts` registers the same active plugins, routes, channel plugins, workers, and schedulers as the prior runtime
- [x] 2.3 Convert `apps/api/src/main.ts` into a strict delegate to `index.ts` or remove it once no runtime references remain

## 3. Align Runtime Wiring

- [x] 3.1 Update `apps/api/package.json` so dev and production scripts start from `src/index.ts`
- [x] 3.2 Update Docker and deployment startup references to use the `index.ts` build output
- [x] 3.3 Confirm build artifacts and emitted entry files match the new authoritative bootstrap

## 4. Verify and Document

- [x] 4.1 Build the API and verify startup succeeds from the consolidated `index.ts` entrypoint
- [x] 4.2 Smoke-check that route registration, channel webhook handling, and background workers remain reachable after consolidation
- [x] 4.3 Update README, changelog, or contributor guidance to state that `index.ts` is the single bootstrap owner
