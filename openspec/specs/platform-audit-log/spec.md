# platform-audit-log Specification

## Purpose
平台人員在平台後台查詢平台稽核紀錄（`platform_audit_logs`）：依租戶列出與該租戶有關的平台操作，並以中文動作名稱、操作者與可讀的對象名稱顯示，對象可連到對應頁面。寫入稽核的規則見各功能的規格。

## Requirements

### Requirement: 平台管理員可依租戶查詢平台稽核紀錄
已登入的平台管理員 SHALL 能以 `GET /api/v1/platform/tenants/:id/audit-logs` 查詢與該租戶有關的 `PlatformAuditLog`。範圍 SHALL 包含：對象是該租戶的紀錄（`targetType='tenant'`、`targetId` = 租戶 id）、對象是該租戶成員的紀錄（`targetType='agent'`、`payload.tenantId` = 租戶 id）、對象是該租戶方案申請的紀錄（`targetType='plan_change_request'`）。結果 SHALL 依 `createdAt` 新到舊排序。

#### Scenario: 回傳租戶、成員與方案申請的紀錄，不含其他租戶
- **WHEN** 平台管理員查詢租戶 A 的稽核紀錄，資料庫有租戶 A 被停用、A 的成員被改 Email、A 的升級申請被核准，以及租戶 B 被停用的紀錄
- **THEN** 系統回傳前三筆，依時間新到舊排序，不含租戶 B 的紀錄

#### Scenario: 租戶不存在
- **WHEN** 平台管理員查詢不存在的租戶 id 的稽核紀錄
- **THEN** 系統回傳 404 `NOT_FOUND`

#### Scenario: 未登入平台後台
- **WHEN** 沒有平台登入憑證的請求呼叫 `GET /api/v1/platform/tenants/:id/audit-logs`
- **THEN** 系統拒絕請求，不回傳任何稽核紀錄

### Requirement: 依租戶查詢稽核紀錄有筆數上限
`GET /api/v1/platform/tenants/:id/audit-logs` SHALL 接受 `limit` 查詢參數（1 到 200，預設 100），回傳 `{ items, hasMore }`：`items` 為最新的至多 `limit` 筆紀錄，`hasMore` 表示是否還有更舊的紀錄。`limit` 超出範圍或不是整數時 SHALL 回傳 400。

#### Scenario: 紀錄超過上限
- **WHEN** 租戶有 3 筆紀錄，平台管理員以 `limit=2` 查詢
- **THEN** 系統回傳最新的 2 筆，`hasMore` 為 `true`

#### Scenario: 紀錄未超過上限
- **WHEN** 租戶有 2 筆紀錄，平台管理員以 `limit=2` 查詢
- **THEN** 系統回傳 2 筆，`hasMore` 為 `false`

#### Scenario: limit 超出範圍
- **WHEN** 平台管理員以 `limit=500` 查詢
- **THEN** 系統回傳 400，不查詢紀錄

### Requirement: 稽核紀錄附上操作者與對象名稱
平台稽核紀錄的查詢回應 SHALL 為每筆紀錄附上 `actor`（操作者平台帳號的 `id`、`name`、`email`；系統排程寫入的紀錄為 `null`）、`targetLabel`（對象的可讀名稱）與 `targetTenantId`（對象所屬的租戶 id，無法判定時為 `null`）。`targetLabel` SHALL 依 `targetType` 取得：`tenant` 為租戶名稱、`agent` 為成員 Email、`plan` 為方案名稱、`platform_user` 為平台帳號名稱、`plan_change_request` 為申請租戶的名稱、`trial_signup` 為申請 Email、`setting` 與 `queue_job` 為代碼本身。對象已不存在時，`agent` SHALL 退回 `payload.email`，其他類型 SHALL 為 `null`。

#### Scenario: 解析各類型對象的名稱
- **WHEN** 查詢結果含對象為租戶、成員、方案、方案申請的紀錄
- **THEN** 各筆的 `targetLabel` 分別為租戶名稱、成員 Email、方案名稱、申請租戶的名稱；成員與方案申請紀錄的 `targetTenantId` 為所屬租戶 id

