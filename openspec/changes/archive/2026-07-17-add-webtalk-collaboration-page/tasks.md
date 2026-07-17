## 1. WebTalk SDK Types and Loader

- [x] 1.1 Add TypeScript declarations for `window.WebTalk.mount()` and `window.WebTalk.unmount()`.
- [x] 1.2 Create a client-side WebTalk host/loader component or helper that injects `https://webtalk-nine.vercel.app/webtalk.js`.
- [x] 1.3 Set `data-webtalk-auto-mount="false"` and `data-webtalk-ai-endpoint="https://webtalk-nine.vercel.app/api/webtalk/ai"` on the injected script.
- [x] 1.4 Ensure the loader reuses an existing WebTalk script element instead of inserting duplicates.
- [x] 1.5 Add loading and failure states for SDK readiness without blocking the rest of the dashboard shell.

## 2. Global Dashboard Mount

- [x] 2.1 Add WebTalk global loading inside the authenticated dashboard shell.
- [x] 2.2 Keep WebTalk headless with no dedicated dashboard page or tab.
- [x] 2.3 Mount WebTalk after SDK readiness with `scope: 'origin'`, `siteId: 'open333crm-uat'`, and `enableVirtualRoom: false`.
- [x] 2.4 Unmount WebTalk from the dashboard shell cleanup path when the user leaves the authenticated dashboard.

## 3. Dashboard Navigation and Logout Cleanup

- [x] 3.1 Ensure the sidebar does not expose a dedicated WebTalk navigation entry.
- [x] 3.2 Update `AuthProvider.logout()` to best-effort call `window.WebTalk.unmount()` before clearing session state and navigating to `/login`.
- [x] 3.3 Keep the integration frontend-only with no API, database, worker, or Socket.IO changes.

## 4. Validation

- [x] 4.1 Run `pnpm --filter @open333crm/web exec tsc --noEmit`.
- [x] 4.2 Run `openspec validate add-webtalk-collaboration-page --strict`.
- [x] 4.3 Manually verify the authenticated dashboard shell loads the script once, calls `mount()` after auth, and calls `unmount()` on shell cleanup/logout.
