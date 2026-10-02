## ADDED Requirements

### Requirement: 自動化建立工單
規則的 `create_case` 動作 SHALL 在觸發的對話上建立工單：套用同優先度的 SLA 政策、對話關聯到新工單、寫入 `actorType: automation` 的工單事件、推播並發出 `case.created`；同一條規則的後續動作 SHALL 作用在新工單上。觸發事件為工單或 SLA 相關、沒有對話、或對話已有未結案工單時 SHALL NOT 建立。

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
