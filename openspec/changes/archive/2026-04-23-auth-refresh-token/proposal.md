## Why

目前前端 Access Token 存於 localStorage，JWT 到期（預設 7 天）後使用者會被強制登出，且沒有靜默續期機制。localStorage 儲存 token 也存在 XSS 風險。需要實作標準的雙 token 架構：Access Token 存於記憶體（短效），Refresh Token 存於 HttpOnly Cookie（長效），並支援「記住我」功能。

## What Changes

- **API**：`POST /auth/login` 在回應中設定 `refreshToken` HttpOnly Cookie；支援 `rememberMe` 參數控制 Cookie Max-Age（由 `REMEMBER_ME_DAYS` env 決定天數，預設 30 天）
- **API**：`POST /auth/refresh` 改為從 Cookie 讀取 refresh token，不再需要 Bearer token（移除 `authenticate` preHandler）；驗證後回傳新 Access Token
- **API**：`POST /auth/logout` 清除 refreshToken Cookie
- **API**：新增四個 env 變數：`ACCESS_TOKEN_EXPIRES_IN`（預設 `15m`）、`REFRESH_TOKEN_EXPIRES_IN`（預設 `30d`）、`REFRESH_COOKIE_MAX_AGE`（秒，預設 2592000）、`REMEMBER_ME_DAYS`（整數，預設 30）
- **前端 AuthProvider**：Access Token 改存於 React state（記憶體），不再存 localStorage
- **前端 api.ts**：`401` 攔截器改為呼叫 `/auth/refresh` 靜默續期，成功後重試原請求；refresh 失敗才導向 /login
- **前端登入頁**：新增「記住我」checkbox，傳遞 `rememberMe` 給 API

## Capabilities

### New Capabilities

- `auth-session`: 雙 token 架構、HttpOnly Cookie refresh token、Access Token in memory、靜默續期、記住我

### Modified Capabilities

- `core-inbox`: 前端 auth 行為改變可能影響 inbox 初始化時序（token 初始化從同步 localStorage 讀取變為非同步）

## Impact

- `apps/api/src/modules/auth/auth.routes.ts`：login、refresh、logout 端點
- `apps/api/src/plugins/auth.plugin.ts`：可能需要支援 cookie-based 驗證路徑
- `apps/web/src/providers/AuthProvider.tsx`：state 管理重構
- `apps/web/src/lib/api.ts`：response interceptor 加入 refresh 邏輯
- `apps/web/src/app/login/page.tsx`（或對應登入元件）：加入 rememberMe checkbox
- 需要在 API 加入 `@fastify/cookie` plugin（若尚未安裝）
