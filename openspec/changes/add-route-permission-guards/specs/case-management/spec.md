## ADDED Requirements

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
