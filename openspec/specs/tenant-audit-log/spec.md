# tenant-audit-log Specification

## Purpose
規定租戶內敏感操作的稽核：哪些操作要寫稽核、寫入失敗不影響主操作，以及有 `audit.view` 的成員怎麼查詢本租戶的稽核。平台人員的操作另由 `PlatformAuditLog` 記錄，不在這份規格。

## Requirements

### Requirement: 記錄租戶內的敏感操作

下列操作成功後，系統 SHALL 寫一筆 `TenantAuditLog`，內容包含 `tenantId`、`actorId`（操作的成員）、`action`、`targetType`、`targetId`、`payload`（變更摘要）與 `createdAt`。租戶稽核與平台的 `PlatformAuditLog` 分開存放。

- 成員：建立、停用、重新啟用、永久刪除、重設密碼、指派角色、設定可見渠道。
- 角色：設定角色的權限。
- 渠道：建立、刪除、授權團隊、撤銷團隊授權。
- 設定：營業時間、追蹤設定、跨渠道綁定、Embedding、Chat、自備 Gemini 金鑰與 WebTalk 協作的修改。
- 聯絡人：合併、撤銷合併。
- 工單：刪除。
- 資料權利：發起資料匯出、發起與完成資料刪除。

其他敏感操作（例如登入、API 金鑰與 CLI token、修改渠道憑證）目前不寫稽核，記在 `docs/ref/system/AUDIT.md` 的 AUD-01。

#### Scenario: 設定角色權限時寫稽核
- **WHEN** 有 `role.manage` 的成員以 `PUT /api/v1/roles/:id/permissions` 設定角色的權限
- **THEN** 系統寫一筆稽核，`action` 是 `role.permission.update`，`targetType` 是 `role`，`targetId` 是角色 ID，`actorId` 是操作的成員，`payload.permissions` 是設定後的權限碼

### Requirement: 稽核寫入失敗不影響主操作

`writeTenantAudit()` 寫入失敗時 SHALL 只記錄錯誤 log，SHALL NOT 拋出錯誤，所以呼叫它的主操作照常回應。

#### Scenario: 稽核寫入失敗不拋錯
- **WHEN** `writeTenantAudit()` 寫入資料庫時發生錯誤
- **THEN** 函式正常結束，不拋出錯誤

### Requirement: 查詢租戶稽核

`GET /api/v1/tenant/audit-logs` SHALL 回傳目前租戶的稽核，依 `createdAt` 由新到舊排序，每頁預設 20 筆、最多 100 筆。查詢 SHALL 支援依 `action`、`actorId` 與日期區間（`from`、`to`）篩選。呼叫的成員 SHALL 有 `audit.view`，沒有時系統回 HTTP 403。回傳的稽核 SHALL 只屬於目前的租戶。

#### Scenario: 依 action 篩選本租戶的稽核
- **WHEN** 有 `audit.view` 的成員以 `action=role.permission.update` 查詢
- **THEN** 系統回 HTTP 200，結果只含本租戶 `action` 是 `role.permission.update` 的稽核，不含其他租戶的稽核

#### Scenario: 沒有 audit.view 不能查詢
- **WHEN** 沒有 `audit.view` 的成員送出 `GET /api/v1/tenant/audit-logs`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `audit.view`，不回傳任何稽核

#### Scenario: 分頁與日期篩選
- **WHEN** 成員以 `from`、`to` 與 `pageSize` 查詢
- **THEN** 系統只回傳 `createdAt` 落在區間內的稽核，每頁筆數不超過 `pageSize`，`total` 是符合條件的總筆數
