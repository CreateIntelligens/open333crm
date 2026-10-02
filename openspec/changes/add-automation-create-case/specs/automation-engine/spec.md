## ADDED Requirements

### Requirement: 自動化建立工單
規則的 `create_case` 動作 SHALL 在觸發的對話上建立工單：套用同優先度的 SLA 政策、對話關聯到新工單、寫入 `actorType: automation` 的工單事件、推播並發出 `case.created`；分類 SHALL 只接受系統分類清單內的值。觸發事件為工單或 SLA 相關、沒有對話、或對話已有未結案工單時 SHALL NOT 建立。

#### Scenario: 關鍵字命中時建立工單
- **WHEN** 規則「關鍵字命中『客訴』→ 建立工單（標題『客訴』、優先度 HIGH）」命中，對話尚未關聯工單
- **THEN** 建立一張 OPEN 工單，渠道與聯絡人取自該對話，套用 HIGH 的 SLA 政策，對話關聯到這張工單

#### Scenario: 對話已有未結案工單
- **WHEN** 對話已關聯一張處理中的工單，規則再次命中
- **THEN** 不建立新工單

#### Scenario: 原工單已結案
- **WHEN** 對話關聯的工單已結案，規則再次命中
- **THEN** 建立新工單，對話改關聯到新工單

#### Scenario: 工單事件觸發
- **WHEN** 觸發事件是 `case.created` 等工單或 SLA 事件
- **THEN** 不建立工單；規則編輯器在這些事件也不提供「建立工單」

#### Scenario: 並行處理同一段對話
- **WHEN** 兩個 worker 幾乎同時對同一段尚無工單的對話執行建立工單
- **THEN** 只有一張工單被建立並關聯，另一個回滾、不留下工單

### Requirement: 新工單的自動分類不覆蓋既有分類
API 收到 `case.created` 時 SHALL 只在工單尚無分類時，依對話最新的顧客訊息自動分類。

#### Scenario: 已有分類
- **WHEN** 客服手動建單時選了分類，或自動化規則指定了分類
- **THEN** 不執行自動分類，分類維持原值

