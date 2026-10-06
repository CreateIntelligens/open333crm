## MODIFIED Requirements

### Requirement: 功能天花板交集
`getEffectiveTenantPermissions()` 回傳的有效權限 MUST 為「角色權限 ∩ 天花板」，其中天花板 = plan.features 內各 feature 的權限點集合 ∪ core feature 權限點（core 恆開）。`Tenant.planId` 為 null 時 MUST 不施加天花板（行為與導入前完全相同）。

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
