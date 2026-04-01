## Why

短連結模塊的「總點擊」數字沒有即時更新：後端在每次點擊後只更新資料庫，沒有透過 Socket.IO 通知前端；前端 SWR hook 只在 window focus 時 revalidate，導致數字需要重新整理頁面才會更新。

另外，Caddy reverse proxy 缺少 `/socket.io/*` 路由規則，所有 WebSocket 連線請求被轉發到 `web:3000` 而非 `api:3001`，導致 `WebSocket connection failed: timeout` 錯誤，socket 降級為 polling 仍然失敗。

## What Changes

- 在 `shortlink.service.ts:handleClick()` 中，點擊計數更新後透過 Socket.IO 向 `tenant:${tenantId}` 房間廣播 `link.stats.updated` 事件
- 在 `shortlink-redirect.routes.ts` 的公開重定向路由中，將 `app.io` 傳入 `handleClick()`
- 在 `useShortLinks.ts` 的兩個 hook（`useShortLinks` 和 `useClickStats`）中，訂閱 `link.stats.updated` 事件並呼叫 `mutate()` 觸發即時更新
- 在 `Caddyfile` 新增 `/socket.io/*` 路由，將 Socket.IO 流量正確轉發至 `api:3001`

## Capabilities

### Modified Capabilities
- `shortlinks`: 短連結模塊新增即時點擊統計廣播契約 — 每次點擊後透過 `link.stats.updated` 事件推送最新 `totalClicks` / `uniqueClicks`，廣播範圍為同一 tenant 的所有連線者

## Impact

- 受影響程式碼：`apps/api/src/modules/shortlink/shortlink.service.ts`、`apps/api/src/modules/shortlink/shortlink-redirect.routes.ts`、`apps/web/src/hooks/useShortLinks.ts`、`Caddyfile`
- 受影響 runtime：Caddy 重啟後 `/socket.io/*` 流量正確轉發；前端 socket 連線從 failed/polling 恢復為 WebSocket
- 不影響短連結點擊的 DB 更新邏輯或重定向流程
