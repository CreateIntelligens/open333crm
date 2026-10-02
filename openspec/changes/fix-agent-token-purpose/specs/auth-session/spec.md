## ADDED Requirements

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
