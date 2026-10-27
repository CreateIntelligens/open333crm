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

其他敏感操作（例如登入、API 金鑰與 CLI token、修改渠道憑證）目前不寫稽核，記在 `docs/ref/system/AUDIT.md` 的 AUD-01。

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

### Requirement: 稽核寫入失敗不影響主操作

在交易之外寫稽核時，`writeTenantAudit()` 寫入失敗 SHALL 只記錄錯誤 log，SHALL NOT 拋出錯誤，所以呼叫它的主操作照常回應。這個函式只給還沒改成在交易內寫稽核的呼叫端使用；交易內的稽核見「交易內的稽核與主操作一起 commit」。

#### Scenario: 稽核寫入失敗不拋錯
- **WHEN** `writeTenantAudit()` 寫入資料庫時發生錯誤
- **THEN** 函式正常結束，不拋出錯誤

## ADDED Requirements

### Requirement: 交易內的稽核與主操作一起 commit

在綁定租戶的交易內寫稽核時，稽核 SHALL 與主操作的寫入一起 commit 或一起 rollback。稽核的 `tenantId` SHALL 是交易綁定的租戶，呼叫端 SHALL NOT 指定。稽核寫入失敗時，系統 SHALL 拋出錯誤，交易 rollback，主操作的寫入 SHALL NOT 留在資料庫。

#### Scenario: 稽核與主操作一起寫入
- **WHEN** 綁定租戶 A 的交易內建立一個角色，接著寫一筆稽核，之後交易 commit
- **THEN** 資料庫中有該角色，也有該筆稽核，稽核的 `tenantId` 是 A

#### Scenario: 稽核寫入失敗時主操作 rollback
- **WHEN** 綁定租戶的交易內建立一個角色，接著寫一筆稽核，稽核的 `actorId` 是不存在的成員，所以寫入違反外鍵
- **THEN** 呼叫端收到錯誤，資料庫中 MUST NOT 有該角色，也 MUST NOT 有該筆稽核
