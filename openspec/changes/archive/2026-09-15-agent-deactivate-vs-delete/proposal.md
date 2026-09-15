## Why

後台人員管理的「停用」實際只把 Agent 設 `isActive=false`，但 email 唯一性（`agents.@@unique([email])`，多租戶登入靠 email 解析租戶）擋的是「記錄存在」而非「啟用中」。加上目前根本沒有「真刪除」功能——`DELETE /agents/:id` 名為 delete、掛 `agent.delete`，行為卻是停用（`deactivateAgent` 只做 `isActive:false`）。結果：同一 email 想從 A 租戶移到 B 租戶時，B 租戶新增人員被「Email 已被使用」擋住，只能進 DB 硬刪釋放。實際踩過（jiarong / timweng 佔用 email，2026-09-07 進 DB 手刪）。對應 Jira CM-174。

## What Changes

- **語義拆分為兩個明確動作**：
  - **停用（Deactivate）**：`isActive=false`，保留 Agent 記錄與 email 佔用，可再啟用。新端點 `POST /agents/:id/deactivate`，權限 `agent.deactivate`。
  - **刪除（Purge）**：真正 `DELETE` Agent 記錄，釋放 email。`DELETE /agents/:id` 改為真刪除，權限改 `agent.purge`。
- **BREAKING（內部）**：`DELETE /agents/:id` 行為由「停用」改為「真刪除」；前端現有呼叫此端點的「停用」按鈕需改指向新的 deactivate 端點，否則會誤刪。
- **安全刪除流程**：刪除前於交易內清理對 `agents` 為 RESTRICT 的外鍵（`notifications`、`cli_sessions`、`passkey_credentials`），CASCADE（`agent_team_members`）與 SET NULL（cases/conversations/messages/case_events/audit_logs 等）由 DB 自理；含防呆（限本租戶、二次確認）。
- **新增權限點**：`agent.deactivate`、`agent.purge`（`agent.delete` 保留相容或標記淘汰）。新增後需跑 reconcile 讓既有租戶 system role 取得。
- **前端**：人員編輯彈窗把單一「停用帳號」拆成「停用」與「刪除」兩個入口，刪除加危險樣式 + 二次確認（提示不可復原、將釋放 email、解除對話/案件指派）；停用狀態明示「email 仍被佔用，需他處重用請改用刪除」。
- **不改** `@@unique([email])` 策略（多租戶登入核心假設）。

## Capabilities

### New Capabilities
- `agent-lifecycle`: 人員帳號的停用（可逆、保留 email）與刪除（不可逆、釋放 email、清理關聯）兩種生命週期動作的行為契約、權限、與資料清理規則。

### Modified Capabilities
<!-- 無既有 spec 之 requirement 改寫；rbac 僅新增權限點屬新增。 -->

## Impact

- **後端（apps/api）**：`agent.service.ts` 新增 `purgeAgent`（交易內清 RESTRICT 關聯後刪 Agent）、保留 `deactivateAgent`；`agent.routes.ts` 新增 `POST /:id/deactivate`（權限 agent.deactivate）、`DELETE /:id` 改接 purgeAgent（權限 agent.purge）。走 `request.tenantPrisma`（RLS）。
- **權限（packages/core/src/rbac/permissions.ts、seed-data/rbac-roles.ts）**：新增 `agent.deactivate`、`agent.purge`；預設賦予 admin 類 system role。
- **前端（apps/web/src/components/settings/AgentManagement.tsx）**：拆停用/刪除兩入口、危險確認、usePermission 判斷。
- **部署**：跑 `scripts/reconcile-system-role-permissions.mjs` + 清權限快取。
- **CHANGELOG.md**：必更。
