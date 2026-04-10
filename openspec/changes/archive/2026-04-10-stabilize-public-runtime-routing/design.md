## Context

The web dashboard, widget bundle, and embed snippet all depend on public URLs, but before this change those URLs were derived inconsistently. Some code paths used `NEXT_PUBLIC_API_URL`, some used `NEXT_PUBLIC_WS_URL`, some fell back to `http://localhost:3001`, and the widget bundle was assumed to be served by the API runtime. That model breaks once requests pass through Caddy/ngrok, because static assets, API endpoints, sockets, and public redirects do not all terminate at the same internal service.

The fix is cross-cutting: shared endpoint derivation, web/widget build wiring, public reverse-proxy routing, and user-input behavior all need to line up.

## Goals / Non-Goals

**Goals:**
- Make browser-facing API and socket endpoints derive from one public value.
- Support `NEXT_PUBLIC_API_URL=/api` and normalize it to `/api/v1` without each caller duplicating logic.
- Serve `widget.js` from the web/public origin while keeping API routes under `/api/v1/webchat/*`.
- Ensure public shortlinks resolve under `/s/:slug` on the same origin users see in the browser.
- Prevent accidental sends during IME composition in both inbox and widget inputs.
- Keep the Docker/web build reproducible by providing build-time env and required workspace packages.

**Non-Goals:**
- Adding new webchat transport features such as attachments, typing indicators, or history replay.
- Reworking shortlink analytics/storage behavior.
- Replacing Caddy with a different edge proxy.

## Decisions

### D1: Use a shared endpoint normalization helper
A shared helper in `packages/shared` owns normalization of `NEXT_PUBLIC_API_URL` into `{ apiBaseUrl, realtimeOrigin }`.

This removes duplicated fallback logic from `apps/web` and `apps/widget`, and it supports three valid forms with the same contract:
- absolute API root ending in `/api`
- absolute origin without `/api/v1`
- relative `/api`

**Alternative considered:** keep separate `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`. Rejected because the two values drifted and produced mixed-origin runtime bugs.

### D2: Serve the widget bundle from the web public origin
`/webchat/widget.js` is treated as a static asset and should be served by the web app/public layer, not by Fastify.

The API still generates embed code, but it now emits `apiBaseUrl` for API calls and a widget script URL derived from `WEB_BASE_URL` or the API origin stripped back to the public host.

**Alternative considered:** keep serving `widget.js` from the API. Rejected because it couples a static asset to the API process and breaks more easily behind public proxies such as ngrok.

### D3: Public routing is explicit in Caddy
Caddy is the public entrypoint, so it must route by responsibility:
- `/api/*`, `/socket.io/*`, `/s/*` -> API
- `/webchat/*`, all other pages -> web

This keeps public URLs stable even when internal service ports differ.

**Alternative considered:** infer ports in browser code. Rejected because it only works on localhost and fails in proxied deployments.

### D4: Web build must receive public env at build time
Next.js inlines `NEXT_PUBLIC_*` values during `next build`, so `.env.web` must be present in the image build step rather than only at container runtime.

**Alternative considered:** rely only on `docker-compose env_file`. Rejected because runtime env injection does not fix already-built client bundles.

### D5: Enter-to-send must respect IME composition state
Both the inbox textarea and the widget input gate Enter submission on composition state (`isComposing` / keyCode `229`).

**Alternative considered:** only fix the widget. Rejected because the bug exists in both user-facing message entry points.

## Risks / Trade-offs

- [Relative `/api` configuration] -> Requires all frontend callers to use the shared helper; stray direct env reads will reintroduce drift.
- [Static widget sync] -> The web build now depends on building `@open333crm/shared` and `@open333crm/widget`; mitigated by explicit `sync:widget` build steps and Dockerfile inputs.
- [Proxy correctness] -> `/s/*` and `/webchat/*` now depend on Caddy rules being deployed; mitigated by keeping routing explicit and simple.
- [Spec scope] -> Some changes are operational (Docker/env/Caddy) rather than feature work; mitigated by capturing only the externally observable contract in specs.

## Migration Plan

1. Build `packages/shared`, `apps/widget`, and `apps/web` with the new runtime helper.
2. Deploy Caddy routes for `/webchat/*` and `/s/*`.
3. Rebuild the web image so `NEXT_PUBLIC_API_URL` is embedded into the client bundle.
4. Roll out API embed snippet changes.
5. Rollback by restoring the previous helper/snippet/routing combination together; partial rollback is unsafe because bundle hosting and endpoint derivation are coupled.

## Open Questions

- None for this implementation slice. The remaining risk is operational verification in the deployed reverse-proxy environment.
