## MODIFIED Requirements

### Requirement: Login resolves tenant from globally-unique email
`POST /auth/login` SHALL 以 email 解析出登入者所屬租戶，不再使用任何寫死的租戶 ID。`Agent.email` 為全域唯一（`@@unique([email])`），故 `login()` 以 `findUnique({ where: { email } })` 查出唯一的 agent，其 `agent.tenantId` 即為所屬租戶，並編入 JWT payload。整條 token → request → query 鏈路隨後自動帶對租戶。

#### Scenario: Login resolves the correct tenant
- **WHEN** 某 agent（屬於租戶 T）以正確 email + password 登入
- **THEN** 登入成功，簽發的 Access Token payload 中 `tenantId` 等於該 agent 的 `tenantId`（T），而非任何寫死值

#### Scenario: Login with non-existent email
- **WHEN** 傳入系統中不存在的 email
- **THEN** 回傳 HTTP 401 `INVALID_CREDENTIALS`（與密碼錯誤同一訊息，不洩漏 email 是否存在）

#### Scenario: Email is globally unique across tenants
- **WHEN** 嘗試在任一租戶建立一個 email 已被其他租戶使用的 agent
- **THEN** 資料庫層以 unique 約束（P2002）拒絕；`createAgent()` 先以 `findUnique({ email })` 全域檢查並回傳 HTTP 409 `CONFLICT`

---

### Requirement: Disabled tenant is blocked from login
`login()` SHALL 在查出 agent 時一併載入 `tenant.isActive`。即使 agent 帳號本身有效（`agent.isActive = true`），只要其所屬租戶被停用（`tenant.isActive = false`，例如欠費停權），系統 MUST 擋下登入並回 `TENANT_DISABLED`（HTTP 403）。租戶關聯缺失（孤兒列）亦 MUST 視為停用擋下。

#### Scenario: Agent of a disabled tenant cannot log in
- **WHEN** 一個帳號本身 active、但所屬租戶 `isActive = false` 的 agent 以正確憑證登入
- **THEN** 回傳 HTTP 403 `TENANT_DISABLED`，不簽發任何 token

#### Scenario: Agent of an active tenant logs in normally
- **WHEN** 一個帳號 active 且所屬租戶 `isActive = true` 的 agent 以正確憑證登入
- **THEN** 正常登入並簽發 token

---

### Requirement: Disabled tenant inbound webhooks are dropped
`processWebhookEvent` SHALL 在載入 channel 時一併檢查其所屬 `tenant.isActive`。租戶被停用時，即使 channel 本身仍 `isActive`，系統 MUST 不處理其 inbound 訊息——安靜丟棄（記 `warn` log 後 `return`），不 throw。由於 webhook route 已先回 HTTP 200 再 fire-and-forget 呼叫本函式，丟棄不影響對外回應、也不會觸發平台端重試或 webhook 自動停用。

#### Scenario: Inbound message for a disabled tenant is dropped
- **WHEN** 一個所屬租戶 `isActive = false` 的 channel 收到 inbound webhook 事件
- **THEN** 系統記錄 warn log 並停止處理該事件（不建立 contact / conversation / message），對平台端已回 200

#### Scenario: Inbound message for an active tenant is processed
- **WHEN** 一個所屬租戶 `isActive = true` 的 active channel 收到 inbound webhook 事件
- **THEN** 正常進入既有的 contact / conversation / message inbound 處理管線

---

### Requirement: Daily analytics aggregation runs per active tenant
每日分析聚合排程（`setupAnalyticsScheduler`）SHALL 對所有 `isActive = true` 的租戶各執行一次當日聚合，而非僅單一寫死租戶。單一租戶聚合失敗 MUST 只記 log 而不中斷其他租戶的聚合。

#### Scenario: Aggregation covers all active tenants
- **WHEN** 每日排程觸發（或系統啟動時的補跑）且系統中有多個 `isActive` 租戶
- **THEN** 每個 active 租戶各產生一筆當日 `DailyStat`；`isActive = false` 的租戶不參與

#### Scenario: One tenant's aggregation failure is isolated
- **WHEN** 聚合某個租戶時拋出錯誤
- **THEN** 系統記錄該租戶的 error log，並繼續聚合其餘租戶（不整批中斷）
