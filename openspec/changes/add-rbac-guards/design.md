## Context

JWT authentication is fully operational: `fastify.authenticate` decodes a signed token and populates `request.agent` with `{ id, tenantId, role }` on every authenticated request. The `AgentRole` enum defines three levels — `ADMIN`, `SUPERVISOR`, and `AGENT` (default). Despite role information being present in every request context, no route-level enforcement exists today. Any authenticated user with a valid token can call any API endpoint regardless of their assigned role, including operations such as deleting Agents, modifying Channels, or accessing Analytics — creating a clear security vulnerability that must be addressed before the product scales to multi-tenant production use.

## Goals / Non-Goals

**Goals:**
- Introduce a `requireRole(allowedRoles: AgentRole[])` guard factory that integrates natively with Fastify's `preHandler` array pattern.
- Provide `requireAdmin()` and `requireSupervisor()` convenience wrappers to reduce per-route boilerplate.
- Apply role guards to the highest-risk route groups first: Agent CRUD, Channel CRUD, Automation Rules CRUD, Settings, Analytics, Marketing, Webhooks, and Portal.
- Establish a consistent 403 response shape that aligns with the existing error handler contract.
- Ensure guards never execute before authentication — guard ordering is enforced by convention, not framework magic.

**Non-Goals:**
- Data-level row filtering (e.g., AGENT sees only their own assigned cases or conversations) — this is deferred to a follow-up change.
- Granular permission bits or resource-scoped ACL beyond the three existing roles.
- Frontend route guarding or UI-level role redirects — this change is API-only.
- Adding new roles beyond `ADMIN`, `SUPERVISOR`, and `AGENT`.
- Retrofitting RBAC onto every single route in a single pass — initial rollout covers security-critical routes only.

## Decisions

### Decision: Guard factory pattern (`requireRole(roles[])`) over individual decorators

`requireRole(allowedRoles: AgentRole[])` returns a Fastify `preHandler` function. `requireAdmin()` and `requireSupervisor()` are thin wrappers around it.

Rationale:
- A factory is composable: any route can express any role combination without adding new exports.
- Convenience wrappers cover the two most common cases (`ADMIN only`, `SUPERVISOR or above`) without repeating the array literal at every call site.
- A decorator-per-role approach (`@AdminOnly`, `@SupervisorOnly`) would require a decorator layer on top of Fastify's plain function model and adds unnecessary coupling.

Alternative considered:
- Dedicated boolean fields on route options schema (e.g., `adminOnly: true`). Rejected because it requires a custom plugin to read those fields and apply the handler, which is more complexity for no additional expressiveness.

### Decision: `preHandler` array ordering — authenticate first, then RBAC

All routes that use RBAC SHALL declare `preHandler: [fastify.authenticate, requireRole(...)]` in that order.

Rationale:
- RBAC guards read `request.agent.role`, which only exists after `fastify.authenticate` runs. Reversing the order would cause a runtime crash or undefined behavior.
- Explicit ordering in the route definition makes the dependency visible at the call site.

Alternative considered:
- A combined `authenticateAndRequireRole()` wrapper that calls authenticate internally. Rejected because it hides the authentication step, breaks composability with routes that only need authentication, and diverges from how the rest of the codebase uses `fastify.authenticate`.

### Decision: 403 response shape — `{ code: 'FORBIDDEN', message: 'Insufficient role' }`

When a role check fails, the guard responds with HTTP 403 and the JSON body `{ code: 'FORBIDDEN', message: 'Insufficient role' }`.

Rationale:
- Consistent with the existing API error handler's `{ code, message }` envelope used for 401 and other structured errors.
- A machine-readable `code` field lets the frontend distinguish RBAC failures from other 4xx errors without parsing message strings.

Alternative considered:
- Throw a Fastify `HttpError` (e.g., `createError(403, 'Forbidden')`). Rejected because the default Fastify error serializer produces a different shape than the project's established error envelope, requiring extra mapping anyway.

### Decision: Scope of initial rollout — security-critical routes only

The first rollout applies guards to: Agent create/update/delete, Channel CRUD, Automation Rules CRUD, Settings (SLA, office hours), Analytics, Marketing/Broadcast, Webhook Subscriptions, and Portal settings. Routes open to all authenticated roles (Contacts, Tags, Knowledge, Storage, Canvas, Conversations) receive no new guard in this change.

Rationale:
- Restricting high-risk destructive and administrative operations is the primary threat model to address immediately.
- Applying guards to every route in a single pass increases the blast radius of a misconfiguration.
- Routes open to all authenticated users are already protected by `fastify.authenticate`; the incremental risk of not adding `requireRole` is zero.

Alternative considered:
- Apply guards to all 25+ route files in a single change. Rejected because it creates a large, difficult-to-review PR and risks accidentally locking down a route that should remain open.

### Decision: Route-level blocking only — data-level filtering deferred

This change enforces role at the HTTP route level (allow or deny the request entirely). It does not filter query results based on the requesting agent's assignment or ownership.

Rationale:
- Route-level enforcement is the first and most important control layer. It closes the most critical privilege escalation paths.
- Data-level filtering (e.g., AGENT can only see their own conversations) requires changes to service queries and is a separate, non-trivial piece of work.
- Mixing both concerns in one change would make the diff significantly larger and harder to validate.

Alternative considered:
- Implement both route-level and data-level controls simultaneously. Rejected due to scope and review complexity.

## Risks / Trade-offs

- [Misconfigured guard locks out legitimate users] → Mitigation: manual smoke tests with each role before merging; tasks include explicit test scenarios for AGENT, SUPERVISOR, and ADMIN.
- [Guard ordering violated by future route authors] → Mitigation: document the ordering convention in code comments on the guard factory and in the CHANGELOG; consider a lint rule as a follow-up.
- [Route files discovered to use a different preHandler shape] → Mitigation: audit route files during implementation; tasks include a pre-implementation inventory step.
- [Data-level enforcement gap gives false sense of security] → Mitigation: explicitly document in CHANGELOG and design that AGENT scope filtering is a follow-up; no claims of complete RBAC are made in this change.

## Migration Plan

1. Create `apps/api/src/guards/rbac.guard.ts` with `requireRole()`, `requireAdmin()`, and `requireSupervisor()`.
2. Export the new guards from the guards barrel if one exists.
3. Apply `requireAdmin()` to Agent create/update/delete routes.
4. Apply `requireAdmin()` and `requireSupervisor()` to Channel, Automation, Settings, Analytics, Marketing, Webhook, and Portal routes per the permission matrix.
5. Build the API and confirm no TypeScript errors.
6. Smoke-test with AGENT, SUPERVISOR, and ADMIN tokens against guarded routes.
7. Update CHANGELOG.md.

Rollback:
- Remove the `preHandler` guard entries from each modified route file.
- Delete `apps/api/src/guards/rbac.guard.ts`.
- The underlying authentication flow is unchanged and requires no rollback.

## Open Questions

- Should a route audit confirm the exact method + path for every Automation, SLA, and Portal route before tasks are executed, or is the current module structure sufficient to identify them?
- Is there an existing integration test suite for routes that should be updated to assert 403 responses for unauthorized roles, or is manual smoke testing the only validation path for this change?
