## 1. Backend — Socket.IO emit on click

- [x] 1.1 In `shortlink.service.ts`, import `Server as SocketIOServer` from `'socket.io'`
- [x] 1.2 Add optional `io?: SocketIOServer` parameter to `handleClick()`
- [x] 1.3 After `prisma.shortLink.update()`, emit `link.stats.updated` to `tenant:${link.tenantId}` room with `{ shortLinkId, totalClicks, uniqueClicks }`

## 2. Backend — Wire io into redirect route

- [x] 2.1 In `shortlink-redirect.routes.ts`, pass `app.io` to `handleClick()` call

## 3. Frontend — Real-time hook subscriptions

- [x] 3.1 In `useShortLinks.ts`, import `useSocket` and `useEffect`
- [x] 3.2 In `useShortLinks` hook, subscribe to `link.stats.updated` → call `mutate()`, cleanup with `socket.off`
- [x] 3.3 In `useClickStats` hook, subscribe to `link.stats.updated` filtered by `shortLinkId` → call `mutate()`, cleanup with `socket.off`

## 4. Infrastructure — Caddy proxy fix

- [x] 4.1 Add `/socket.io/*` route to `Caddyfile` pointing to `api:3001`, placed before the wildcard `/*` → `web:3000` rule
- [x] 4.2 Restart Caddy container and verify `/socket.io/?EIO=4&transport=polling` returns HTTP 200

## 5. Verify

- [x] 5.1 API TypeScript build passes (`tsc` exit 0)
- [x] 5.2 Web Next.js build compiles successfully
- [x] 5.3 All containers Up after rebuild
- [x] 5.4 `/socket.io/` endpoint returns `{"upgrades":["websocket"]}` — confirmed via curl
- [x] 5.5 Update `CHANGELOG.md`
