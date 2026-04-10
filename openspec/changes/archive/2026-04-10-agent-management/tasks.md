## 1. Service Layer

- [x] 1.1 Create `apps/api/src/modules/agent/agent.service.ts` with `createAgent(tenantId, data)` method — hash password with bcrypt, insert agent, return agent without `passwordHash`
- [x] 1.2 Add `updateAgentRole(tenantId, agentId, role)` method to agent service — find agent in tenant, update role, return updated agent
- [x] 1.3 Add `changeOwnPassword(agentId, currentPassword, newPassword)` method to agent service — verify current password with bcrypt.compare, hash new password, update `passwordHash`

## 2. Route Handlers

- [x] 2.1 Add `POST /api/v1/agents` route in `agent.routes.ts` with `[fastify.authenticate, requireSupervisor()]` preHandlers — validate body (name, email, role, password), enforce Supervisor cannot set role ADMIN, call `createAgent`, return 201
- [x] 2.2 Add `PATCH /api/v1/agents/:id/role` route with `[fastify.authenticate, requireSupervisor()]` preHandlers — validate body (role), enforce Supervisor cannot set role ADMIN, call `updateAgentRole`, return 200 or 404
- [x] 2.3 Add `PATCH /api/v1/agents/me/password` route with `[fastify.authenticate]` preHandler — validate body (currentPassword, newPassword min 8 chars), call `changeOwnPassword`, return 200 or 400

## 3. Input Validation

- [x] 3.1 Define Zod (or JSON Schema) body schema for `POST /agents`: `name` (string, required), `email` (email, required), `role` (AgentRole enum, required), `password` (string, min 8, required)
- [x] 3.2 Define body schema for `PATCH /agents/:id/role`: `role` (AgentRole enum, required)
- [x] 3.3 Define body schema for `PATCH /agents/me/password`: `currentPassword` (string, required), `newPassword` (string, min 8, required)

## 4. Error Handling

- [x] 4.1 Return HTTP 409 `{ code: "CONFLICT", message: "Email already in use" }` when creating agent with duplicate email in tenant
- [x] 4.2 Return HTTP 404 when `PATCH /agents/:id/role` targets a non-existent agent in the tenant
- [x] 4.3 Return HTTP 400 `{ code: "INVALID_PASSWORD", message: "Current password is incorrect" }` when `changeOwnPassword` fails bcrypt check

## 5. Spec Sync (at archive)

- [x] 5.1 Merge `specs/rbac/spec.md` delta into `openspec/specs/rbac/spec.md` — update "Agent Management Access" requirement to reflect Supervisor permission
- [x] 5.2 Create `openspec/specs/agent-management/spec.md` from the delta spec

## 6. Manual QA

- [ ] 6.1 As Admin: create a new agent via `POST /agents`, verify 201 and agent appears in `GET /agents`
- [ ] 6.2 As Supervisor: create an AGENT-role agent, verify 201; attempt to create an ADMIN agent, verify 403
- [ ] 6.3 As any agent: change own password via `PATCH /agents/me/password`, verify login works with new password; verify wrong current password returns 400
- [ ] 6.4 As Admin: assign ADMIN role via `PATCH /agents/:id/role`, verify 200; as Supervisor attempt same, verify 403

## 7. todo
- [x] 7.1 新增人員如果Email already in use，前端顯示錯誤訊息「Email已被使用」
- [x] 7.2 要可以刪除agent，或至少deactivate agent（isActive=false），以防止帳號被濫用
- [x] 7.3 Admin要可以重置其他agent的密碼（不要求目前密碼），在編輯popup操作
- [x] 7.4 apps/web/src/lib/api.ts，修正為如果當前在登入頁，直接顯示錯誤訊息「登入失敗，請檢查帳號密碼」，其餘401錯誤保持原有行為（刷新页面）
