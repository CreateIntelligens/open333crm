## ADDED Requirements

### Requirement: Plan 與 Feature Override 資料模型
系統 SHALL 以平台層全域 Plan 表（不帶 tenantId）定義每個方案預設涵蓋的 feature module 清單，並在 Tenant 表以 planId（FK → Plan）與 featureOverrides（Json，結構為 { grant: string[], revoke: string[] }）記錄單租戶微調。Plan 的 slug MUST 全域唯一；每個租戶 MUST 恰好對應一組 entitlement（1:1 掛在 Tenant，不另開表）。

#### Scenario: Plan 為全域表無 tenantId
- **GIVEN** 平台方新增一個 slug 為 `pro` 的 Plan
- **WHEN** 該 Plan 寫入資料庫
- **THEN** Plan 記錄不含任何 tenantId 欄位
- **AND** 其 `features` 欄位存有該方案預設的 feature module slug 清單（string[]）

#### Scenario: Plan slug 全域唯一
- **GIVEN** 資料庫已存在 slug 為 `free` 的 Plan
- **WHEN** 平台方再新增另一個 slug 同為 `free` 的 Plan
- **THEN** 寫入 MUST 失敗並回報唯一性衝突
- **AND** 資料庫中 slug 為 `free` 的 Plan 仍只有一筆

#### Scenario: 租戶以 planId 與 featureOverrides 記錄 entitlement
- **GIVEN** 一個租戶隸屬於 `pro` 方案
- **WHEN** 平台方為該租戶加購 `automation` 並關閉 `portal`
- **THEN** 該租戶的 `featureOverrides` MUST 記為 `{ grant: ["automation"], revoke: ["portal"] }`
- **AND** 該租戶的 `planId` 仍指向 `pro` 方案不變

#### Scenario: 每租戶恰好一組 entitlement
- **GIVEN** 任一存在的租戶
- **WHEN** 查詢其 entitlement 來源
- **THEN** 系統 SHALL 僅從該租戶自身的 `planId` 與 `featureOverrides` 解析
- **AND** 不存在同一租戶對應多筆 entitlement 設定的情況

### Requirement: Entitlement 解析公式
系統 SHALL 依公式 `entitlement(tenant) = (plan.features ∪ featureOverrides.grant) \ featureOverrides.revoke ∪ {core}` 解析每個租戶的可用 feature module 集合。grant MUST 加入超出方案的 feature；revoke MUST 移除方案內 feature；`core` MUST 在最後無條件併入（見「core feature 恆開」需求）。planId 為 null 的過渡租戶 SHALL 至少解析出 `core`。

#### Scenario: grant 加購方案外功能
- **GIVEN** 某租戶方案 `plan.features` 為 `[inbox, channels]`
- **AND** 其 `featureOverrides.grant` 為 `[automation]`
- **WHEN** 系統解析該租戶 entitlement
- **THEN** 結果 MUST 包含 `automation`

#### Scenario: revoke 關閉方案內功能
- **GIVEN** 某租戶方案 `plan.features` 為 `[inbox, channels, portal]`
- **AND** 其 `featureOverrides.revoke` 為 `[portal]`
- **WHEN** 系統解析該租戶 entitlement
- **THEN** 結果 MUST 不包含 `portal`
- **AND** 結果 MUST 仍包含 `inbox` 與 `channels`

#### Scenario: 同時 grant 與 revoke 的運算順序
- **GIVEN** 某租戶 `plan.features` 為 `[inbox, marketing]`
- **AND** 其 `featureOverrides` 為 `{ grant: [analytics], revoke: [marketing] }`
- **WHEN** 系統解析該租戶 entitlement
- **THEN** 結果 MUST 為 `{inbox, analytics, core}`（先聯集 grant 再扣除 revoke 再併 core）
- **AND** 結果 MUST 不包含 `marketing`

#### Scenario: planId 為 null 的過渡租戶
- **GIVEN** 某租戶 `planId` 為 null 且 `featureOverrides` 為空
- **WHEN** 系統解析該租戶 entitlement
- **THEN** 結果 MUST 至少包含 `core`
- **AND** 系統 MUST NOT 因 planId 為 null 而拋出錯誤

