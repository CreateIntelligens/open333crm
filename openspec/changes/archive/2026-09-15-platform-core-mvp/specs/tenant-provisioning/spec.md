# tenant-provisioning

## ADDED Requirements

### Requirement: provisionTenant 開通服務
系統 SHALL 提供 `provisionTenant(tx, input)`：在呼叫端提供的 transaction 內依序建立 Tenant（含 planId、可選 trialEndsAt）→ 三個 system roles（複用 `seedRolesForTenant`，其參數型別 MUST 放寬為 Prisma.TransactionClient）→ ADMIN agent（bcrypt hash、role enum 與 roleId 雙寫）。任一步失敗 MUST 隨 transaction 整體回滾，不留孤兒資料。

#### Scenario: 開通成功
- **WHEN** provisionTenant 以有效輸入執行
- **THEN** Tenant、三個 system roles（admin/supervisor/agent，isSystem=true）、一個 ADMIN agent MUST 同時存在
- **AND** 該 admin agent 以輸入密碼 MUST 能登入並取得完整（天花板內）權限

#### Scenario: 中途失敗全回滾
- **WHEN** 建立 agent 步驟失敗（如 email 撞全域唯一）
- **THEN** Tenant 與 roles MUST 不存在（整體回滾）

### Requirement: 平台手動開通 API
平台 API SHALL 提供 `POST /api/v1/platform/tenants`（name、planSlug、admin email/name/password）呼叫 provisionTenant 開通，成功 MUST 寫 PlatformAuditLog；admin email 已被任一租戶使用時 MUST 回 409。

#### Scenario: superuser 手動開通
- **WHEN** superuser 提交合法開通請求
- **THEN** 回傳新 tenantId，且該租戶立即可登入使用

#### Scenario: email 已被使用
- **WHEN** 開通請求的 admin email 已存在於任一租戶
- **THEN** 回 409 且不建立任何資料
