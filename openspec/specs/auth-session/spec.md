## Purpose
定義租戶後台（客服）的登入工作階段：密碼登入、refresh token 換發與輪替、登出、前端 token 保存與自動換發，以及登入的速率限制與 token 用途區分。
## Requirements
### Requirement: Login issues Refresh Token via HttpOnly Cookie
`POST /auth/login` 接受可選的 `rememberMe: boolean` 參數。登入成功後，除了回傳 Access Token 於 response body，SHALL 在回應中設定 `refreshToken` HttpOnly Cookie（SameSite=Strict）。`rememberMe` 的值會被編入 Refresh Token JWT payload，以便後續 rotation 時保持一致。`rememberMe=true` 時 Cookie 帶 `Max-Age`（由 `REFRESH_TOKEN_EXPIRES_IN` 推導，單位秒）；`rememberMe` 未提供或為 `false` 時為 Session Cookie（無 Max-Age，關閉瀏覽器即失效）。

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
`POST /auth/refresh` SHALL 從 HttpOnly Cookie 中讀取 `refreshToken`，驗證有效後回傳新的 Access Token，並同時簽發新的 Refresh Token（Refresh Token Rotation）。新 Refresh Token 繼承舊 token 中的 `rememberMe` 欄位，以保持 Cookie persistent/session 屬性不變。此端點不需要 Bearer Authorization header。

#### Scenario: Valid refresh token in Cookie
- **WHEN** 請求帶有有效的 `refreshToken` Cookie
- **THEN** 回傳新的 `accessToken`（15 分鐘效期），同時以新的 `refreshToken` 覆蓋舊 Cookie（保持原 rememberMe 屬性），HTTP 200

#### Scenario: Missing or expired refresh token
- **WHEN** 請求沒有 `refreshToken` Cookie，或 Cookie 中的 JWT 已過期
- **THEN** 回傳 HTTP 401，body 包含 `UNAUTHORIZED` error code

---

### Requirement: Logout clears Refresh Token Cookie
`POST /auth/logout` SHALL 清除 `refreshToken` Cookie（設定 Max-Age=0），讓用戶無法再靜默續期。

#### Scenario: Logout clears cookie
- **WHEN** 已登入用戶呼叫 `POST /auth/logout`
- **THEN** 回應 `Set-Cookie: refreshToken=; Max-Age=0; HttpOnly; SameSite=Strict`，HTTP 200

---

### Requirement: Access Token stored in memory only
前端 `AuthProvider` SHALL 將 Access Token 存於 React state（記憶體），不存於 `localStorage` 或 `sessionStorage`。頁面重整後透過 `/auth/refresh` 自動恢復 session（利用 Cookie）。

#### Scenario: Page refresh restores session
- **WHEN** 用戶重整頁面，`AuthProvider` 掛載時 localStorage 無 token
- **THEN** 自動呼叫 `POST /auth/refresh`，成功後設定 in-memory accessToken 並載入 agent 資料

#### Scenario: Page refresh with expired cookie
- **WHEN** 用戶重整頁面，且 refreshToken Cookie 已過期或不存在
- **THEN** `AuthProvider` 導向 `/login` 頁面

---

### Requirement: Silent token refresh on 401
`api.ts` 的 response interceptor 在收到 HTTP 401 時 SHALL 自動呼叫 `/auth/refresh` 取得新 Access Token，成功後重試原始請求。若 refresh 本身失敗則導向 `/login`。並發的 401 請求只觸發一次 refresh（queue 機制）。

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
登入頁面 SHALL 提供「記住我」checkbox，預設未勾選。勾選後 `rememberMe: true` 隨登入請求傳送。

#### Scenario: User checks Remember Me and logs in
- **WHEN** 用戶勾選「記住我」並成功登入
- **THEN** API 收到 `rememberMe: true`，設定帶 Max-Age 的 Cookie

#### Scenario: User does not check Remember Me
- **WHEN** 用戶未勾選「記住我」並成功登入
- **THEN** API 收到 `rememberMe: false`（或未傳），設定 Session Cookie

### Requirement: 登入依來源 IP 限流
`POST /auth/login` SHALL 對同一來源 IP 每分鐘最多處理 10 次請求，超過時 SHALL 回傳 HTTP 429，錯誤碼 `RATE_LIMITED`，訊息為可讀的中文說明。

#### Scenario: 同一 IP 一分鐘內第 11 次登入
- **WHEN** 同一 IP 在一分鐘內第 11 次呼叫 `POST /auth/login`
- **THEN** 回傳 HTTP 429，`error.code` 為 `RATE_LIMITED`，`error.message` 為「操作太頻繁，請稍候再試」

### Requirement: request.ip 只採信受信任代理附加的位址
API SHALL 只信任私有網段與本機的代理：`request.ip` SHALL 為從連線來源往左略過受信任代理後的第一個位址；使用者自行帶入的 `X-Forwarded-For` 值 SHALL NOT 被採用。

#### Scenario: 經 nginx 與 Caddy 轉送
- **WHEN** 連線來自私有網段，`X-Forwarded-For` 為「1.1.1.1, 203.0.113.9, 172.18.0.1」（使用者偽造、nginx 附加真實 IP、Caddy 附加 docker 閘道）
- **THEN** `request.ip` 為 `203.0.113.9`

#### Scenario: 公網直接連到 API
- **WHEN** 連線來自公網位址 `198.51.100.7`，並帶 `X-Forwarded-For: 1.1.1.1`
- **THEN** `request.ip` 為 `198.51.100.7`