### Requirement: core feature 恆開不可關閉
系統 SHALL 保證 `core` feature module（涵蓋 agent.* / role.* / settings.* 等帳號、角色、設定權限點）永遠存在於每個租戶的 entitlement 中。即使 `featureOverrides.revoke` 明列 `core`，解析結果 MUST 仍包含 `core`；平台後台 UI SHALL 將 `core` 呈現為恆開、不可取消的鎖定狀態。

#### Scenario: core 永遠在 entitlement 內
- **GIVEN** 某租戶方案 `plan.features` 不含 `core`
- **WHEN** 系統解析該租戶 entitlement
- **THEN** 結果 MUST 包含 `core`

#### Scenario: revoke core 不生效
- **GIVEN** 某租戶 `featureOverrides.revoke` 為 `[core]`
- **WHEN** 系統解析該租戶 entitlement
- **THEN** 結果 MUST 仍包含 `core`
- **AND** revoke 對 `core` 以外的 feature 仍正常生效

#### Scenario: 平台後台 core 不可取消
- **GIVEN** 平台 superuser 在平台後台編輯某租戶的功能模組
- **WHEN** 畫面渲染 `core`（帳號/角色/設定）模組
- **THEN** `core` MUST 呈現為 🔒 恆開狀態
- **AND** 其勾選控制項 MUST 為 disabled 不可取消

### Requirement: Feature 與權限點對應之啟動驗證
系統 SHALL 於程式碼中以集中式 FEATURE registry 宣告每個 feature module 涵蓋哪些權限點 code，作為單一事實來源。啟動時系統 MUST 驗證：每個權限點 code 恰好歸屬於一個 feature 的 `perms`，且每個 feature 宣告的 code 都存在於權限 registry。任一驗證不符 SHALL 使啟動失敗。

#### Scenario: 每個權限點恰好歸屬一個 feature
- **GIVEN** 權限 registry 中的某權限點 code 未被任何 feature 的 `perms` 涵蓋
- **WHEN** 系統啟動並執行 registry 驗證
- **THEN** 啟動 MUST 失敗並指出該無歸屬的權限點 code

#### Scenario: 權限點不可歸屬多個 feature
- **GIVEN** 某權限點 code 同時被兩個不同 feature 的 `perms` 宣告
- **WHEN** 系統啟動並執行 registry 驗證
- **THEN** 啟動 MUST 失敗並指出該重複歸屬的權限點 code

#### Scenario: feature 宣告的 code 必須存在於權限 registry
- **GIVEN** 某 feature 的 `perms` 宣告了一個不存在於權限 registry 的 code
- **WHEN** 系統啟動並執行 registry 驗證
- **THEN** 啟動 MUST 失敗並指出該不存在的 code

#### Scenario: 對應完整時啟動成功
- **GIVEN** 每個權限點 code 恰好歸屬一個 feature 且所有 feature 宣告的 code 皆存在於權限 registry
- **WHEN** 系統啟動並執行 registry 驗證
- **THEN** 驗證 MUST 通過
- **AND** 系統 SHALL 正常完成啟動

### Requirement: 有效權限為角色權限與天花板之後端強制交集
系統 SHALL 將租戶 entitlement 展開為權限點天花板（`⋃ featureToPerms(f) for f in entitlement(tenant)`），並在後端權限判斷時以 `有效權限 = (RolePermission(role) ∪ implies 閉包) ∩ tenantPermCeiling` 計算。此交集 MUST 為後端強制：即使 RolePermission 含某權限點，但其所屬 feature 不在 entitlement 內，guard MUST 回 403，且 SHALL NOT 依賴前端隱藏。`GET /me/permissions` 回傳的 MUST 為交集後的有效權限。

#### Scenario: 角色有權限但方案未開則交集後被夾掉
- **GIVEN** 某 agent 的角色被授予 `marketing.broadcast`
- **AND** 其租戶 entitlement 不含 `marketing` feature
- **WHEN** 該 agent 呼叫需要 `marketing.broadcast` 的 API
- **THEN** guard MUST 回 403
- **AND** `GET /me/permissions` 回傳的有效權限 MUST 不含 `marketing.broadcast`

