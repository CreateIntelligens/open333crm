## Why

Open333CRM needs the external WebTalk multi-user chat experience available globally for authenticated dashboard operators. The integration should load the vendor script only after the dashboard session is active and cleanly unmount it when the user logs out or leaves the authenticated dashboard shell.

## What Changes

- Load WebTalk globally after an authenticated dashboard session is available.
- Load the WebTalk SDK script from `https://webtalk-nine.vercel.app/webtalk.js` with `data-webtalk-auto-mount="false"` and `data-webtalk-ai-endpoint="https://webtalk-nine.vercel.app/api/webtalk/ai"`.
- Mount WebTalk after the dashboard user is authenticated with:
  - `scope: 'origin'`
  - `siteId: 'open333crm-uat'`
  - `enableVirtualRoom: false`
- Unmount WebTalk when the authenticated dashboard shell is cleaned up and when `AuthProvider.logout()` runs.
- Do not add a WebTalk tab, sidebar entry, or dedicated dashboard page.
- Keep the integration frontend-only; no CRM database, API, worker, or Socket.IO changes are required.

## Capabilities

### New Capabilities

- `webtalk-collaboration`: Authenticated dashboard users get the WebTalk multi-user chat SDK mounted globally while they are logged in.

### Modified Capabilities

- None.

## Impact

- Web: `apps/web/src/app/dashboard/layout.tsx` for authenticated global loading and `apps/web/src/providers/AuthProvider.tsx` for logout cleanup.
- Web shared code: a client-side WebTalk loader/mount component or helper with TypeScript declarations for `window.WebTalk`.
- External dependency: runtime script loaded from `https://webtalk-nine.vercel.app/webtalk.js`; no package install is expected.
- Validation: web typecheck and focused manual/runtime verification that the script is loaded once, mounts after auth, and unmounts on dashboard shell cleanup/logout.
