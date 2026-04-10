## Why

The platform currently has no API endpoints for creating agents or managing their roles and passwords. Admins and Supervisors need a way to onboard new team members, assign appropriate roles, and all agents need the ability to change their own password.

## What Changes

- Add `POST /api/v1/agents` — create a new agent (Admin + Supervisor only)
- Add `PATCH /api/v1/agents/:id/role` — update an agent's role (Admin + Supervisor only)
- Add `PATCH /api/v1/agents/me/password` — change own password (all authenticated agents)
- Update RBAC spec: Supervisor role is now also allowed to create agents and assign roles (previously ADMIN-only per rbac spec)

## Capabilities

### New Capabilities
- `agent-management`: Create agents, assign roles, and change passwords via REST API

### Modified Capabilities
- `rbac`: The "Agent Management Access" requirement changes — Supervisor MAY now create agents and update roles (previously only ADMIN was allowed)

## Impact

- `apps/api/src/modules/agent/agent.routes.ts` — new POST, PATCH routes
- `apps/api/src/modules/agent/agent.service.ts` — new (or extended) service methods
- `openspec/specs/rbac/spec.md` — update Agent Management Access scenarios to reflect Supervisor permission
- `packages/database/prisma/schema.prisma` — no schema changes needed (Agent model already has `role`, `passwordHash`, `isActive` fields)