#### Scenario: 角色有權限且方案已開則放行
- **GIVEN** 某 agent 的角色被授予 `inbox.reply`
- **AND** 其租戶 entitlement 包含 `inbox` feature
- **WHEN** 該 agent 呼叫需要 `inbox.reply` 的 API
- **THEN** guard MUST 放行
- **AND** `GET /me/permissions` 回傳的有效權限 MUST 含 `inbox.reply`

#### Scenario: 繞過前端仍被後端天花板攔截
- **GIVEN** 某租戶 admin 在資料庫殘留一筆超出 entitlement 的 RolePermission
- **WHEN** 該租戶成員直接對受保護 API 發送請求（繞過前端）
- **THEN** 後端交集 MUST 將該權限夾掉
- **AND** 請求 MUST 回 403

### Requirement: 降級不刪資料且升回自動恢復
當租戶方案掉級或平台 revoke 某 feature 時，系統 MUST NOT 刪除任何 RolePermission；被移除的效果僅來自天花板交集縮小。當該 feature 日後重新被 grant 或方案升回時，原本的角色權限設定 SHALL 自動恢復生效，無需租戶重新設定。租戶權限設定頁 SHALL 將方案未含的 feature 呈現為 🔒 鎖定升級態。

#### Scenario: revoke 不刪除 RolePermission
- **GIVEN** 某租戶角色已被授予 `automation.rule.create`
- **WHEN** 平台方對該租戶 revoke `automation` feature
- **THEN** 該角色的 `automation.rule.create` RolePermission 記錄 MUST 仍存在於資料庫
- **AND** 該權限 MUST 因天花板交集而暫時不生效

#### Scenario: 升回後自動恢復生效
- **GIVEN** 某租戶先前被 revoke `automation` 但 RolePermission 保留
- **WHEN** 平台方重新 grant `automation` feature 給該租戶
- **THEN** 該角色的 `automation.rule.create` MUST 自動恢復生效
- **AND** 租戶 admin MUST NOT 需要重新勾選該權限

#### Scenario: 未含 feature 呈現為鎖定升級態
- **GIVEN** 某租戶 entitlement 不含 `marketing` feature
- **WHEN** 租戶 admin 開啟權限設定頁
- **THEN** `marketing` 群組 MUST 顯示 🔒 標題與升級提示
- **AND** 該群組內權限點的勾選控制項 MUST 為 disabled 不可勾

### Requirement: Entitlement 快取與失效鏈
系統 SHALL 以 `entitlement:tenant:{tenantId}` 快取租戶天花板權限集合，TTL MUST ≤ 10 分鐘。當平台方變更某租戶的 plan 或 featureOverrides 時，系統 MUST 於同一操作中主動失效該租戶的 `entitlement:tenant:{tenantId}`（若有快取交集結果 `eff:{roleId}:{tenantId}` 亦 MUST 一併失效）。既有 `perms:role:{roleId}` 快取 SHALL 不受 entitlement 變更影響。

#### Scenario: 變更 plan 主動失效租戶快取
- **GIVEN** 某租戶的 `entitlement:tenant:{tenantId}` 已被快取
- **WHEN** 平台方透過 `PUT /admin/tenants/:id/plan` 變更該租戶方案
- **THEN** 系統 MUST 於該操作中失效 `entitlement:tenant:{tenantId}`
- **AND** 該租戶下次請求 MUST 依新方案重新解析天花板

#### Scenario: 變更 override 主動失效租戶快取
- **GIVEN** 某租戶的 entitlement 快取存在
- **WHEN** 平台方透過 `PUT /admin/tenants/:id/overrides` 設定 grant/revoke
- **THEN** 系統 MUST 失效該租戶的 `entitlement:tenant:{tenantId}`
- **AND** 若存在 `eff:{roleId}:{tenantId}` 交集快取則 MUST 一併失效

#### Scenario: 角色權限快取不受 entitlement 變更影響
- **GIVEN** 某租戶變更了 plan 或 override
- **WHEN** 系統執行 entitlement 失效
- **THEN** `perms:role:{roleId}` 快取 MUST NOT 被此操作連帶清除

#### Scenario: 快取 TTL 上限
- **GIVEN** 系統寫入 `entitlement:tenant:{tenantId}` 快取
- **WHEN** 設定其存活時間
- **THEN** TTL MUST NOT 超過 10 分鐘
