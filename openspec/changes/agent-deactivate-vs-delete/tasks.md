## 1. 權限點

- [x] 1.1 `packages/core/src/rbac/permissions.ts` 新增 `agent.deactivate`（停用成員）、`agent.purge`（刪除成員/釋放 email），group「人員與權限」，dependsOn ['agent.view']
- [x] 1.2 `packages/database/prisma/seed-data/rbac-roles.ts` 把兩個新權限賦予 admin 類 system role（比照 agent.delete 現有配置）

## 2. 後端 service

- [x] 2.1 `agent.service.ts` 保留 `deactivateAgent`（isActive:false，現有行為）
- [x] 2.2 新增 `purgeAgent(prisma, tenantId, agentId)`：findFirst 限本租戶→交易內 delete notifications/cli_sessions/passkey_credentials(agentId)→delete agent；回傳結果
- [x] 2.3 purge 前防呆：agent 不存在回 404

## 3. 後端 routes

- [x] 3.1 新增 `POST /agents/:id/deactivate`（權限 `agent.deactivate`）→ deactivateAgent
- [x] 3.2 `DELETE /agents/:id` 改接 `purgeAgent`，權限由 `agent.delete` 改 `agent.purge`；更新 audit action 標記
- [x] 3.3 兩端點皆走 request.tenantPrisma

## 4. 前端

- [x] 4.1 `AgentManagement.tsx` 編輯彈窗：把單一「停用帳號」拆成「停用」「刪除」兩個入口
- [x] 4.2 停用 → `POST /agents/:id/deactivate`；刪除 → `DELETE /agents/:id`
- [x] 4.3 刪除加危險樣式 + 二次確認（提示不可復原、釋放 email、解除對話/案件指派）
- [x] 4.4 usePermission：停用鈕看 `agent.deactivate`、刪除鈕看 `agent.purge`
- [x] 4.5 停用狀態人員 UI 明示「email 仍被佔用，如需他處重用請改用刪除」

## 5. 收尾

- [x] 5.1 typecheck（api + web）過
- [x] 5.2 本機驗證：建測試 agent→停用(email 仍佔)→刪除(email 釋放，可重建)；有 notification 關聯的也能刪
- [ ] 5.3 跑 `scripts/reconcile-system-role-permissions.mjs` + 清權限快取（本機）
- [x] 5.4 更新 CHANGELOG.md（Added: 停用/刪除拆分；Changed: DELETE /agents/:id 語義）
