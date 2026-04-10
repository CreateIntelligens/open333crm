## Context

The Agent model already exists in the database with `role`, `passwordHash`, `isActive`, and `email` fields. The RBAC guard infrastructure is in place (`requireRole`, `requireSupervisor`, `requireAdmin`). However, the current `agent.routes.ts` only exposes `GET /agents` (list). There is no way to create agents, update roles, or change passwords via the API.

The existing RBAC spec states ADMIN-only for creating/updating/deleting agents. This change extends that to allow SUPERVISOR as well (per product decision).

## Goals / Non-Goals

**Goals:**
- `POST /agents` — create a new agent (Admin + Supervisor)
- `PATCH /agents/:id/role` — update an agent's role (Admin + Supervisor)
- `PATCH /agents/me/password` — change own password (all authenticated agents)
- Update RBAC spec scenarios accordingly

**Non-Goals:**
- Agent deactivation / deletion (separate concern)
- Admin resetting another agent's password (not requested)
- Email/name profile updates beyond role and password

## Decisions

### Password hashing
Use `bcrypt` (already a dependency via auth module). Hash the new password before storing. Require the current password to be provided as verification before allowing the change — prevents account takeover if a session token is stolen.

**Alternative**: Accept password reset without current-password check. Rejected — too risky for a self-service endpoint.

### Role assignment scope
Only ADMIN can promote another agent to ADMIN. SUPERVISOR can assign AGENT or SUPERVISOR roles. This prevents privilege escalation where a SUPERVISOR promotes themselves or others to ADMIN.

**Alternative**: Allow SUPERVISOR to assign any role including ADMIN. Rejected — violates principle of least privilege.

### Initial password on create
A temporary password is set on creation. The creating Admin/Supervisor provides it explicitly in the request body. No email-based invite flow is in scope.

### Route placement
All new routes added to `apps/api/src/modules/agent/agent.routes.ts`. Service logic extracted to `agent.service.ts` (new file) for testability.

## Risks / Trade-offs

- [Risk] Supervisor privilege escalation → Mitigation: API enforces that Supervisor cannot set role to ADMIN
- [Risk] Password change without re-auth → Mitigation: Require `currentPassword` field; verify against stored hash before updating
- [Risk] Conflicting email on agent create → Mitigation: Return HTTP 409 if email already exists in tenant

## Migration Plan

No database migrations needed — schema is already complete. Deploy API changes only.
