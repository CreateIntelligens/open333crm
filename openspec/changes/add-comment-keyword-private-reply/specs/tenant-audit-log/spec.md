## MODIFIED Requirements

### Requirement: 記錄租戶內的敏感操作

下列操作成功後，系統 SHALL 寫一筆 `TenantAuditLog`，內容包含 `tenantId`、`actorId`（操作的成員）、`action`、`targetType`、`targetId`、`payload`（變更摘要）與 `createdAt`。租戶稽核與平台的 `PlatformAuditLog` 分開存放。

- 成員：建立、停用、重新啟用、永久刪除、重設密碼、指派角色、設定可見渠道。
- 角色：建立、改名、刪除、設定角色的權限。
- 渠道：建立、刪除、授權團隊、撤銷團隊授權、開啟與關閉留言接收（`channel.comment_subscription.update`）。
- 設定：營業時間、追蹤設定、跨渠道綁定、Embedding、Chat、自備 Gemini 金鑰與 WebTalk 協作的修改。
- 聯絡人：合併、撤銷合併。
- 工單：刪除。
- 資料權利：發起資料匯出、發起與完成資料刪除。
- 留言自動私訊：規則建立、修改、刪除、啟用切換、排序（`comment_reply.rule.create`／`update`／`delete`／`toggle`／`reorder`），觸發紀錄重試（`comment_reply.log.retry`）。payload 不含留言內容與留言者名稱。

長效憑證的稽核見「建立與撤銷長效憑證時寫稽核」。其他敏感操作（例如登入、修改渠道憑證）目前不寫稽核，記在 `docs/ref/system/AUDIT.md` 的 AUD-01。

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

#### Scenario: 重試觸發紀錄時寫稽核
- **WHEN** 有 `comment_reply.manage` 的成員以 `POST /api/v1/comment-replies/logs/:id/retry` 重試一筆紀錄
- **THEN** 系統寫一筆稽核，`action` 是 `comment_reply.log.retry`，`targetType` 是 `comment_reply_log`，`targetId` 是紀錄 ID，`payload` 不含留言內容與留言者名稱

#### Scenario: 建立留言規則時寫稽核
- **WHEN** 有 `comment_reply.manage` 的成員以 `POST /api/v1/comment-replies/rules` 建立規則
- **THEN** 系統寫一筆稽核，`action` 是 `comment_reply.rule.create`，`targetType` 是 `comment_reply_rule`，`targetId` 是規則 ID，`payload.name` 是規則名稱
