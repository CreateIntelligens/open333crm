# permission-check Specification

## Purpose
定義權限檢查怎麼進行：權限檢查的 guard 與 403 的回應格式、有效權限集合的計算與快取、登入成員的權限端點，以及前端依權限顯示選單。方案的功能天花板見 `tenant-plan` 與 `granular-plan-entitlement`。

## Requirements

### Requirement: 權限檢查 guard

`requirePermission(code)` SHALL 在成員的有效權限集合不含 `code` 時回 HTTP 403，MUST NOT 執行路由處理。回應主體 SHALL 是：

```json
{ "success": false, "error": { "code": "FORBIDDEN", "message": "<給使用者看的說明>", "details": { "requiredPermission": "<code>" } } }
```

這個 guard SHALL 排在 `fastify.authenticate` 之後，因此未登入的請求回 HTTP 401，不回 403。

#### Scenario: 有權限碼的成員通過
- **WHEN** 成員的有效權限集合含 `channel.create`，呼叫以 `requirePermission('channel.create')` 檢查的路由
- **THEN** 請求進入路由處理

#### Scenario: 沒有權限碼的成員被拒
- **WHEN** 成員的有效權限集合不含 `channel.create`，呼叫以 `requirePermission('channel.create')` 檢查的路由
- **THEN** 系統回 HTTP 403，`error.code` 是 `FORBIDDEN`，`error.details.requiredPermission` 是 `channel.create`

#### Scenario: 未登入時回 401
- **WHEN** 請求沒有有效的登入憑證，呼叫以 `requirePermission()` 檢查的路由
- **THEN** 系統回 HTTP 401，不回 403

### Requirement: 任一權限碼即可通過

`requireAnyPermission(codes)` SHALL 在成員的有效權限集合含 `codes` 中任一個碼時放行。集合不含任何一個碼時，系統 SHALL 回 HTTP 403，`error.details.requiredAnyOf` 是 `codes`。

#### Scenario: 只有其中一個權限碼也通過
- **WHEN** 成員的有效權限集合含 `analytics.view.self`、不含 `analytics.view`，呼叫以 `requireAnyPermission(['analytics.view', 'analytics.view.self'])` 檢查的路由
- **THEN** 請求進入路由處理

#### Scenario: 一個權限碼都沒有時被拒
- **WHEN** 成員的有效權限集合不含 `analytics.view`，也不含 `analytics.view.self`，呼叫同一條路由
- **THEN** 系統回 HTTP 403，`error.details.requiredAnyOf` 是 `['analytics.view', 'analytics.view.self']`

### Requirement: 依請求內容追加權限碼

同一條路由依請求內容需要額外的權限碼時，路由 SHALL 以 `requirePermissionWhen(code, when)` 檢查。`when(request)` 成立時，guard SHALL 要求 `code`；不成立時 SHALL 放行。

#### Scenario: 建立工單時指派負責人需要 case.assign
- **WHEN** 成員有 `case.view` 與 `case.create`、沒有 `case.assign`，建立工單時指定負責人
- **THEN** 系統回 HTTP 403，不建立工單

#### Scenario: 建立工單時不指派就不需要 case.assign
- **WHEN** 成員有 `case.view` 與 `case.create`、沒有 `case.assign`，建立工單時不指定負責人
- **THEN** 系統不因權限回 HTTP 403

### Requirement: 有效權限集合

系統 SHALL 依下列順序計算成員的有效權限集合：

1. 取成員的角色明確授予的權限碼。
2. 加上這些權限碼的 `implies` 遞迴閉包（見 `permission-model` 的「隱含權限（implies）」）。
3. 與租戶方案的功能天花板取交集（見 `tenant-plan` 的「功能天花板交集」與 `granular-plan-entitlement`）。

成員沒有指派角色時，有效權限集合 SHALL 是空集合。權限檢查的 guard 與「登入成員的權限端點」SHALL 使用同一個有效權限集合。

