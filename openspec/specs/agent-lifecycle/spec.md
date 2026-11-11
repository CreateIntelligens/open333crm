# agent-lifecycle Specification

## Purpose
定義成員帳號的生命週期：停用（保留記錄與 email，可以重新啟用）與永久刪除（釋放 email，保留歷史資料），以及兩者共同的限制：不能對自己執行，也不能用在最後一位管理員。

## Requirements

### Requirement: 停用成員

`POST /api/v1/agents/:id/deactivate` SHALL 停用本租戶的成員，要求 `agent.deactivate`。停用把成員的 `isActive` 設為 `false`，保留成員的記錄，email 仍然被這個成員佔用。停用成功時，系統 SHALL 回 HTTP 204。

停用之後：

- `GET /api/v1/agents` SHALL 只回傳啟用中的成員，不含停用的成員。
- 停用的成員不能登入，見 `auth-session` 的「停用帳號只在密碼正確時才告知」。

系統 SHALL 拒絕下列停用，回 HTTP 422，成員維持啟用：

- 成員停用自己：`SELF_ACTION_FORBIDDEN`。
- 目標是租戶最後一位啟用中的管理員：`LAST_ADMIN_PROTECTED`。管理員的定義見「改角色的最後一位管理員保護」。

目標的權限比操作者高時，系統 SHALL 回 HTTP 403（`TARGET_OUTRANKS_ACTOR`），見 `role-management` 的「對其他成員的操作不能用在權限比自己高的成員」。

成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。

#### Scenario: 停用保留記錄與 email
- **WHEN** 有 `agent.deactivate` 的成員停用成員 M
- **THEN** 系統回 HTTP 204，M 的記錄仍然存在、`isActive` 是 `false`；以 M 的 email 建立成員時，系統回 HTTP 409

#### Scenario: 停用的成員不出現在成員列表
- **WHEN** 成員 M 被停用之後，有 `agent.view` 的成員呼叫 `GET /api/v1/agents`
- **THEN** 回應不含 M

#### Scenario: 停用需權限
- **WHEN** 沒有 `agent.deactivate` 的成員停用成員 M
- **THEN** 系統回 HTTP 403，M 維持啟用

#### Scenario: 不能停用自己
- **WHEN** 有 `agent.deactivate` 的成員停用自己
- **THEN** 系統回 HTTP 422，`error.code` 是 `SELF_ACTION_FORBIDDEN`，成員維持啟用

#### Scenario: 不能停用最後一位管理員
- **WHEN** 租戶只有一位啟用中的管理員 M，另一位有 `agent.deactivate` 的成員停用 M
- **THEN** 系統回 HTTP 422，`error.code` 是 `LAST_ADMIN_PROTECTED`，M 維持啟用

### Requirement: 重新啟用成員

停用是可以復原的動作。有 `agent.deactivate` 的成員 SHALL 能以 `GET /api/v1/agents/inactive` 查詢本租戶停用的成員，並以 `POST /api/v1/agents/:id/reactivate` 把停用的成員重新啟用，成功時回 HTTP 204。重新啟用之後，成員 SHALL 能以原本的 email 與密碼登入，角色維持停用前的角色。

重新啟用 SHALL 套用方案的客服人數上限：啟用中的成員已達上限時，系統回 HTTP 403，`error.code` 是 `PLAN_LIMIT_EXCEEDED`，成員維持停用。成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。人員管理頁 SHALL 對有 `agent.deactivate` 的成員列出停用的成員與「重新啟用」按鈕。

#### Scenario: 管理員看得到停用的成員
- **WHEN** 成員 M 被停用之後，有 `agent.deactivate` 的成員查詢本租戶停用的成員
- **THEN** 結果含 M

#### Scenario: 重新啟用後可以登入
- **WHEN** 有 `agent.deactivate` 的成員重新啟用停用的成員 M
- **THEN** M 的 `isActive` 是 `true`，M 以原本的 email 與密碼登入成功，角色與停用前相同

#### Scenario: 重新啟用需權限
- **WHEN** 沒有 `agent.deactivate` 的成員查詢停用的成員或重新啟用成員 M
- **THEN** 系統回 HTTP 403，M 維持停用

#### Scenario: 重新啟用受方案人數上限限制
- **WHEN** 方案的客服人數上限是 3，租戶已有 3 位啟用中的成員，有 `agent.deactivate` 的成員重新啟用停用的成員 M
- **THEN** 系統回 HTTP 403，`error.code` 是 `PLAN_LIMIT_EXCEEDED`，M 維持停用

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

### Requirement: 改角色的最後一位管理員保護

管理員是角色的權限集合（含 `implies` 的閉包）含標記 `selfLock` 的權限碼（`role.manage`）的成員。系統 SHALL 依這個定義判斷，不看角色列舉 `role`。

以 `PATCH /api/v1/agents/:id/role` 把租戶最後一位啟用中的管理員改成不含 `selfLock` 權限碼的角色時，系統 SHALL 回 HTTP 422（`LAST_ADMIN_PROTECTED`），成員的角色不變。這個檢查排在「對其他成員的操作不能用在權限比自己高的成員」之前。

#### Scenario: 不能降級最後一位管理員
- **WHEN** 租戶只有一位啟用中的管理員 M，`supervisor` 系統角色的成員把 M 改成 `{ role: "AGENT" }`
- **THEN** 系統回 HTTP 422，`error.code` 是 `LAST_ADMIN_PROTECTED`，M 的角色不變

#### Scenario: 角色列舉是 ADMIN 但沒有 role.manage 的成員不算管理員
- **WHEN** 租戶只有一位啟用中的管理員 M，另一位成員的角色列舉是 `ADMIN`、角色沒有 `role.manage`；有 `agent.deactivate` 的成員停用 M
- **THEN** 系統回 HTTP 422，`error.code` 是 `LAST_ADMIN_PROTECTED`，M 維持啟用
