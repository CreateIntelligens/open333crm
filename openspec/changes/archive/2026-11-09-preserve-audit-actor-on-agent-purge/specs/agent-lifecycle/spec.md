## MODIFIED Requirements

### Requirement: 永久刪除成員

`DELETE /api/v1/agents/:id` SHALL 永久刪除本租戶的成員，要求 `agent.purge`。刪除不可復原，會釋放成員的 email。刪除成功時，系統 SHALL 回 HTTP 204。

系統 SHALL 在同一個交易內依序執行下列步驟，任一步失敗時整個交易回復：

1. 刪除參照這個成員、而且會阻止刪除成員的資料：通知、CLI session 與 passkey。
2. 保留操作者快照：把成員的名稱與 email 寫進本租戶以他為操作者的稽核（`actorName`、`actorEmail`），以及他發起的資料匯出請求與資料刪除請求（`requestedByName`、`requestedByEmail`）。
3. 刪除成員。
4. 寫一筆 `agent.purge` 稽核，`targetId` 是成員的 ID，`payload` 是 `{ name }`（成員的名稱）。`payload` SHALL NOT 包含 email。

對話、工單與訊息等歷史資料 SHALL 保留，原本指向這個成員的負責人或送出者欄位改為空值。稽核與資料匯出、刪除請求的操作者欄位也改為空值，名稱與 email 留在步驟 2 寫入的快照欄位。

系統 SHALL 拒絕下列刪除，回 HTTP 422，成員不被刪除：

- 成員刪除自己：`SELF_ACTION_FORBIDDEN`。
- 目標是租戶最後一位啟用中的管理員：`LAST_ADMIN_PROTECTED`。管理員的定義見「改角色的最後一位管理員保護」。

目標的權限比操作者高時，系統 SHALL 回 HTTP 403（`TARGET_OUTRANKS_ACTOR`），見 `role-management` 的「對其他成員的操作不能用在權限比自己高的成員」。

成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。刪除被拒時，系統 SHALL NOT 寫入任何快照。

#### Scenario: 刪除釋放 email
- **WHEN** 有 `agent.purge` 的成員刪除成員 M
- **THEN** 系統回 HTTP 204，M 的記錄不再存在；之後以 M 的 email 建立成員時，系統回 HTTP 201

#### Scenario: 刪除清理會阻止刪除的關聯
- **WHEN** 成員 M 有通知與 CLI session，有 `agent.purge` 的成員刪除 M
- **THEN** 系統回 HTTP 204，M 與這些通知、CLI session 都不再存在

#### Scenario: 刪除保留歷史
- **WHEN** 成員 M 是一張工單的負責人，有 `agent.purge` 的成員刪除 M
- **THEN** 該工單仍然存在，負責人欄位是空值

#### Scenario: 刪除保留操作者快照
- **WHEN** 成員 M 發起一次資料匯出（產生一筆 `data.export.request` 稽核），管理員停用並刪除 M
- **THEN** 該筆稽核的 `actorId` 是空值，`actorName`、`actorEmail` 是 M 的名稱與 email；該筆匯出請求的 `requestedBy` 是空值，`requestedByName`、`requestedByEmail` 是 M 的名稱與 email；其他成員的稽核快照欄位維持空值

#### Scenario: 刪除稽核記下被刪成員的名稱
- **WHEN** 有 `agent.purge` 的成員刪除成員 M
- **THEN** 新增一筆 `agent.purge` 稽核，`targetId` 是 M 的 ID，`payload` 是 `{ "name": M 的名稱 }`，`payload` 不含 M 的 email

#### Scenario: 刪除被拒時不寫快照
- **WHEN** 刪除因成員不存在（404）、目標是最後一位管理員（422）或目標權限比操作者高（403）被拒
- **THEN** 系統不更新任何稽核或資料匯出、刪除請求的快照欄位

#### Scenario: 刪除需權限且限本租戶
- **WHEN** 沒有 `agent.purge` 的成員刪除成員 M；或有 `agent.purge` 的成員刪除其他租戶的成員 N
- **THEN** 前者回 HTTP 403，後者回 HTTP 404，M 與 N 都仍然存在

#### Scenario: 不能刪除自己
- **WHEN** 有 `agent.purge` 的成員刪除自己
- **THEN** 系統回 HTTP 422，`error.code` 是 `SELF_ACTION_FORBIDDEN`，成員仍然存在

#### Scenario: 不能刪除最後一位管理員
- **WHEN** 租戶只有一位啟用中的管理員 M，另一位有 `agent.purge` 的成員刪除 M
- **THEN** 系統回 HTTP 422，`error.code` 是 `LAST_ADMIN_PROTECTED`，M 仍然存在
