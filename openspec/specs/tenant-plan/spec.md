# tenant-plan Specification

## Purpose

定義全域的方案（`Plan`）、租戶所屬的方案，以及方案的功能天花板：成員的有效權限是角色權限與方案功能的交集。數值上限見 `plan-limits-core`；權限點層級的關閉與渠道限制見 `granular-plan-entitlement`；有效權限的整體計算見 `permission-check`。

## Requirements

### Requirement: Plan 全域資料模型
系統 SHALL 提供 `Plan` 全域表（slug @unique、name、features Json、limits Json、priceMonthly?、isActive；不帶 tenantId 並於 schema 註解標明）與 `Tenant.planId`（nullable FK）、`Tenant.limitOverrides`（Json）。seed MUST 以 idempotent upsert 建立 trial/light/standard/professional/enterprise 五個方案。

#### Scenario: seed 重複執行
- **WHEN** 方案 seed 執行兩次
- **THEN** 每個 slug MUST 只存在一列

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

#### Scenario: 方案的 features 不含 core
- **GIVEN** 方案的 features 只有 `inbox`，不含 `core`，某個成員的角色授予 `role.manage`
- **WHEN** 取得這個成員的有效權限
- **THEN** 結果含 `role.manage`

### Requirement: 方案管理 API
平台 API SHALL 提供 plans 列表與更新（name/features/limits/priceMonthly/isActive）。更新 features/limits MUST 觸發該 plan 相關權限快取失效。

平台後台的方案設定頁 MUST NOT 讓平台管理員取消 `core` 功能。

#### Scenario: 更新 limits
- **WHEN** superuser 把 trial plan 的 `limits.maxAgents` 從 3 改為 5
- **THEN** 該方案所有租戶的有效 maxAgents（無 override 者）MUST 變為 5

#### Scenario: 平台後台不能取消 core
- **WHEN** 平台管理員開啟方案設定頁
- **THEN** 每個方案的 `core` 勾選框都是停用狀態，其他功能的勾選框可以操作

### Requirement: 平台變更租戶的方案
平台管理員以 `PATCH /api/v1/platform/tenants/:id` 帶 `planSlug` 變更租戶的方案時，API SHALL 更新 `Tenant.planId`，並清除這個租戶的方案快取。成員之後的權限檢查 MUST 依新方案計算天花板。

變更方案 MUST NOT 新增或刪除任何角色的權限設定（`RolePermission`）。降級後被天花板擋下的權限仍然留在角色上。租戶升回原方案時，這些權限自動恢復生效。

API MUST 寫入 action 為 `tenant.update` 的平台稽核，payload 含 `planSlug`。

#### Scenario: 變更方案後立即生效
- **GIVEN** API 已經讀過某個租戶的方案
- **WHEN** 平台管理員把這個租戶改到另一個方案
- **THEN** API 下一次讀這個租戶的方案時，得到新的方案

#### Scenario: 降級不刪除角色的權限設定
- **GIVEN** 租戶的方案含 `marketing`，某個成員的角色授予 `marketing.view`
- **WHEN** 平台管理員把租戶改到不含 `marketing` 的方案
- **THEN** 這個成員的有效權限不含 `marketing.view`
- **AND** 成員角色的 `RolePermission` 仍然含 `marketing.view`

#### Scenario: 升回原方案後恢復權限
- **GIVEN** 租戶已經從含 `marketing` 的方案降級，某個成員的角色仍然授予 `marketing.view`
- **WHEN** 平台管理員把租戶改回含 `marketing` 的方案
- **THEN** 這個成員的有效權限再次含 `marketing.view`，租戶不需要重新設定角色

#### Scenario: 變更方案留稽核
- **WHEN** 平台管理員以 `PATCH /api/v1/platform/tenants/:id` 把租戶改到 `standard` 方案
- **THEN** API 寫入 action 為 `tenant.update` 的稽核，payload 的 `planSlug` 為 `standard`
