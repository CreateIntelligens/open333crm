## MODIFIED Requirements

### Requirement: 查詢租戶稽核

`GET /api/v1/tenant/audit-logs` SHALL 回傳目前租戶的稽核，依 `createdAt` 由新到舊排序，每頁預設 20 筆、最多 100 筆。查詢 SHALL 支援依 `action`、`actorId` 與日期區間（`from`、`to`）篩選。呼叫的成員 SHALL 有 `audit.view`，沒有時系統回 HTTP 403。回傳的稽核 SHALL 只屬於目前的租戶。

每筆稽核 SHALL 回傳 `actor` 與 `actorSnapshot`：

- `actor`：操作者成員還存在時是 `{ id, name, email }`，否則是 `null`。
- `actorSnapshot`：操作者被永久刪除時保存的 `{ name, email }`（見 `agent-lifecycle` 的「永久刪除成員」）；沒有保存快照時是 `null`。

#### Scenario: 依 action 篩選本租戶的稽核
- **WHEN** 有 `audit.view` 的成員以 `action=role.permission.update` 查詢
- **THEN** 系統回 HTTP 200，結果只含本租戶 `action` 是 `role.permission.update` 的稽核，不含其他租戶的稽核

#### Scenario: 沒有 audit.view 不能查詢
- **WHEN** 沒有 `audit.view` 的成員送出 `GET /api/v1/tenant/audit-logs`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `audit.view`，不回傳任何稽核

#### Scenario: 分頁與日期篩選
- **WHEN** 成員以 `from`、`to` 與 `pageSize` 查詢
- **THEN** 系統只回傳 `createdAt` 落在區間內的稽核，每頁筆數不超過 `pageSize`，`total` 是符合條件的總筆數

#### Scenario: 操作者被永久刪除後回傳快照
- **WHEN** 成員 X 發起資料匯出後被停用並永久刪除，有 `audit.view` 的成員以 `action=data.export.request` 查詢
- **THEN** 該筆稽核的 `actor` 是 `null`，`actorSnapshot` 是 `{ name: X 的名稱, email: X 的 email }`

#### Scenario: 操作者還在時沒有快照
- **WHEN** 有 `audit.view` 的成員查詢操作者仍存在的稽核
- **THEN** 該筆稽核的 `actor` 是 `{ id, name, email }`，`actorSnapshot` 是 `null`
