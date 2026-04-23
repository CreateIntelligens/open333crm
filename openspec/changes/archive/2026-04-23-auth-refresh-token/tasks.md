## 1. API — 依賴安裝與 Plugin 設定

- [x] 1.1 在 `apps/api` 安裝 `@fastify/cookie`（`pnpm add @fastify/cookie --filter api`）
- [x] 1.2 在 `apps/api/src/plugins/` 新增 `cookie.plugin.ts`，註冊 `@fastify/cookie`
- [x] 1.3 在 `apps/api/src/index.ts` 引入並 register cookie plugin（在 auth plugin 之前）
- [x] 1.4 在 `apps/api/src/config/env.ts` 新增以下 env 變數：`ACCESS_TOKEN_EXPIRES_IN`（預設 `15m`）、`REFRESH_TOKEN_EXPIRES_IN`（預設 `30d`）、`REFRESH_COOKIE_MAX_AGE`（秒，預設 `2592000` = 30天）、`REMEMBER_ME_DAYS`（整數天數，預設 `30`，控制 rememberMe Cookie Max-Age 計算）

## 2. API — Auth 端點修改

- [x] 2.1 修改 `POST /auth/login`：接受 `rememberMe?: boolean`，將 `JWT_EXPIRES_IN` 改為 `ACCESS_TOKEN_EXPIRES_IN`，簽發 Refresh Token（`REFRESH_TOKEN_EXPIRES_IN`），以 `Set-Cookie: refreshToken=...; HttpOnly; SameSite=Strict` 回應；`rememberMe=true` 加上 `Max-Age=2592000`
- [x] 2.2 修改 `POST /auth/refresh`：移除 `authenticate` preHandler，改從 `request.cookies.refreshToken` 讀取並以 `fastify.jwt.verify()` 驗證；成功後簽發新 Access Token 回傳
- [x] 2.3 新增 `POST /auth/logout`：清除 `refreshToken` Cookie（`Max-Age=0`），回傳 HTTP 200
- [x] 2.4 修改 `auth.plugin.ts` 的 `sign` 選項，使用 `ACCESS_TOKEN_EXPIRES_IN`

## 3. 前端 — AuthProvider 重構

- [x] 3.1 修改 `apps/web/src/providers/AuthProvider.tsx`：移除 `localStorage.setItem('token', ...)`，改用 `useState<string | null>` 管理 access token
- [x] 3.2 在 `AuthProvider.tsx` 增加 module-level ref（`tokenRef`）與 export setter，供 `api.ts` interceptor 讀寫 token
- [x] 3.3 `AuthProvider` mount 時（`useEffect`）呼叫 `POST /auth/refresh`（不帶 Bearer token），成功後設定 in-memory token 並取得 agent 資料；失敗則 setIsLoading(false)
- [x] 3.4 `login()` 回調中不再存 localStorage，改設定 in-memory token
- [x] 3.5 `logout()` 呼叫 `POST /auth/logout`（清除 Cookie），清除 in-memory token

## 4. 前端 — api.ts 攔截器升級

- [x] 4.1 修改 `apps/web/src/lib/api.ts`：`withCredentials: true`（讓 Cookie 隨請求傳送）
- [x] 4.2 `request` interceptor：從 module-level `tokenRef` 讀取 access token（而非 localStorage）
- [x] 4.3 `response` interceptor：收到 401 時，若 `isRefreshing` 為 false，呼叫 `POST /auth/refresh`，成功後更新 tokenRef 並依序重試排隊的請求；若 `isRefreshing` 為 true，將請求加入 pending queue
- [x] 4.4 refresh 失敗（401）時清除 in-memory token 並 `window.location.href = '/login'`

## 5. 前端 — 登入頁

- [x] 5.1 找到登入頁元件（`apps/web/src/app/login/page.tsx` 或對應檔案）
- [x] 5.2 新增「記住我」checkbox（預設未勾選）
- [x] 5.3 呼叫 `login(email, password, rememberMe)` 時傳入 `rememberMe` 值，`AuthProvider.login()` 接受並轉傳給 API
