## ADDED Requirements

### Requirement: Unified API Access
所有現有的 `/api/v1` 業務端點必須無縫支援來自 PAT 的請求。

#### Scenario: Cross-Platform Parity
- **WHEN** 使用者透過 CLI 發送 `GET /api/v1/contacts` 並附帶有效 PAT
- **THEN** API 回傳的資料結構與網頁端獲取的完全一致，且受相同的 RBAC 規則約束。

### Requirement: Scoped Permissions (Future Proof)
Token 應該具備基本的權限範圍限制功能。

#### Scenario: Restricted Scope
- **WHEN** 一個僅具備 `contacts:read` 權限的 Token 試圖刪除聯繫人
- **THEN** 系統回傳 403 Forbidden，即便該 Agent 本身擁有刪除權限。
