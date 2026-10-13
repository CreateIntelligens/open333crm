## Purpose
Define the Case Management API contract for case lifecycle operations, status transition validation, and conversation linking.

## Requirements

### Requirement: Case Deletion API
The API SHALL provide an authenticated, tenant-scoped `DELETE /api/v1/cases/:id` endpoint to delete a Case by id.

#### Scenario: Delete an existing Case
- **WHEN** an authenticated agent deletes a Case that belongs to the agent's tenant
- **THEN** the system deletes the Case, unlinks related Conversations, emits `case.deleted` to the tenant room, and returns success

#### Scenario: Delete a Case from another tenant
- **WHEN** an authenticated agent attempts to delete a Case that does not belong to the agent's tenant
- **THEN** the system returns not found and does not delete the Case

### Requirement: Case Status Transition Validation
The system SHALL validate every public Case status change using the shared Case transition rules.

#### Scenario: Reject closed to in progress transition
- **WHEN** an authenticated agent attempts to change a Case from `CLOSED` directly to `IN_PROGRESS`
- **THEN** the system rejects the request with an invalid transition error and leaves the Case unchanged

#### Scenario: Allow closed to open reopen transition
- **WHEN** an authenticated agent reopens a Case from `CLOSED`
- **THEN** the system changes the Case status to `OPEN` and records a status change event

### Requirement: Case Conversation Linking
The system SHALL support linking multiple Conversations to one Case while ensuring each Conversation is linked to at most one Case.

#### Scenario: Create Case from Conversation
- **WHEN** an authenticated agent creates a Case from an unlinked Conversation
- **THEN** the system creates the Case, links the triggering Conversation to the Case atomically, emits `case.created`, and returns the created Case

#### Scenario: Reject duplicate Case creation from linked Conversation
- **WHEN** an authenticated agent attempts to create a new Case from a Conversation that already has a linked Case
- **THEN** the system rejects the request with a conflict response and does not create another Case

#### Scenario: Link another Conversation to existing Case
- **WHEN** an authenticated agent links an unlinked Conversation from the same tenant to an existing Case
- **THEN** the system links the Conversation to that Case and the Case detail exposes the linked Conversations

#### Scenario: Reject cross-tenant Conversation link
- **WHEN** an authenticated agent attempts to link a Conversation from another tenant to a Case
- **THEN** the system rejects the request with not found and does not change either record

### Requirement: Cases Dashboard Deletion
The `/dashboard/cases` page SHALL allow an authenticated user to delete an existing Case from the cases list by using the tenant-scoped Case deletion API. A delete action SHALL be isolated from row navigation, SHALL ask for confirmation before deleting, and SHALL refresh the displayed cases after a successful deletion.

#### Scenario: Delete case from list
- **WHEN** a user confirms deletion of a Case from `/dashboard/cases`
- **THEN** the frontend calls the Case deletion API for that Case and removes the deleted Case from the refreshed list

#### Scenario: Delete action does not navigate
- **WHEN** a user clicks the delete action on a Case row
- **THEN** the row navigation to the Case detail page is not triggered

#### Scenario: Delete fails
- **WHEN** the Case deletion API returns an error
- **THEN** the deleted Case remains visible after refresh and the user receives an error indication

### Requirement: Cases Dashboard Create Button Hidden
The `/dashboard/cases` page SHALL NOT display the standalone create-case button or open the standalone create-case modal. Case creation from conversation context in `/dashboard/inbox` SHALL remain available.

#### Scenario: Cases page has no create button
- **WHEN** a user opens `/dashboard/cases`
- **THEN** no standalone "建立案件" button is displayed in the page topbar

#### Scenario: Inbox create case still available
- **WHEN** a user opens a conversation in `/dashboard/inbox`
- **THEN** the inbox contact panel can still open the create-case modal for that conversation

