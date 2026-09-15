# tenant-plan

## ADDED Requirements

### Requirement: Plan 全域資料模型
系統 SHALL 提供 `Plan` 全域表（slug @unique、name、features Json、limits Json、priceMonthly?、isActive；不帶 tenantId 並於 schema 註解標明）與 `Tenant.planId`（nullable FK）、`Tenant.limitOverrides`（Json）。seed MUST 以 idempotent upsert 建立 trial/light/standard/professional/enterprise 五個方案。

#### Scenario: seed 重複執行
- **WHEN** 方案 seed 執行兩次
- **THEN** 每個 slug MUST 只存在一列

### Requirement: 功能天花板交集
`getEffectivePermissions()` 回傳的有效權限 MUST 為「角色權限 ∩ 天花板」，其中天花板 = plan.features 內各 feature 的權限點集合 ∪ core feature 權限點（core 恆開）。`Tenant.planId` 為 null 時 MUST 不施加天花板（行為與導入前完全相同）。

#### Scenario: trial 方案未含 marketing
- **GIVEN** trial plan 的 features 不含 `marketing`，某 trial 租戶 admin 的角色權限含 `marketing.view`
- **WHEN** 取得該 admin 的有效權限
- **THEN** 結果 MUST NOT 含 `marketing.view`
- **AND** 呼叫 marketing API MUST 被 requirePermission 擋下（403）

#### Scenario: 無 plan 租戶不受影響
- **GIVEN** 某既有租戶 planId 為 null
- **WHEN** 取得其成員有效權限
- **THEN** 結果 MUST 與角色權限完全相同

#### Scenario: 平台改 plan features 即時生效
- **GIVEN** trial plan 原含 `knowledge`
- **WHEN** superuser 從 trial plan 移除 `knowledge`
- **THEN** 該方案所有租戶的有效權限 MUST 在快取失效後不再含 knowledge 權限點，無需改碼或重新部署

### Requirement: 方案管理 API
平台 API SHALL 提供 plans 列表與更新（name/features/limits/priceMonthly/isActive）。更新 features/limits MUST 觸發該 plan 相關權限快取失效。

#### Scenario: 更新 limits
- **WHEN** superuser 把 trial plan 的 `limits.maxAgents` 從 3 改為 5
- **THEN** 該方案所有租戶的有效 maxAgents（無 override 者）MUST 變為 5