#### Scenario: implies 的權限碼遞迴加入
- **WHEN** 角色明確授予 `case.assign`、沒有授予 `agent.view`，`case.assign` 的 `implies` 含 `agent.view`
- **THEN** 有效權限集合含 `case.assign` 與 `agent.view`

#### Scenario: 沒有角色的成員權限為空
- **WHEN** 成員沒有指派角色，呼叫以 `requirePermission()` 檢查的路由
- **THEN** 系統回 HTTP 403

### Requirement: 有效權限集合的快取

系統 SHALL 把每個角色的有效權限集合快取在 Redis，存活時間不超過 10 分鐘。角色的權限設定改變時，系統 SHALL 在修改的請求回應之前，清除這個角色的快取，包含套用方案天花板之後的快取。方案改變時的快取清除見 `granular-plan-entitlement`。

#### Scenario: 修改角色權限後立即生效
- **WHEN** 角色 R 的有效權限集合已經被快取，含 `tag.manage`；有 `role.manage` 的成員以 `PUT /api/v1/roles/:id/permissions` 從 R 移除 `tag.manage`
- **THEN** 修改的請求回應之後，R 的成員呼叫要求 `tag.manage` 的路由，系統回 HTTP 403

### Requirement: 登入成員的權限端點

`GET /api/v1/auth/me/permissions` SHALL 回傳登入成員的有效權限集合，格式為 `{ permissions: string[] }`。前端依這份清單決定顯示哪些選單與按鈕；後端的權限檢查仍然是唯一的強制點。

#### Scenario: 回傳含 implies 的權限碼
- **WHEN** 成員的角色明確授予 `case.view` 與 `case.assign`，呼叫 `GET /api/v1/auth/me/permissions`
- **THEN** `permissions` 含 `case.view`、`case.assign` 與 `agent.view`

#### Scenario: 不回傳方案天花板之外的權限碼
- **WHEN** 成員的角色明確授予 `analytics.view`，租戶的方案不含 `analytics` 功能，成員呼叫 `GET /api/v1/auth/me/permissions`
- **THEN** `permissions` 不含 `analytics.view`

### Requirement: 前端依權限顯示選單

前端 SHALL 在成員以密碼登入、以 Passkey 登入，以及恢復登入狀態之後，以 `GET /api/v1/auth/me/permissions` 載入成員的權限集合。載入失敗時，權限集合是空的。`usePermission(code)` 依這份集合回答成員是否有某個權限碼。

側邊選單 SHALL 隱藏成員沒有權限的項目。沒有連結的上層項目，在子項目全部隱藏時也隱藏。

這些控制只影響顯示。授權以後端的「權限檢查 guard」為準。

#### Scenario: 沒有權限時隱藏選單項目
- **WHEN** 成員沒有 `analytics.view`
- **THEN** 側邊選單不顯示「報表」

#### Scenario: 有權限時顯示選單項目
- **WHEN** 成員有 `analytics.view`
- **THEN** 側邊選單顯示「報表」

#### Scenario: 子項目全部隱藏時隱藏上層項目
- **WHEN** 成員有其他權限，但沒有 `settings.manage`
- **THEN** 側邊選單的「設定」之下不顯示「整合」，因為「整合」沒有連結，唯一的子項目「A2A」需要 `settings.manage`

#### Scenario: 以密碼登入後載入權限
- **WHEN** 成員以密碼登入，`GET /api/v1/auth/me/permissions` 回傳 `analytics.view`
- **THEN** `usePermission('analytics.view')` 是 `true`

#### Scenario: 以 Passkey 登入後載入權限
- **WHEN** 成員以 Passkey 登入，`GET /api/v1/auth/me/permissions` 回傳 `analytics.view`
- **THEN** `usePermission('analytics.view')` 是 `true`

#### Scenario: 權限載入失敗時權限集合是空的
- **WHEN** 恢復登入狀態成功，但 `GET /api/v1/auth/me/permissions` 失敗
- **THEN** `usePermission` 對任何權限碼都是 `false`

