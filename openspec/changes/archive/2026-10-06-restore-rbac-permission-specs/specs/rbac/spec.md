## ADDED Requirements

### Requirement: 路由以權限碼授權

需要授權的租戶路由 SHALL 以 `requirePermission()`、`requireAnyPermission()` 或 `requirePermissionWhen()` 檢查成員的有效權限集合。這些 guard 用的權限碼 MUST 是權限註冊表內的碼。成員的角色列舉（`ADMIN`、`SUPERVISOR`、`AGENT`）MUST NOT 決定路由能否存取。

每條路由要求哪一個權限碼，以路由程式為準，這份規格不逐條列出。`docs/ref/modules/PERMISSIONS.md` 說明怎麼查出每個權限碼被哪些路由檢查。有效權限集合的計算見 `permission-check`。

#### Scenario: 缺少路由要求的權限碼
- **WHEN** 成員的有效權限集合含其他權限碼，但不含路由要求的權限碼，成員呼叫該路由
- **THEN** 系統回 HTTP 403，不執行操作

#### Scenario: 只有路由要求的權限碼
- **WHEN** 成員的有效權限集合只含路由要求的權限碼，成員呼叫該路由
- **THEN** 系統不因權限回 HTTP 403

#### Scenario: 角色列舉不影響路由存取
- **WHEN** 成員的角色列舉是 `ADMIN`，但指派給成員的角色沒有任何權限碼，成員呼叫要求權限碼的路由
- **THEN** 系統回 HTTP 403

### Requirement: Partner API 金鑰只通過白名單權限碼

Partner API 金鑰的請求沒有角色。權限檢查的 guard 遇到 Partner API 金鑰時，SHALL 只放行 `apps/api/src/guards/rbac.guard.ts` 的 `PARTNER_KEY_ALLOWED` 列出的權限碼。其他權限碼 SHALL 回 HTTP 403。

#### Scenario: 白名單內的權限碼放行
- **WHEN** 以 Partner API 金鑰呼叫要求 `knowledge.admin` 的路由，`knowledge.admin` 在白名單內
- **THEN** 系統不因權限回 HTTP 403

#### Scenario: 白名單外的權限碼被拒
- **WHEN** 以 Partner API 金鑰呼叫要求 `knowledge.view` 的路由，`knowledge.view` 不在白名單內
- **THEN** 系統回 HTTP 403，不執行操作

### Requirement: CLI token 的授權

CLI token 是 `cli_` 開頭、由 CLI session 驗證的 token。CLI 路由與 MCP 工具 SHALL 同時檢查兩件事，兩者都符合時才放行：

1. token 的 scope 含該功能要求的 scope。
2. 成員的有效權限集合含該操作要求的權限碼。這個權限碼與網頁上執行同一個操作的路由要求的權限碼相同。

權限檢查的 guard 遇到 CLI token 時，MUST 依成員的有效權限集合判斷，MUST NOT 直接放行。

#### Scenario: scope 不足時被拒
- **WHEN** 成員的有效權限集合含 `analytics.view`，以不含 `cli:analytics:read` 的 CLI token 呼叫 `GET /api/v1/cli/analytics/overview`
- **THEN** 系統回 HTTP 403，不回傳報表

#### Scenario: 沒有報表權限的成員不能以 CLI 讀報表
- **WHEN** 成員的有效權限集合不含 `analytics.view`，以含 `cli:analytics:read` 的 CLI token 呼叫 `GET /api/v1/cli/analytics/overview`
- **THEN** 系統回 HTTP 403，不回傳報表

#### Scenario: 方案不含的功能不能透過 MCP 使用
- **WHEN** 租戶的方案不含 `marketing` 功能，成員以含 `mcp:line:broadcast` 的 CLI token 呼叫 MCP 工具 `crm_line_broadcast_initiate`
- **THEN** 系統拒絕這次呼叫，不建立群發

#### Scenario: 權限檢查的 guard 不直接放行 CLI token
- **WHEN** 一條路由接受 CLI token，並以 `requirePermission('analytics.view')` 檢查；成員的有效權限集合不含 `analytics.view`，以 CLI token 呼叫該路由
- **THEN** 系統回 HTTP 403

## REMOVED Requirements

### Requirement: Guard Factory
**Reason**: 這條需求描述角色白名單 guard `requireRole()`。路由改以權限碼授權後，沒有路由使用 `requireRole()`，它只是過渡用的 shim。
**Migration**: 路由改用 `requirePermission()`。授權規則見本規格的「路由以權限碼授權」，guard 的行為見 `permission-check` 的「權限檢查 guard」。

### Requirement: Convenience Guards
**Reason**: `requireAdmin()` 與 `requireSupervisor()` 寫死角色白名單，已由權限碼取代。
**Migration**: 改用 `requirePermission()`，見本規格的「路由以權限碼授權」。

### Requirement: Guard Ordering
**Reason**: guard 的順序移到 `permission-check` 的「權限檢查 guard」，並改寫成可以測試的結果：未登入的請求回 401，不回 403。
**Migration**: 見 `permission-check` 的「權限檢查 guard」。

### Requirement: 403 Response Shape
**Reason**: 這條需求規定的 `{ code: 'FORBIDDEN', message: 'Insufficient role' }` 與現行回應不同。現行回應採用全站的錯誤格式，並在 `details` 記錄缺少的權限碼。
**Migration**: 見 `permission-check` 的「權限檢查 guard」。用戶端以 `error.code` 的 `FORBIDDEN` 判斷，HTTP 狀態仍是 403。

### Requirement: Agent Management Access
**Reason**: 這條需求以角色列舉規定成員管理的存取，例如「SUPERVISOR 不能建立 ADMIN」。現行系統以權限碼授權，並以越權防護取代固定的角色規則。
**Migration**: 路由的授權見本規格的「路由以權限碼授權」。指派角色的限制見 `role-management` 的「指派角色給成員的越權防護」。

### Requirement: Channel Management Access
**Reason**: 這條需求以角色列舉規定渠道管理的存取。現行系統以權限碼授權。逐條列出各模組的權限碼等於複製一份路由設定，路由改了規格就會過時，因此規格不再逐條列出。
**Migration**: 見本規格的「路由以權限碼授權」。

### Requirement: Automation Rule Access
**Reason**: 同「Channel Management Access」：改以權限碼授權，規格不逐條列出各模組的權限碼。
**Migration**: 見本規格的「路由以權限碼授權」。

### Requirement: Settings Access
**Reason**: 同「Channel Management Access」：改以權限碼授權，規格不逐條列出各模組的權限碼。
**Migration**: 見本規格的「路由以權限碼授權」。

### Requirement: Analytics Access
**Reason**: 同「Channel Management Access」：改以權限碼授權，規格不逐條列出各模組的權限碼。
**Migration**: 見本規格的「路由以權限碼授權」。

### Requirement: Marketing Access
**Reason**: 同「Channel Management Access」：改以權限碼授權，規格不逐條列出各模組的權限碼。
**Migration**: 見本規格的「路由以權限碼授權」。