#### Scenario: 成員已被刪除
- **WHEN** 一筆 `tenant.agent.email.update` 紀錄的成員已被刪除，payload 帶有 `email`
- **THEN** 該筆的 `targetLabel` 為 payload 的 `email`

#### Scenario: 方案已不存在
- **WHEN** 一筆 `plan.update` 紀錄的方案已不存在
- **THEN** 該筆的 `targetLabel` 為 `null`

#### Scenario: 系統排程寫入的紀錄
- **WHEN** 一筆紀錄的 `platformUserId` 為 `null`（例如 `tenant.trial.expire`）
- **THEN** 該筆的 `actor` 為 `null`

### Requirement: 租戶詳細頁顯示操作紀錄
平台後台的租戶詳細頁（`/admin/tenants/:id`）SHALL 顯示「操作紀錄」區塊，列出該租戶的平台稽核紀錄，欄位為操作（中文名稱）、對象、操作者、時間。操作者 SHALL 顯示平台帳號名稱；`actor` 為 `null` 時 SHALL 顯示「系統排程」。`hasMore` 為 `true` 時 SHALL 告知只顯示最近的筆數。

#### Scenario: 顯示租戶操作紀錄
- **WHEN** 平台管理員開啟租戶詳細頁，API 回傳一筆由「Ops」執行的 `tenant.disable` 紀錄
- **THEN** 操作紀錄區塊顯示「停用租戶」、操作者「Ops」

#### Scenario: 系統排程紀錄與更多紀錄提示
- **WHEN** API 回傳一筆 `actor` 為 `null` 的 `tenant.trial.expire` 紀錄，且 `hasMore` 為 `true`
- **THEN** 該筆操作者顯示「系統排程」，區塊顯示只列出最近筆數的提示

### Requirement: 平台稽核動作以中文名稱顯示
平台後台顯示稽核紀錄的頁面 SHALL 共用同一份動作中文名稱表，涵蓋 API 與排程寫入 `PlatformAuditLog` 的所有動作。表中沒有的動作 SHALL 顯示原始代碼。

#### Scenario: 已知動作顯示中文
- **WHEN** 頁面顯示下列任一動作的紀錄：`platform_user.provision`、`platform_user.update`、`platform_user.enable`、`platform_user.disable`、`platform_user.resend_welcome`、`platform_user.change_password`、`tenant.provision`、`tenant.update`、`tenant.enable`、`tenant.disable`、`tenant.contract.update`、`tenant.agent.email.update`、`tenant.agent.resend_welcome`、`tenant.ai_privacy.update`、`tenant.trial.extend`、`tenant.trial.convert`、`tenant.trial.restore`、`tenant.trial.expire`、`tenant.trial.purge`、`trial.signup.fail`、`plan.update`、`plan_change.approve`、`plan_change.reject`、`plan_change.notify_platform`、`setting.update`、`queue.job.retry`
- **THEN** 操作欄顯示中文名稱，不顯示代碼

#### Scenario: 未知動作顯示代碼
- **WHEN** 頁面顯示 `foo.bar` 的紀錄
- **THEN** 操作欄顯示 `foo.bar`

### Requirement: 稽核紀錄的對象顯示可讀名稱並連到對應頁面
平台後台顯示稽核紀錄時，「對象」欄 SHALL 顯示 `targetLabel`，並 SHALL 依類型連到對應頁面：`tenant`、`agent`、`plan_change_request` 連到 `targetTenantId` 的租戶詳細頁，`plan` 連到方案頁，`platform_user` 連到該平台帳號詳細頁，`trial_signup` 連到試用管理頁。`targetLabel` 為 `null` 時 SHALL 退回顯示「類型 / 代碼前 8 碼」。

#### Scenario: 對象連到租戶頁
- **WHEN** 一筆紀錄的 `targetType` 為 `agent`、`targetLabel` 為 `a@example.com`、`targetTenantId` 為租戶 T
- **THEN** 對象欄顯示 `a@example.com`，連到 `/admin/tenants/T`

#### Scenario: 查不到名稱時退回代碼
- **WHEN** 一筆紀錄的 `targetType` 為 `plan`、`targetLabel` 為 `null`
- **THEN** 對象欄顯示 `plan / ` 加 `targetId` 前 8 碼
