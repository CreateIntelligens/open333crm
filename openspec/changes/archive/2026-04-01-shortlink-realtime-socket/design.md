## Architecture

### Socket.IO 廣播流

```
訪客點擊 /s/:slug
        │
        ▼
shortlink-redirect.routes.ts
  handleClick(prisma, slug, meta, app.io)
        │
        ▼
shortlink.service.ts:handleClick()
  1. DB upsert click session (unique tracking)
  2. prisma.shortLink.update({ totalClicks: +1 })
  3. io.to(`tenant:${tenantId}`).emit('link.stats.updated', {
       shortLinkId, totalClicks, uniqueClicks
     })
        │
        ▼
Socket.IO → tenant room
  所有同 tenant 的已登入 agent 收到事件
        │
        ▼
useShortLinks (列表頁) → mutate()   ← 列表中的總點擊數更新
useClickStats (詳情頁) → mutate()   ← 統計面板即時更新
```

### Caddy Routing Fix

```
Before:
  /api/*      → api:3001
  /*          → web:3000   ← socket.io requests land here, fail

After:
  /api/*      → api:3001
  /socket.io/* → api:3001  ← correct
  /*          → web:3000
```

Caddy 2 自動處理 `Connection: Upgrade` headers，不需要額外 WebSocket 設定。

## Room Strategy

廣播範圍選用 `tenant:${tenantId}`（tenant-wide），而非 `agent:${link.createdById}`（僅建立者）。

理由：CRM 是協作工具，同一 tenant 內的所有 agent 都可能在監看短連結列表，tenant-wide 廣播讓整個團隊都能即時看到點擊數，符合協作場景需求。

若未來需要更細粒度控制，可改用：
- `agent:${agentId}` — 僅通知建立者
- `io.to('tenant:X').except('agent:Y').emit(...)` — 排除特定人

## 未來新增事件的模式

1. 在 service 層 import `Server as SocketIOServer` from `socket.io`
2. 將 `io?` 作為可選參數傳入 service 函數
3. 呼叫 `io.to(room).emit(eventName, payload)`
4. 前端在對應 hook 用 `socket.on(eventName, handler)` 訂閱，cleanup 用 `socket.off`

Worker 程序（apps/workers/）無法直接存取 `fastify.io`，改用 `publishSocketEvent(redis, room, event, data)` 透過 Redis pub/sub 橋接。
