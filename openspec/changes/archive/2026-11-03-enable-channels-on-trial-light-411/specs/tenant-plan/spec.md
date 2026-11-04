## MODIFIED Requirements

### Requirement: Plan 全域資料模型
系統 SHALL 提供 `Plan` 全域表（slug @unique、name、features Json、limits Json、priceMonthly?、isActive；不帶 tenantId 並於 schema 註解標明）與 `Tenant.planId`（nullable FK）、`Tenant.limitOverrides`（Json）。seed MUST 以 idempotent upsert 建立 trial/light/standard/professional/enterprise 五個方案。每個 seed 方案的 features MUST 含 `channels`。既有的 trial、light 方案 features 不含 `channels` 時，migration MUST 加入 `channels`，且不改動其他欄位與其他方案。

#### Scenario: seed 重複執行
- **WHEN** 方案 seed 執行兩次
- **THEN** 每個 slug MUST 只存在一列

#### Scenario: 試用與輕量版方案可以使用渠道
- **GIVEN** 租戶的方案內容與 seed 的 trial 或 light 相同，管理員的角色含 `channel.view` 與 `channel.create`
- **WHEN** 管理員呼叫 `GET /api/v1/channels`，再以 `POST /api/v1/channels` 建立 WebChat 渠道
- **THEN** 列表回 200 並含租戶既有的渠道，建立回 201

#### Scenario: 既有方案補上 channels
- **GIVEN** 資料庫的 trial 方案 features 是 `["inbox","knowledge","core"]`、light 是 `["inbox","core"]`，另有一個 slug 不同、features 不含 `channels` 的方案
- **WHEN** 執行 migration `20261103120000_enable_channels_on_trial_light` 兩次
- **THEN** trial、light 的 features 最後多一個 `channels`，name、limits、allowedChannelTypes、permissionOverrides 不變
- **AND** 另一個方案不變，第二次執行不改動任何列
