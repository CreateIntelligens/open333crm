## ADDED Requirements

### Requirement: 方案功能點層級細分（權限點 deny 覆寫）

Plan MUST 支援在 feature 基底上，於權限點層級關閉個別權限（`Plan.permissionOverrides.deny: string[]`）。有效功能天花板 MUST = `permsForFeatures(plan.features ∪ core)` 減去 `permissionOverrides.deny` 中的權限點。deny 為空或未設時，天花板 MUST 與現行（僅 feature）完全一致。改動 `permissionOverrides` MUST 失效該方案的權限天花板快取（比照改 `plan.features`）。

#### Scenario: 開行銷但關群發

- **GIVEN** 某方案 features 含 `marketing`、`permissionOverrides.deny=['marketing.broadcast']`
- **WHEN** 該方案租戶的角色即使有 `marketing.broadcast` 權限
- **THEN** 有效權限（角色 ∩ 天花板）MUST NOT 含 `marketing.broadcast`；但 `marketing.view`、`marketing.manage` 仍在天花板內（deny 高階不連坐低階）

#### Scenario: 開分析但關匯出（對標 Omnichat「能看不能匯出」）

- **GIVEN** 某方案含 `analytics`、`deny=['analytics.export']`
- **WHEN** 該租戶檢視報表
- **THEN** 報表檢視 MUST 可用，但匯出（`analytics.export`）MUST 被擋

#### Scenario: 無覆寫方案行為不變

- **GIVEN** 某方案 `permissionOverrides` 為空/未設
- **WHEN** 計算天花板
- **THEN** MUST 與僅用 feature 展開的結果完全一致（既有方案零影響）

### Requirement: 渠道數量上限

Plan MUST 支援 `plan.limits.maxChannels`（number，null=無上限）。建立渠道時，若該租戶有效 `maxChannels` 非 null 且現有渠道數已達上限，MUST 拒絕（`PLAN_LIMIT_EXCEEDED` 403），比照 `maxAgents` 硬擋機制。有效值 = `Tenant.limitOverrides.maxChannels ?? plan.limits.maxChannels`。

#### Scenario: 達渠道數上限擋新建

- **GIVEN** 某方案 `maxChannels=1`，租戶已有 1 個渠道
- **WHEN** 建立第 2 個渠道
- **THEN** MUST 回 `PLAN_LIMIT_EXCEEDED` 403，渠道 MUST NOT 被建立

#### Scenario: 無上限不擋

- **GIVEN** 某方案 `maxChannels` 為 null
- **WHEN** 建立渠道
- **THEN** MUST 不因數量被擋

### Requirement: 渠道 provider 類型限定

Plan MUST 支援 `Plan.allowedChannelTypes`（渠道類型白名單 `string[]`；空/null=不限制）。建立渠道時，若白名單非空且欲建的 `channelType` 不在白名單內，MUST 拒絕（`CHANNEL_TYPE_NOT_ALLOWED` 403）。白名單縮小 MUST NOT 影響既有已建渠道的運作（僅擋新建）。白名單值 MUST 為合法 `channelType`。

#### Scenario: 只允許 LINE 的方案擋 FB 渠道

- **GIVEN** 某方案 `allowedChannelTypes=['LINE','WEBCHAT']`
- **WHEN** 建立 `FB` 渠道
- **THEN** MUST 回 `CHANNEL_TYPE_NOT_ALLOWED` 403

#### Scenario: 白名單允許的類型可建

- **GIVEN** 同上方案
- **WHEN** 建立 `LINE` 渠道
- **THEN** MUST 允許（若同時未達 maxChannels）

#### Scenario: 縮白名單不影響既有渠道

- **GIVEN** 租戶已有 1 個 `FB` 渠道，方案白名單後改為只 `['LINE']`
- **WHEN** 該 FB 渠道收發訊息
- **THEN** 既有 FB 渠道 MUST 繼續正常運作（僅「新建 FB」被擋）

#### Scenario: 未設白名單不限制

- **GIVEN** 某方案 `allowedChannelTypes` 為空/null
- **WHEN** 建立任何類型渠道
- **THEN** MUST 不因類型被擋（既有方案零影響）

### Requirement: 功能與權限點清單動態化（可擴展性）

平台後台方案設定所用的「功能模組清單、各功能的權限點清單、渠道類型清單」MUST 由後端動態提供（單一資料源＝`@open333crm/core` 的 features + permissions registry + channelType 定義），MUST NOT 於前端寫死。平台後台方案頁 MUST 從此動態來源載入。未來於 core 新增 feature／權限點／渠道類型後，平台後台方案設定 MUST 自動可見並可納入分級，無需修改前端。

#### Scenario: 新增功能自動出現在方案設定

- **GIVEN** 開發者於 `@open333crm/core` 新增一個 feature（含 label/desc）與其權限點
- **WHEN** 平台 superuser 開啟方案設定頁
- **THEN** 該新功能 MUST 自動出現、可勾選納入方案、可 deny 其權限點——無需修改前端程式碼

#### Scenario: 功能清單來自後端非前端寫死

- **WHEN** 平台後台方案頁載入功能清單
- **THEN** 清單 MUST 來自後端 registry 端點（feature slug/label/desc + 權限點 + 渠道類型），MUST NOT 依賴前端硬編碼陣列

### Requirement: 平台後台可設定細粒度分級

平台後台方案設定頁 MUST 讓 superuser 設定：feature 下可展開勾選/取消個別權限點（deny）、`maxChannels` 數值、`allowedChannelTypes` 多選。設定 MUST 受 platform superuser 認證保護、變更寫 `PlatformAuditLog`。

#### Scenario: 平台設定權限點 deny 與渠道限制

- **GIVEN** 平台 superuser 於方案設定
- **WHEN** 為某方案 deny `analytics.export`、設 `maxChannels=3`、`allowedChannelTypes=['LINE']`
- **THEN** MUST 持久化並失效相關快取，之後該方案租戶即時受這些限制
