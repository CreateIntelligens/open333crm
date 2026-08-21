## ADDED Requirements

### Requirement: 數值上限參數化儲存（非寫死）
系統 SHALL 將方案的數值上限（如 maxAgents 客服人數、maxTags 分眾標籤數）儲存於 `Plan.limits`（Json，平台全域），並支援 `Tenant.limitOverrides`（Json）作為單租戶覆寫。任一 limit 的有效值 MUST 為 `Tenant.limitOverrides[key] ?? Plan.limits[key]`。`null` MUST 代表無上限。這些上限 MUST NOT 以程式碼常數寫死；平台方 MUST 能透過平台後台改動而不需改程式碼或重新部署。

#### Scenario: 有效上限取單租戶覆寫優先
- **GIVEN** 某租戶所屬方案 `Plan.limits.maxAgents` 為 10
- **AND** 該租戶 `Tenant.limitOverrides.maxAgents` 為 15
- **WHEN** 系統計算該租戶的客服人數有效上限
- **THEN** 有效上限 MUST 為 15

#### Scenario: 無覆寫時取方案預設
- **GIVEN** 某租戶所屬方案 `Plan.limits.maxTags` 為 500
- **AND** 該租戶 `Tenant.limitOverrides` 未設定 maxTags
- **WHEN** 系統計算該租戶的標籤數有效上限
- **THEN** 有效上限 MUST 為 500

#### Scenario: null 代表無上限
- **GIVEN** 企業版方案 `Plan.limits.maxAgents` 為 null
- **WHEN** 系統計算該方案租戶的客服人數有效上限
- **THEN** 系統 MUST 視為無上限，不對新增客服施以人數硬擋

#### Scenario: 平台後台改上限即時生效
- **GIVEN** 標準版 `Plan.limits.maxAgents` 原為 10
- **WHEN** 平台 superuser 於後台將其改為 12
- **THEN** 該方案所有租戶的客服人數有效上限 MUST 變為 12，無需改程式碼或重新部署

### Requirement: 客服人數上限硬擋（建立時檢查）
新增客服（Agent）時，系統 MUST 檢查該租戶目前 active agent 數是否已達有效 maxAgents 上限；已達上限時 MUST 擋下新增並回傳明確錯誤（如「已達方案客服人數上限，請升級方案」）。有效上限為 null（無上限）時 MUST NOT 擋。此為建立時的一次性 count 檢查，不需即時計數器。

#### Scenario: 達人數上限擋下新增
- **GIVEN** 某租戶有效 maxAgents 為 10 且已有 10 位 active agent
- **WHEN** 嘗試新增第 11 位客服
- **THEN** 系統 MUST 擋下並回傳「已達方案客服人數上限」錯誤
- **AND** 該 agent MUST NOT 被建立

#### Scenario: 未達上限正常新增
- **GIVEN** 某租戶有效 maxAgents 為 10 且目前有 8 位 active agent
- **WHEN** 新增一位客服
- **THEN** 新增 MUST 成功

#### Scenario: 無上限不擋
- **GIVEN** 企業版租戶有效 maxAgents 為 null
- **WHEN** 新增第 100 位客服
- **THEN** 新增 MUST 成功，不受人數硬擋

### Requirement: 分眾標籤數上限硬擋（建立時檢查）
建立標籤（Tag）時，系統 MUST 檢查該租戶目前標籤數是否已達有效 maxTags 上限；已達上限時 MUST 擋下並回傳明確錯誤。有效上限為 null 時 MUST NOT 擋。

#### Scenario: 達標籤上限擋下建立
- **GIVEN** 某租戶有效 maxTags 為 500 且已有 500 個標籤
- **WHEN** 嘗試建立第 501 個標籤
- **THEN** 系統 MUST 擋下並回傳「已達方案標籤數上限」錯誤
- **AND** 該標籤 MUST NOT 被建立

#### Scenario: 未達標籤上限正常建立
- **GIVEN** 某租戶有效 maxTags 為 500 且目前有 480 個標籤
- **WHEN** 建立一個標籤
- **THEN** 建立 MUST 成功

### Requirement: 上限檢查與功能權限正交
數值上限硬擋 MUST 獨立於 RBAC 權限與 feature entitlement 判斷：一個持有 `agent.manage` 權限、且方案含對應 feature 的使用者，在達人數上限時 MUST 仍被擋下建立。上限硬擋 MUST 在通過權限與 entitlement 檢查之後、實際建立之前執行。

#### Scenario: 有權限但達上限仍被擋
- **GIVEN** 某使用者持有 `agent.manage` 權限且租戶已達 maxAgents 上限
- **WHEN** 該使用者新增客服
- **THEN** 系統 MUST 因人數上限擋下，回傳上限相關錯誤（非 403 權限錯誤）

### Requirement: 上限硬擋錯誤可辨識並引導升級
數值上限硬擋回傳的錯誤 MUST 使用可辨識的錯誤碼（如 `PLAN_LIMIT_EXCEEDED`）並帶上被超過的 limit key 與當前/上限值，供前端呈現「已達上限、引導升級」訊息。

#### Scenario: 錯誤含 limit 資訊
- **GIVEN** 某租戶達 maxAgents 上限
- **WHEN** 新增客服被擋
- **THEN** 回傳的錯誤 MUST 含錯誤碼 `PLAN_LIMIT_EXCEEDED`、limit key（maxAgents）、當前值與上限值
