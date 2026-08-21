# platform-auth

## ADDED Requirements

### Requirement: 平台 superuser 獨立認證路徑
系統 SHALL 提供 `PlatformUser` 全域表（不帶 tenantId）與平台登入端點 `POST /api/v1/platform/auth/login`，簽發以獨立 `PLATFORM_JWT_SECRET` 簽名的平台 JWT（payload 含 `platformUserId`、`role: 'PLATFORM_SUPERUSER'`）。租戶 JWT 與平台 JWT MUST 使用不同 secret，互相驗證 MUST 失敗。

#### Scenario: 平台帳號登入成功
- **WHEN** 有效的 PlatformUser email/密碼呼叫平台登入
- **THEN** 回傳平台 JWT，payload 的 role MUST 為 `PLATFORM_SUPERUSER`

#### Scenario: 租戶 JWT 打平台 API
- **WHEN** 帶租戶簽發的 JWT 呼叫 `/api/v1/platform/*`
- **THEN** 驗證 MUST 失敗並回 401

### Requirement: requirePlatformSuperuser guard 保護全部平台路由
所有 `/api/v1/platform/*` 路由（登入除外）MUST 掛 `requirePlatformSuperuser()`，非平台 superuser 一律回 403/401。平台 superuser MUST NOT 因此獲得任何租戶 data-plane API 的存取權。

#### Scenario: 未帶 token 存取平台 API
- **WHEN** 無 Authorization 呼叫 `GET /api/v1/platform/plans`
- **THEN** 回 401

#### Scenario: 平台 JWT 打租戶 API
- **WHEN** 帶平台 JWT 呼叫租戶 API（如 `GET /api/v1/agents`）
- **THEN** 認證 MUST 失敗（平台 JWT 過不了租戶認證路徑）

### Requirement: 平台操作稽核
平台側的寫入操作（開通/停用租戶、改 plan、改 PlatformSetting）MUST 寫入 `PlatformAuditLog`（platformUserId、action、targetType/targetId、payload 摘要、createdAt）。

#### Scenario: 改 plan 留稽核
- **WHEN** superuser 更新 trial plan 的 limits
- **THEN** MUST 新增一筆 PlatformAuditLog，action 含 plan 更新與目標 plan id