### Requirement: 登入失敗達上限時鎖定帳號
系統 SHALL 依 email（不分大小寫）計算登入失敗次數。第一次失敗起 15 分鐘內累計失敗 5 次後，該 email 的登入 SHALL 回傳 HTTP 429 `ACCOUNT_LOCKED`，不論密碼是否正確，直到該 15 分鐘區間結束。登入成功 SHALL 清除失敗次數。不存在的 email SHALL 以相同方式計算與鎖定。CLI 的密碼登入（`POST /auth/cli/login`）SHALL 與網頁登入共用同一個失敗計數。

#### Scenario: 連續失敗 5 次後鎖定
- **WHEN** 同一 email 在 15 分鐘內密碼錯誤 5 次，第 6 次送出正確密碼
- **THEN** 第 6 次回傳 HTTP 429，`error.code` 為 `ACCOUNT_LOCKED`，不簽發 token

#### Scenario: 鎖定期滿後可登入
- **WHEN** 鎖定的 email 在第一次失敗 15 分鐘後送出正確密碼
- **THEN** 登入成功

#### Scenario: 成功登入清除失敗次數
- **WHEN** 同一 email 失敗 4 次後登入成功，之後再失敗 4 次
- **THEN** 第 5 次嘗試（正確密碼）登入成功，不被鎖定

#### Scenario: 大小寫不同視為同一帳號
- **WHEN** 以 `Admin@x.dev` 失敗 3 次、`admin@x.dev` 失敗 2 次
- **THEN** 下一次登入回傳 `ACCOUNT_LOCKED`

#### Scenario: 同時送出大量猜測
- **WHEN** 同一 email 同時送出 12 個密碼錯誤的登入請求
- **THEN** 最多 5 個回傳 401 `INVALID_CREDENTIALS`，其餘回傳 429 `ACCOUNT_LOCKED`（不驗證密碼）

#### Scenario: 計數儲存故障
- **WHEN** 失敗計數的儲存（Redis）無法使用
- **THEN** 登入照常依密碼判斷，並留下錯誤 log；不得因此讓所有人無法登入

#### Scenario: 不存在的 email 回應時間一致
- **WHEN** 以不存在的 email 登入
- **THEN** 系統 SHALL 仍執行一次密碼雜湊比對，回應時間不透露帳號是否存在

#### Scenario: 不存在的 email 也會鎖定
- **WHEN** 不存在的 email 失敗 5 次後再嘗試
- **THEN** 回傳 HTTP 429 `ACCOUNT_LOCKED`，與存在的帳號相同

### Requirement: 停用帳號只在密碼正確時才告知
帳號已停用時，系統 SHALL 先驗證密碼；密碼錯誤 SHALL 回傳與一般錯誤相同的 401 `INVALID_CREDENTIALS`，密碼正確才回傳 403 `ACCOUNT_DISABLED`。

#### Scenario: 停用帳號、密碼錯誤
- **WHEN** 以停用帳號的 email 與錯誤密碼登入
- **THEN** 回傳 HTTP 401 `INVALID_CREDENTIALS`

#### Scenario: 停用帳號、密碼正確
- **WHEN** 以停用帳號的 email 與正確密碼登入
- **THEN** 回傳 HTTP 403 `ACCOUNT_DISABLED`

### Requirement: 客服 API 與 socket 只接受 access token
`authenticate`、`authenticateJwtOrCli` 與 `authenticateJwtOrPartnerKey` 的 JWT 分支，以及 socket 連線驗證，SHALL 只接受 payload 為 `typ: 'access'` 且帶 `agentId` 與 `tenantId` 的 token；其他以 `JWT_SECRET` 簽發的 token SHALL 回傳 HTTP 401（socket 拒絕連線）。

#### Scenario: access token
- **WHEN** 以登入取得的 access token 呼叫需要登入的 API
- **THEN** 請求通過驗證

#### Scenario: refresh token 當 access token
- **WHEN** 以 refresh token 放在 `Authorization: Bearer` 呼叫需要登入的 API
- **THEN** 回傳 HTTP 401 `UNAUTHORIZED`

#### Scenario: 粉絲 token 與 MCP 確認 token
- **WHEN** 以粉絲 token（`sub: 'fan'`）或 MCP 確認 token 呼叫需要登入的 API
- **THEN** 回傳 HTTP 401 `UNAUTHORIZED`

#### Scenario: 舊格式 access token
- **WHEN** 以本次上線前簽發、沒有 `typ` 的 access token 呼叫 API
- **THEN** 回傳 HTTP 401，前端以 refresh token 換發新 token 後重試

#### Scenario: socket 以 refresh token 連線
- **WHEN** socket 連線時帶 refresh token
- **THEN** 伺服器拒絕連線

### Requirement: 換發只接受 refresh token
`POST /auth/refresh` SHALL 只接受 `typ: 'refresh'` 的 token；過渡期 SHALL 另外接受沒有 `typ`、帶 `rememberMe` 欄位的舊格式 refresh token。

#### Scenario: cookie 放的是 access token
- **WHEN** `refreshToken` cookie 的值是 access token
- **THEN** 回傳 HTTP 401，不簽發新 token

#### Scenario: 舊格式 refresh token
- **WHEN** `refreshToken` cookie 是本次上線前簽發的 refresh token
- **THEN** 換發成功，新的 access 與 refresh token 帶 `typ`

### Requirement: socket 重連使用最新的 access token
前端 socket 每次連線 SHALL 讀取當下的 access token；伺服器以驗證失敗拒絕時 SHALL 先觸發 token 換發再重新連線，連續失敗最多重試 3 次。

#### Scenario: access token 已換發
- **WHEN** socket 斷線後重連，而 access token 已在斷線期間換發
- **THEN** 重連使用新的 access token

#### Scenario: 驗證失敗
- **WHEN** 伺服器以驗證失敗拒絕 socket 連線
- **THEN** 前端呼叫一次需要登入的 API 觸發換發，之後重新連線

