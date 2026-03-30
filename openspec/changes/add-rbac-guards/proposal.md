## Why

JWT 認證已正常運作，Agent 的 role（ADMIN / SUPERVISOR / AGENT）也存在於 schema 並寫入 JWT payload，但目前所有已認證的 route 都對任何 role 開放存取。這意味著一般 AGENT 可以刪除其他 Agent、修改 Channel 設定、存取財務報表等高權限操作，是一個明確的安全漏洞。

## What Changes

- 新增 `apps/api/src/guards/rbac.guard.ts`：提供 `requireRole()`、`requireAdmin()`、`requireSupervisor()` guard factory
- 定義明確的 Permission Matrix：哪些 route 需要哪個最低 role
- 在對應 route handler 套用 RBAC guard 作為 `preHandler`
- 不改變現有 JWT auth 流程，RBAC guard 永遠排在 `fastify.authenticate` 之後

## Capabilities

### New Capabilities
- `rbac`: 定義 API route 的 role-based access control 契約，包含 ADMIN / SUPERVISOR / AGENT 三個 role 的存取邊界與 guard 介面規格。

### Modified Capabilities
- `core-inbox`: Inbox 相關 route（對話、訊息）的存取現在受 role 限制：AGENT 只能存取自己的指派對話，SUPERVISOR/ADMIN 可存取所有。

## Impact

- 受影響程式碼：`apps/api/src/guards/`（新增）、各 `modules/*/**.routes.ts`（套用 guard）
- 受影響 runtime：所有需要 ADMIN 或 SUPERVISOR 的 API 呼叫將回傳 403 FORBIDDEN（若 role 不符）
- 不影響現有 JWT token 格式或登入流程
