## RENAMED Requirements

- FROM: `### Requirement: requirePlatformSuperuser guard 保護全部平台路由`
- TO: `### Requirement: 平台路由一律驗證平台帳號`

## MODIFIED Requirements

### Requirement: 平台路由一律驗證平台帳號
除了 3 個公開端點，所有 `/api/v1/platform/*` 路由 MUST 先通過平台帳號的驗證（`auth.plugin.ts` 的 `authenticatePlatformSuperuser`）。公開端點是 `POST /auth/login`、`POST /auth/forgot-password` 與 `POST /auth/reset-password`。

平台後台啟用時，驗證依下列順序檢查，第一個符合的情況決定回應：

1. 沒有 token，或 token 不是有效的平台 JWT（包括租戶 JWT）：回 401 `UNAUTHORIZED`。
2. token 的 `role` 不是 `PLATFORM_SUPERUSER`：回 403 `FORBIDDEN`。
3. token 的平台帳號不存在：回 401 `UNAUTHORIZED`。
4. 平台帳號已停用：回 401 `PLATFORM_USER_DISABLED`。

平台 JWT MUST NOT 通過租戶 API 的認證。須改密碼的限制見 `platform-user-management`。

#### Scenario: 未帶 token 存取平台 API
- **WHEN** 不帶 Authorization 呼叫任一條需要登入的平台路由，例如 `GET /api/v1/platform/plans`
- **THEN** 回 401 `UNAUTHORIZED`

#### Scenario: 只有 3 個公開端點不需要 token
- **WHEN** 不帶 Authorization 呼叫每一條平台路由
- **THEN** 只有登入、忘記密碼與重設密碼 3 個端點不回 401

#### Scenario: token 的角色不是平台管理員
- **WHEN** 以 `PLATFORM_JWT_SECRET` 簽發、`role` 是 `ADMIN` 的 token 呼叫需要登入的平台路由
- **THEN** 回 403 `FORBIDDEN`

#### Scenario: 平台帳號不存在
- **WHEN** token 的 `platformUserId` 不對應任何平台帳號，以這個 token 呼叫需要登入的平台路由
- **THEN** 回 401 `UNAUTHORIZED`

#### Scenario: 平台帳號已停用
- **GIVEN** 平台帳號持有未過期的 token
- **WHEN** 這個帳號被停用之後，以這個 token 呼叫需要登入的平台路由
- **THEN** 回 401 `PLATFORM_USER_DISABLED`

#### Scenario: 平台 JWT 打租戶 API
- **WHEN** 帶平台 JWT 呼叫租戶 API（如 `GET /api/v1/agents`）
- **THEN** 回 401

## ADDED Requirements

### Requirement: 沒有設定 PLATFORM_JWT_SECRET 時停用平台後台
沒有設定 `PLATFORM_JWT_SECRET` 時，平台登入與所有需要登入的平台路由 MUST 回 503 `PLATFORM_DISABLED`，不檢查 token。不需要平台後台的環境，可以不設定這個變數來關閉整個平台後台。

#### Scenario: 沒有設定 PLATFORM_JWT_SECRET
- **WHEN** 沒有設定 `PLATFORM_JWT_SECRET` 時，呼叫平台登入或需要登入的平台路由
- **THEN** 回 503 `PLATFORM_DISABLED`
