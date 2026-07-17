## Context

The web app is a Next.js dashboard with authentication handled by `AuthProvider` inside `apps/web/src/app/dashboard/layout.tsx`. Dashboard routes render only after an agent session is restored or established, and logout is centralized in `AuthProvider.logout()`. The requested WebTalk integration is an external browser SDK loaded by script tag and controlled through `window.WebTalk.mount()` / `window.WebTalk.unmount()`. The desired behavior is global loading after login, not a dedicated dashboard tab.

The integration is frontend-only. It does not need Fastify routes, Prisma tables, workers, Redis, or Open333CRM Socket.IO events.

## Goals / Non-Goals

**Goals:**

- Load and mount WebTalk globally after a dashboard user is authenticated.
- Load the WebTalk SDK script with auto-mount disabled and the provided AI endpoint.
- Mount WebTalk after a dashboard user is authenticated with the requested `scope`, `siteId`, and `enableVirtualRoom` values.
- Unmount WebTalk when the authenticated dashboard shell unmounts and when the user logs out.
- Keep TypeScript strict enough to avoid ad hoc `any` access to `window.WebTalk`.

**Non-Goals:**

- No backend proxy or persistence for WebTalk messages.
- No CRM agent identity mapping unless the WebTalk SDK later documents supported user metadata.
- No changes to Open333CRM websocket rooms, inbox conversations, chatbox sessions, or visitor webchat.
- No npm dependency install for WebTalk.
- No dedicated WebTalk dashboard page, sidebar tab, or route.

## Decisions

1. Mount WebTalk from the authenticated dashboard layout.

   Rationale: The dashboard layout already gates access on `agent`. Rendering a headless WebTalk global component only after that gate ensures the SDK loads after login and remains available across dashboard routes.

   Alternative considered: A dedicated `/dashboard/webtalk` page and sidebar tab. That was rejected because the desired behavior is a globally available chat kit after login, not a page the user must open.

2. Load the SDK from a client-only component.

   Rationale: The WebTalk API is exposed on `window`, so loading and mounting must happen in a client component with `useEffect`. The component should create or reuse a script element for `https://webtalk-nine.vercel.app/webtalk.js`, set `data-webtalk-auto-mount="false"`, set `data-webtalk-ai-endpoint="https://webtalk-nine.vercel.app/api/webtalk/ai"`, and return no visible dashboard UI.

   Alternative considered: Place a raw script tag in a layout. That would be easier to add but harder to coordinate with authenticated mount timing and cleanup behavior.

3. Make mount idempotent and cleanup explicit.

   Rationale: Next.js client navigation can remount components, and users may leave the dashboard shell without logging out. The loader should avoid injecting duplicate script tags, call `window.WebTalk.mount({ scope: 'origin', siteId: 'open333crm-uat', enableVirtualRoom: false })` only when the SDK is ready, and call `window.WebTalk.unmount()` during cleanup if the SDK exists.

   Alternative considered: Rely on WebTalk's internal duplicate handling. That assumes behavior not documented in the request and makes regressions harder to isolate.

4. Call `window.WebTalk.unmount()` from logout as a best-effort cleanup.

   Rationale: Logout can occur from the sidebar or topbar while WebTalk is mounted globally. Since `AuthProvider.logout()` is the common logout path, it should clean up the external widget before clearing session state and navigating to `/login`.

   Alternative considered: Only unmount in the page component cleanup. That covers normal route transitions but is less explicit for logout and future logout entry points.

5. Keep configuration local and typed for the first implementation.

   Rationale: The provided URLs and `siteId` are UAT-specific constants. A small typed config/helper is enough for the requested integration and avoids adding environment validation work before the feature is proven.

   Alternative considered: Add environment variables immediately. That is useful later for production rollout but expands the change into deployment configuration and validation concerns.

## Risks / Trade-offs

- [Risk] The external script is unavailable or blocked by browser policy. -> Mitigation: log initialization failure and keep the rest of the dashboard usable.
- [Risk] The SDK changes its global API shape. -> Mitigation: centralize the `window.WebTalk` type and calls in one component/helper.
- [Risk] The UAT `siteId` is later wrong for production. -> Mitigation: keep the value isolated so it can move to runtime config in a follow-up.
- [Risk] WebTalk creates DOM outside the React subtree. -> Mitigation: always call `unmount()` on dashboard shell cleanup and logout.
