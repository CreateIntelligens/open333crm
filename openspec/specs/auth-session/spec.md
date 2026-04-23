## ADDED Requirements

### Requirement: Login issues Refresh Token via HttpOnly Cookie
`POST /auth/login` 接受可選的 `rememberMe: boolean` 參數。登入成功後，除了回傳 Access Token 於 response body，必須在回應中設定 `refreshToken` HttpOnly Cookie（SameSite=Strict）。`rememberMe` 的值會被編入 Refresh Token JWT payload，以便後續 rotation 時保持一致。`rememberMe=true` 時 Cookie 帶 `Max-Age`（由 `REFRESH_TOKEN_EXPIRES_IN` 推導，單位秒）；`rememberMe` 未提供或為 `false` 時為 Session Cookie（無 Max-Age，關閉瀏覽器即失效）。

#### Scenario: Login with rememberMe true
- **WHEN** 用戶以正確憑證登入並傳入 `rememberMe: true`
- **THEN** response body 包含 `accessToken`（15 分鐘效期）及 `agent` 資訊，且 `Set-Cookie` header 包含 `refreshToken=...; HttpOnly; SameSite=Strict; Max-Age=<REFRESH_TOKEN_EXPIRES_IN 換算秒數>`

#### Scenario: Login without rememberMe
- **WHEN** 用戶以正確憑證登入，未傳入 `rememberMe` 或傳入 `false`
- **THEN** response body 包含 `accessToken`，且 `Set-Cookie` header 包含 `refreshToken=...; HttpOnly; SameSite=Strict`（無 Max-Age）

#### Scenario: Login with wrong credentials
- **WHEN** 用戶傳入錯誤密碼
- **THEN** 回傳 HTTP 401，不設定任何 Cookie

---

### Requirement: Refresh endpoint renews Access Token from Cookie (Refresh Token Rotation)
`POST /auth/refresh` 從 HttpOnly Cookie 中讀取 `refreshToken`，驗證有效後回傳新的 Access Token，並同時簽發新的 Refresh Token（Refresh Token Rotation）。新 Refresh Token 繼承舊 token 中的 `rememberMe` 欄位，以保持 Cookie persistent/session 屬性不變。此端點不需要 Bearer Authorization header。

#### Scenario: Valid refresh token in Cookie
- **WHEN** 請求帶有有效的 `refreshToken` Cookie
- **THEN** 回傳新的 `accessToken`（15 分鐘效期），同時以新的 `refreshToken` 覆蓋舊 Cookie（保持原 rememberMe 屬性），HTTP 200

#### Scenario: Missing or expired refresh token
- **WHEN** 請求沒有 `refreshToken` Cookie，或 Cookie 中的 JWT 已過期
- **THEN** 回傳 HTTP 401，body 包含 `UNAUTHORIZED` error code

---

### Requirement: Logout clears Refresh Token Cookie
`POST /auth/logout` 清除 `refreshToken` Cookie（設定 Max-Age=0），讓用戶無法再靜默續期。

#### Scenario: Logout clears cookie
- **WHEN** 已登入用戶呼叫 `POST /auth/logout`
- **THEN** 回應 `Set-Cookie: refreshToken=; Max-Age=0; HttpOnly; SameSite=Strict`，HTTP 200

---

### Requirement: Access Token stored in memory only
前端 `AuthProvider` 將 Access Token 存於 React state（記憶體），不存於 `localStorage` 或 `sessionStorage`。頁面重整後透過 `/auth/refresh` 自動恢復 session（利用 Cookie）。

#### Scenario: Page refresh restores session
- **WHEN** 用戶重整頁面，`AuthProvider` 掛載時 localStorage 無 token
- **THEN** 自動呼叫 `POST /auth/refresh`，成功後設定 in-memory accessToken 並載入 agent 資料

#### Scenario: Page refresh with expired cookie
- **WHEN** 用戶重整頁面，且 refreshToken Cookie 已過期或不存在
- **THEN** `AuthProvider` 導向 `/login` 頁面

---

### Requirement: Silent token refresh on 401
`api.ts` 的 response interceptor 在收到 HTTP 401 時，自動呼叫 `/auth/refresh` 取得新 Access Token，成功後重試原始請求。若 refresh 本身失敗則導向 `/login`。並發的 401 請求只觸發一次 refresh（queue 機制）。

#### Scenario: Single request gets 401 and retries
- **WHEN** 某 API 請求因 token 過期回傳 401
- **THEN** interceptor 自動 refresh，取得新 token 後重試原請求，使用者感知不到中斷

#### Scenario: Concurrent requests all get 401
- **WHEN** 多個並發請求同時收到 401
- **THEN** 只發起一次 refresh 請求，所有排隊的請求在 refresh 完成後依序重試

#### Scenario: Refresh fails after 401
- **WHEN** refresh 請求本身也失敗（refreshToken 過期或無效）
- **THEN** 清除 in-memory token，導向 `/login`

---

### Requirement: Remember Me checkbox on login page
登入頁面提供「記住我」checkbox，預設未勾選。勾選後 `rememberMe: true` 隨登入請求傳送。

#### Scenario: User checks Remember Me and logs in
- **WHEN** 用戶勾選「記住我」並成功登入
- **THEN** API 收到 `rememberMe: true`，設定帶 Max-Age 的 Cookie

#### Scenario: User does not check Remember Me
- **WHEN** 用戶未勾選「記住我」並成功登入
- **THEN** API 收到 `rememberMe: false`（或未傳），設定 Session Cookie
