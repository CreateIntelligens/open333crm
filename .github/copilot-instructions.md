# GitHub Copilot & Coding Agent Instructions

This file provides project-wide conventions for GitHub Copilot, Claude, and any other AI coding agents working in this repository.

---

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **API**: Fastify + TypeScript (`apps/api`)
- **Frontend**: React + Vite + TypeScript (`apps/web`)
- **Background workers**: BullMQ consumers (`apps/workers`)
- **Database**: PostgreSQL via Prisma (`packages/database`)
- **Real-time**: Socket.IO (mounted on Fastify)
- **Queue**: Redis + BullMQ

---

## Socket Event Routing — CRITICAL ARCHITECTURE RULE

There are **two paths** for emitting socket events to the frontend. Always choose the correct one:

### Path A — API process direct emit

```ts
fastify.io.to(room).emit(event, data)
```

**Use when:**
- The event is the direct result of the current HTTP request handler
- Data is already written to DB within this request (no extra queries needed)
- The recipient room is already known (conversation ID, tenant ID, agent ID)
- Latency matters — the emit should happen inline, before the response returns

**Examples:** `message.new`, `conversation.updated`, `case.created`, `contact.merged`

---

### Path B — Async queue (eventBus → BullMQ → apps/workers)

```ts
// Step 1 (API): publish to in-process event bus
eventBus.publish('case.assigned', { tenantId, payload })

// Step 2 (API): event-bus worker bridges to BullMQ
notificationQueue.add('notification:dispatch', jobPayload)

// Step 3 (apps/workers): consume job and emit via Redis bridge
await publishSocketEvent(redisPublisher, `agent:${agentId}`, 'notification.new', notification)
```

**Use when:**
- Finding recipients requires **additional DB queries** (e.g., look up all supervisors)
- The work is a **side-effect** that must not block or delay the HTTP response
- Multiple recipients need to be notified based on roles or dynamic assignment
- The event originates from a background job (SLA poll, automation rule, broadcast)

**Examples:** `case.assigned` notification, `sla.warning`, `sla.breached`, automation side-effects

---

### Workers cannot use `fastify.io` directly

`apps/workers` is a **separate process** with no access to the API's Fastify/Socket.IO instance.  
Workers MUST emit socket events through the Redis pub/sub bridge:

```ts
// In apps/workers — correct
await redisPublisher.publish('socket:emit', JSON.stringify({ room, event, data }))

// In apps/api — correct (direct)
fastify.io.to(room).emit(event, data)

// NEVER do this in apps/workers — wrong
import { io } from '../../../apps/api/src/...'  // does not work cross-process
```

The API's `socket.plugin.ts` subscribes to the `socket:emit` Redis channel and forwards messages to Socket.IO.

---

## Event Bus

`eventBus` (`apps/api/src/events/event-bus.ts`) is a **Node.js EventEmitter singleton**.

- It is **in-process only** — it has **no connection to Redis**
- Subscribers (e.g. `notification.worker.ts`, `automation.worker.ts`) run inside the API process
- They enqueue BullMQ jobs when they receive events
- The actual job processing happens in `apps/workers`

```
eventBus.publish('case.assigned', ...)
  └→ notification.worker.ts (API process, EventEmitter subscriber)
       └→ notificationQueue.add(job)  → Redis/BullMQ
            └→ apps/workers consumes job → DB write → Redis pub/sub → frontend socket
```

---

## Prisma Client

- The shared Prisma schema is in `packages/database`
- **Import `PrismaClient` from `@open333crm/database`**, not `@prisma/client`
- **Do NOT import Prisma-generated enum types** (`AgentRole`, etc.) — use string literals instead:

```ts
// Correct
role: { in: ['ADMIN', 'SUPERVISOR'] }

// Wrong — causes TS2305 error
import { AgentRole } from '@prisma/client'
role: { in: [AgentRole.ADMIN, AgentRole.SUPERVISOR] }
```

---

## RBAC

- Roles: `ADMIN` > `SUPERVISOR` > `AGENT`
- Guards: `requireAdmin()`, `requireSupervisor()` in `apps/api/src/guards/rbac.guard.ts`
- Register guards as Fastify `preHandler`:

```ts
fastify.patch('/agents/:id/role', { preHandler: [requireSupervisor()] }, handler)
```

---

## Conventions

- Use **Zod** for input validation in API route handlers
- Errors: throw `new AppError(code, message, httpStatus)` — do not return raw error objects
- All tenants are isolated — every query must include `tenantId` in the `where` clause
- Soft-delete via `isActive: false`, not hard `DELETE` (for agents, channels, etc.)
- Use conventional commits (`feat:`, `fix:`, `chore:`, etc.)
- All commits should include the Co-authored-by trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