### Requirement: 工單路由依權限碼授權
工單路由 SHALL 依 proposal 對照表檢查權限碼，缺少時回傳 HTTP 403。`PATCH /cases/:id` 帶 `assigneeId` 或 `teamId` 時 SHALL 另外要求 `case.assign`；把狀態改為 `ESCALATED` 時 SHALL 另外要求 `case.escalate`。

#### Scenario: 沒有任何權限的角色
- **WHEN** 角色沒有任何權限碼的成員呼叫任一工單路由
- **THEN** 回傳 HTTP 403

#### Scenario: 缺少該路由需要的權限碼
- **WHEN** 角色具備其他所有工單、收件匣、標籤、短連結權限碼，唯獨缺少某條路由需要的權限碼
- **THEN** 該路由回傳 HTTP 403

#### Scenario: 只有編輯權限時改負責人
- **WHEN** 只有 `case.view` 與 `case.update` 的成員以 `PATCH /cases/:id` 送出 `assigneeId`
- **THEN** 回傳 HTTP 403

#### Scenario: 只有編輯權限時升級工單
- **WHEN** 只有 `case.view` 與 `case.update` 的成員以 `PATCH /cases/:id` 把狀態改為 `ESCALATED`
- **THEN** 回傳 HTTP 403

#### Scenario: 建立工單時順便指派
- **WHEN** 只有 `case.view` 與 `case.create` 的成員建立工單時帶 `assigneeId` 或 `teamId`
- **THEN** 回傳 HTTP 403，缺少的權限碼為 `case.assign`

#### Scenario: 只有編輯權限時改標題
- **WHEN** 只有 `case.view` 與 `case.update` 的成員以 `PATCH /cases/:id` 修改標題
- **THEN** 通過權限檢查

### Requirement: Escalation Notify Targets Are Validated
`POST /api/v1/cases/:id/escalate` SHALL accept `notifyTargets` only as an array of `supervisor`, `original_assignee` and `team`; any other value SHALL be rejected with 400 and the case SHALL not change. `team` is accepted but currently notifies no one.

#### Scenario: Invalid notify target
- **WHEN** an agent escalates a case with `notifyTargets: ["everyone"]`
- **THEN** the system SHALL respond 400 and the case SHALL not change

### Requirement: Escalation Notifies The Selected Targets
After escalation the system SHALL notify, for `supervisor`, every active supervisor and admin of the tenant, and for `original_assignee`, the active agent assigned before the escalation. The agent who escalated SHALL NOT be notified, and each agent SHALL receive at most one notification. When `notifyTargets` is omitted, only supervisors and admins SHALL be notified.

#### Scenario: Notify the original assignee
- **WHEN** agent A escalates a case previously assigned to agent B with `notifyTargets: ["original_assignee"]`
- **THEN** agent B SHALL receive a case-escalated notification and no supervisor SHALL be notified

#### Scenario: Notify supervisors and the original assignee
- **WHEN** a case assigned to agent B is escalated with `notifyTargets: ["supervisor", "original_assignee"]` and agent B is also a supervisor
- **THEN** every active supervisor and admin SHALL be notified, and agent B SHALL receive exactly one notification

#### Scenario: Escalating agent is the original assignee
- **WHEN** agent B escalates a case assigned to agent B with `notifyTargets: ["original_assignee"]`
- **THEN** no notification SHALL be sent to agent B

#### Scenario: No notify targets given
- **WHEN** a case is escalated without `notifyTargets`
- **THEN** every active supervisor and admin SHALL be notified

#### Scenario: Empty notify targets
- **WHEN** a case is escalated with `notifyTargets: []`
- **THEN** no escalation notification SHALL be sent

#### Scenario: Supervisor escalates a case
- **WHEN** supervisor S escalates a case with `notifyTargets: ["supervisor"]`
- **THEN** every other active supervisor and admin SHALL be notified, and S SHALL NOT be notified

#### Scenario: Escalation dialog selects notify team
- **WHEN** an agent escalates a case from the escalation dialog with `notifyTargets: ["supervisor", "original_assignee", "team"]`
- **THEN** the escalation SHALL succeed
