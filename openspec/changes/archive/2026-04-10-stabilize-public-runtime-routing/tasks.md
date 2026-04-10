## 1. Shared public runtime contract

- [x] 1.1 Add a shared runtime helper that normalizes `NEXT_PUBLIC_API_URL` into `apiBaseUrl` and `realtimeOrigin`
- [x] 1.2 Update web constants and Socket.IO client code to consume the shared runtime helper instead of duplicating env fallbacks
- [x] 1.3 Update widget code to consume `apiBaseUrl`, derive `/visitor` from the shared realtime origin, and add the shared workspace dependency/build wiring

## 2. Public widget hosting and build pipeline

- [x] 2.1 Change the web build to sync `apps/widget/dist/widget.js` into `apps/web/public/webchat/widget.js`
- [x] 2.2 Update the embed code generator to emit `window.Open333CRM.apiBaseUrl` and support an optional separate `WEB_BASE_URL`
- [x] 2.3 Update the web Docker build to include shared/widget workspace inputs and load `.env.web` during `next build`

## 3. Public routing and shortlinks

- [x] 3.1 Route `/webchat/*` to the web runtime and `/s/*` to the API runtime in `Caddyfile`
- [x] 3.2 Align shortlink copy behavior with the public browser origin instead of inferring `:3001`
- [x] 3.3 Keep shortlink QR/public URLs rooted at `API_BASE_URL`

## 4. IME-safe message submission

- [x] 4.1 Prevent widget Enter-to-send during active IME composition
- [x] 4.2 Prevent inbox Enter-to-send during active IME composition while preserving Shift+Enter newline behavior

## 5. Verification

- [x] 5.1 Build `@open333crm/shared`, `@open333crm/widget`, and `@open333crm/web` successfully after the runtime abstraction changes
- [x] 5.2 Update env examples to reflect the new public runtime contract (`NEXT_PUBLIC_API_URL`, `API_BASE_URL`, optional `WEB_BASE_URL`)
- [ ] 5.3 Manually verify the widget bundle, shortlink redirect, and public-origin API/socket traffic behind the deployed reverse proxy
