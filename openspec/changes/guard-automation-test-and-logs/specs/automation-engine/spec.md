## ADDED Requirements

### Requirement: 試跑規則與讀取執行紀錄要求檢視權限

`POST /automation/rules/:id/test` 與 `GET /automation/logs` SHALL 以 `requirePermission('automation.view')` 檢查成員的有效權限集合。成員缺少 `automation.view` 時，系統 MUST 回 HTTP 403，`error.details.requiredPermission` 為 `automation.view`，並且 MUST NOT 評估規則或回傳執行紀錄。

#### Scenario: 沒有檢視權限時試跑規則
- **WHEN** 有效權限集合只含 `inbox.view` 的成員呼叫 `POST /automation/rules/:id/test`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 為 `automation.view`

#### Scenario: 沒有檢視權限時讀取執行紀錄
- **WHEN** 有效權限集合只含 `inbox.view` 的成員呼叫 `GET /automation/logs`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 為 `automation.view`

#### Scenario: 只有檢視權限時試跑規則與讀取執行紀錄
- **WHEN** 有效權限集合只含 `automation.view` 的成員呼叫 `POST /automation/rules/:id/test` 與 `GET /automation/logs`
- **THEN** 系統回 HTTP 200，回傳試跑結果與執行紀錄
