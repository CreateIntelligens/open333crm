## Why

The current public web runtime mixes localhost fallbacks, runtime-only env injection, and outdated widget hosting assumptions. That causes production regressions: some frontend calls fall back to `http://localhost:3001`, the widget bundle can be routed to the wrong service, shortlinks can 404 behind Caddy, and IME users can accidentally submit messages before composition finishes.

## What Changes

- Centralize public endpoint derivation behind one shared runtime helper that normalizes `NEXT_PUBLIC_API_URL` into an API base URL plus realtime origin.
- Serve the embeddable widget bundle from the web public origin at `GET /webchat/widget.js` instead of from the API runtime.
- Update the embed snippet to emit `window.Open333CRM.apiBaseUrl` and optionally source the widget bundle from `WEB_BASE_URL` when configured.
- Route `/webchat/*` to the web app and `/s/*` to the API in Caddy so widget assets and public shortlinks resolve from the correct service.
- Align shortlink copy behavior with the public origin instead of hard-coding `:3001`.
- Prevent Enter-to-send while IME composition is active in both the embeddable widget and the inbox message input.
- Ensure the web Docker build includes the shared/widget workspace inputs and loads `NEXT_PUBLIC_API_URL` at build time.

## Capabilities

### New Capabilities
- `public-runtime-config`: Single-source derivation of browser API and realtime endpoints from one public API setting.
- `shortlink-routing`: Public shortlinks resolve on the public origin under `/s/:slug`, independent of internal service ports.

### Modified Capabilities
- `webchat-widget`: Widget asset hosting and embed bootstrap behavior move to the web public origin, with composition-safe Enter handling.
- `core-inbox`: Agent message input must not submit while IME composition is active.

## Impact

- Affected code: `packages/shared`, `apps/web`, `apps/widget`, `apps/api/src/modules/channel/webchat-embed.service.ts`, `Caddyfile`, env examples, web Docker build.
- Public behavior: widget bootstrap now depends on `apiBaseUrl` + public widget origin separation; shortlinks resolve from the same public domain instead of an inferred API port.
- No database migrations.
