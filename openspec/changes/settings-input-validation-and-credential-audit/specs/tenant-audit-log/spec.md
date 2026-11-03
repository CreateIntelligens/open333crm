## MODIFIED Requirements

### Requirement: 記錄租戶內的敏感操作

下列操作成功後，系統 SHALL 寫一筆 `TenantAuditLog`，內容包含 `tenantId`、`actorId`（操作的成員）、`action`、`targetType`、`targetId`、`payload`（變更摘要）與 `createdAt`。租戶稽核與平台的 `PlatformAuditLog` 分開存放。

- 成員：建立、停用、重新啟用、永久刪除、重設密碼、指派角色、設定可見渠道。
- 角色：建立、改名、刪除、設定角色的權限。
- 渠道：建立、刪除、授權團隊、撤銷團隊授權。
- 設定：營業時間、追蹤設定、跨渠道綁定、Embedding、Chat、自備 Gemini 金鑰與 WebTalk 協作的修改。
- 聯絡人：合併、撤銷合併。
- 工單：刪除。
- 資料權利：發起資料匯出、發起與完成資料刪除。
- 長效憑證：在設定頁建立與撤銷 Partner API 金鑰與 CLI token（`action` 是 `settings.update`），以及 CLI 登入建立 token、登出撤銷 token（`action` 是 `cli_session.login`、`cli_session.logout`）。這些紀錄 SHALL NOT 包含金鑰或 token 的明文。撤銷的對象不存在時，系統不寫稽核。

其他敏感操作（例如登入、修改渠道憑證）目前不寫稽核，記在 `docs/ref/system/AUDIT.md` 的 AUD-01。

#### Scenario: 設定角色權限時寫稽核
- **WHEN** 有 `role.manage` 的成員以 `PUT /api/v1/roles/:id/permissions` 設定角色的權限
- **THEN** 系統寫一筆稽核，`action` 是 `role.permission.update`，`targetType` 是 `role`，`targetId` 是角色 ID，`actorId` 是操作的成員，`payload.permissions` 是設定後的權限碼

#### Scenario: 建立角色時寫稽核
- **WHEN** 有 `role.manage` 的成員以 `POST /api/v1/roles` 建立角色
- **THEN** 系統寫一筆稽核，`action` 是 `role.create`，`targetType` 是 `role`，`targetId` 是新角色的 ID，`actorId` 是操作的成員，`payload.name` 是角色名稱

#### Scenario: 角色改名時寫稽核
- **WHEN** 有 `role.manage` 的成員以 `PATCH /api/v1/roles/:id` 修改角色名稱
- **THEN** 系統寫一筆稽核，`action` 是 `role.rename`，`targetType` 是 `role`，`targetId` 是角色 ID，`actorId` 是操作的成員，`payload.name` 是新的名稱

#### Scenario: 刪除角色時寫稽核
- **WHEN** 有 `role.manage` 的成員以 `DELETE /api/v1/roles/:id` 刪除自訂角色
- **THEN** 系統寫一筆稽核，`action` 是 `role.delete`，`targetType` 是 `role`，`targetId` 是被刪角色的 ID，`actorId` 是操作的成員，`payload.name` 是被刪角色的名稱；回應內容仍是 `{ deleted: true }`

#### Scenario: 建立 API 金鑰時寫稽核
- **WHEN** 有 `settings.manage` 的成員以 `POST /api/v1/settings/api-keys` 建立金鑰
- **THEN** 系統寫一筆稽核，`action` 是 `settings.update`，`targetType` 是 `settings`，`actorId` 是操作的成員，`payload` 是 `{ section: "api-keys", operation: "create", apiKeyId, name, expiresAt }`，不含金鑰的明文

#### Scenario: 撤銷 API 金鑰時寫稽核
- **WHEN** 有 `settings.manage` 的成員以 `DELETE /api/v1/settings/api-keys/:id` 撤銷金鑰
- **THEN** 系統寫一筆稽核，`action` 是 `settings.update`，`payload` 是 `{ section: "api-keys", operation: "revoke", apiKeyId }`

#### Scenario: 在設定頁建立 CLI token 時寫稽核
- **WHEN** 有 `settings.manage` 的成員以 `POST /api/v1/settings/cli-sessions` 建立 token
- **THEN** 系統寫一筆稽核，`action` 是 `settings.update`，`actorId` 是操作的成員，`payload` 是 `{ section: "cli-sessions", operation: "create", sessionId, name, scopes, expiresAt }`，不含 token 的明文

#### Scenario: 在設定頁撤銷 CLI token 時寫稽核
- **WHEN** 有 `settings.manage` 的成員以 `DELETE /api/v1/settings/cli-sessions/:id` 撤銷租戶內的 token
- **THEN** 系統寫一筆稽核，`action` 是 `settings.update`，`payload` 是 `{ section: "cli-sessions", operation: "revoke", sessionId }`

#### Scenario: CLI 登入與登出時寫稽核
- **WHEN** 成員以 `POST /api/v1/auth/cli/login` 登入，再以 `POST /api/v1/auth/cli/logout` 登出
- **THEN** 系統寫兩筆稽核，`actorId` 都是這位成員，`targetType` 都是 `cli_session`，`targetId` 都是這把 token 的 ID：登入的 `action` 是 `cli_session.login`，`payload` 是 `{ name, scopes, expiresAt }`，不含 token 的明文；登出的 `action` 是 `cli_session.logout`

#### Scenario: 撤銷不存在的憑證時不寫稽核
- **WHEN** 成員撤銷不存在的 API 金鑰或 CLI token，或另一個租戶的 API 金鑰或 CLI token
- **THEN** 系統不寫稽核
