# Spec Delta

## MODIFIED Requirements

### Requirement: 平台路由一律驗證平台帳號
除了 3 個公開端點，所有 `/api/v1/platform/*` 路由 MUST 先通過平台帳號的驗證（`auth.plugin.ts` 的 `authenticatePlatformSuperuser`）。公開端點是 `POST /auth/login`、`POST /auth/forgot-password` 與 `POST /auth/reset-password`。

平台後台啟用時，驗證依下列順序檢查，第一個符合的情況決定回應：

1. 沒有 token，或 token 不是有效的平台 JWT（包括租戶 JWT）：回 401 `UNAUTHORIZED`。
2. token 的 `role` 不是 `PLATFORM_SUPERUSER`：回 403 `FORBIDDEN`。
3. token 的平台帳號不存在：回 401 `UNAUTHORIZED`。
4. 平台帳號已停用：回 401 `PLATFORM_USER_DISABLED`。

佇列監控的路徑 `/api/v1/platform/queues/*` 是例外：瀏覽器開啟監控畫面時不會帶 `Authorization` 標頭，所以這個路徑以監控 cookie 取代 token，cookie 由 `queue-monitoring` 的換發端點設定。驗證的順序與回應同上，另外 MUST 拒絕須改密碼的平台帳號。換發端點本身照上列順序驗證 `Authorization` 標頭的平台 JWT。

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

#### Scenario: 佇列監控路徑沒有 cookie
- **WHEN** 從允許的網段開啟 `/api/v1/platform/queues`，不帶監控 cookie
- **THEN** 回 401 `UNAUTHORIZED`

#### Scenario: 監控 cookie 的平台帳號已停用
- **GIVEN** 平台帳號持有未過期的監控 cookie
- **WHEN** 這個帳號被停用之後，帶這個 cookie 從允許的網段開啟 `/api/v1/platform/queues`
- **THEN** 回 401 `PLATFORM_USER_DISABLED`

#### Scenario: 平台 JWT 不能取代監控 cookie
- **WHEN** 從允許的網段以 `Authorization: Bearer <平台 JWT>` 開啟 `/api/v1/platform/queues`，不帶監控 cookie
- **THEN** 回 401 `UNAUTHORIZED`
