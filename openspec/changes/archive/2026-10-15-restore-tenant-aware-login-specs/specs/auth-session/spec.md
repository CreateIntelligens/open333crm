## ADDED Requirements

### Requirement: 登入依 email 解析所屬租戶
成員的 email 在所有租戶之間 SHALL 唯一。`POST /auth/login` SHALL 以 email 找出成員，簽發的 token SHALL 帶該成員所屬的租戶，不使用寫死的租戶 ID。

建立成員時，email 已被任一租戶的成員使用，系統 SHALL 回 HTTP 409 `CONFLICT`，不建立成員。

#### Scenario: 登入的 token 帶成員所屬的租戶
- **WHEN** 屬於租戶 B 的成員以正確的 email 與密碼登入
- **THEN** 系統回 HTTP 200，access token 的 `tenantId` 是 B

#### Scenario: 其他租戶已使用的 email 不能建立成員
- **WHEN** 租戶 A 的管理員建立成員，email 已被租戶 B 的成員使用
- **THEN** 系統回 HTTP 409 `CONFLICT`，租戶 A 的成員數不變

### Requirement: 停用租戶的成員不能登入或換發 token
租戶停用（`Tenant.isActive` 是 `false`）之後，該租戶的成員 SHALL 不能以密碼登入，也 SHALL 不能以 refresh token 換發 access token。

登入時系統 SHALL 先驗證密碼。密碼錯誤 SHALL 回與一般錯誤相同的 401 `INVALID_CREDENTIALS`，不透露租戶已停用；密碼正確才回 403 `TENANT_DISABLED`。

停用之前發出的 access token，在有效期（`ACCESS_TOKEN_EXPIRES_IN`）內仍可呼叫 REST API。有效期過後無法換發，所以成員最遲在一個有效期內失去 REST API 的存取。

#### Scenario: 停用租戶的成員以正確密碼登入
- **WHEN** 租戶已停用，該租戶的成員以正確的 email 與密碼登入
- **THEN** 系統回 HTTP 403 `TENANT_DISABLED`，不簽發 access token，也不設定 refresh token

#### Scenario: 停用租戶的成員密碼錯誤
- **WHEN** 租戶已停用，該租戶的成員以錯誤的密碼登入
- **THEN** 系統回 HTTP 401 `INVALID_CREDENTIALS`

#### Scenario: 停用租戶的成員換發 token
- **WHEN** 租戶已停用，該租戶的成員以停用前取得的 refresh token 呼叫 `POST /auth/refresh`
- **THEN** 系統回 HTTP 401，不簽發 access token

### Requirement: 停用租戶的長效憑證與既有連線失效
租戶停用之後，系統 SHALL 拒絕該租戶的 CLI token 與 Partner API 金鑰，即使它們還沒過期。系統也 SHALL 中斷該租戶成員已建立的 Socket.IO 連線，之後推送到該租戶的事件 SHALL 不再送達這些連線。

#### Scenario: 停用租戶的 CLI token 被拒
- **WHEN** 租戶已停用，該租戶的成員以停用前取得、尚未過期的 CLI token 呼叫 API
- **THEN** 系統回 HTTP 401 `UNAUTHORIZED`

#### Scenario: 停用租戶的 Partner API 金鑰被拒
- **WHEN** 租戶已停用，以該租戶啟用中、尚未過期的 Partner API 金鑰呼叫 API
- **THEN** 系統回 HTTP 401 `UNAUTHORIZED`

#### Scenario: 停用租戶的 socket 連線被中斷
- **WHEN** 租戶停用時，該租戶的成員有已連線的 Socket.IO
- **THEN** 系統中斷這些連線，成員重新連線時被拒
