## ADDED Requirements

### Requirement: 申請單建立與租戶發起
系統 SHALL 允許租戶 admin 透過 `POST /me/plan/requests` 建立 PlanChangeRequest 申請單，`type` MUST 為 `upgrade` 或 `token_topup`，建立後 `status` MUST 為 `pending`，並 MUST 記錄 `tenantId` 與 `requestedBy`（發起的租戶 admin agentId）。當 `type=upgrade` 時 `requestedPlanId` MUST 提供；當 `type=token_topup` 時 `topupTokens` MUST 提供且為正整數，且 `topupMode` MUST 為 `one_time_month`（本月一次性加購、下月歸零）或 `raise_monthly`（永久調高月額度）。

#### Scenario: 租戶 admin 建立升級申請
- **GIVEN** 一個 status=active 的租戶與其 admin agent
- **WHEN** 該 admin 呼叫 `POST /me/plan/requests`，帶 `type=upgrade` 與有效的 `requestedPlanId`
- **THEN** 系統建立一筆 PlanChangeRequest，`status=pending`、`tenantId` 為該租戶、`requestedBy` 為該 admin
- **AND** 平台方收到「有新申請」通知

#### Scenario: 租戶 admin 建立加購 token 申請（本月一次性）
- **GIVEN** 一個 status=active 的租戶與其 admin agent
- **WHEN** 該 admin 呼叫 `POST /me/plan/requests`，帶 `type=token_topup`、`topupTokens=500000` 與 `topupMode=one_time_month`
- **THEN** 系統建立一筆 PlanChangeRequest，`status=pending`、`type=token_topup`、`topupTokens=500000`、`topupMode=one_time_month`

#### Scenario: token_topup 缺 topupMode 被拒
- **WHEN** admin 呼叫 `POST /me/plan/requests`，帶 `type=token_topup`、`topupTokens=500000` 但未提供 `topupMode`
- **THEN** 系統回傳 400 驗證錯誤
- **AND** 不建立任何 PlanChangeRequest

#### Scenario: upgrade 缺 requestedPlanId 被拒
- **WHEN** admin 呼叫 `POST /me/plan/requests`，帶 `type=upgrade` 但未提供 `requestedPlanId`
- **THEN** 系統回傳 400 驗證錯誤
- **AND** 不建立任何 PlanChangeRequest

#### Scenario: token_topup 帶非正整數被拒
- **WHEN** admin 呼叫 `POST /me/plan/requests`，帶 `type=token_topup` 與 `topupTokens=0` 或負數
- **THEN** 系統回傳 400 驗證錯誤
- **AND** 不建立任何 PlanChangeRequest

### Requirement: 租戶只能檢視自己的申請
系統 SHALL 於 `GET /me/plan/requests` 僅回傳與當前登入租戶 `tenantId` 相符的 PlanChangeRequest，且 MUST NOT 洩漏其他租戶的申請單；跨租戶存取單筆申請 MUST 被拒絕。

#### Scenario: 租戶查詢自己的申請清單
- **GIVEN** 租戶 A 有 2 筆申請、租戶 B 有 1 筆申請
- **WHEN** 租戶 A 的 admin 呼叫 `GET /me/plan/requests`
- **THEN** 回傳結果僅含租戶 A 的 2 筆申請
- **AND** 不包含租戶 B 的任何申請

#### Scenario: 租戶無法存取他人申請
- **GIVEN** 一筆屬於租戶 B 的 PlanChangeRequest
- **WHEN** 租戶 A 的 admin 嘗試以該申請 id 查詢
- **THEN** 系統回傳 404 或 403
- **AND** 不回傳該申請的任何內容

### Requirement: 平台審核申請清單與權限
系統 SHALL 僅允許平台 superuser 透過 `GET /admin/plan-requests` 檢視所有租戶的申請，並 MUST 支援以 `status` 過濾（例如 `status=pending`）。非 superuser 的請求 MUST 被拒絕。

#### Scenario: superuser 取得待審清單
- **GIVEN** 系統中有多筆 status=pending 與 status=approved 的申請
- **WHEN** superuser 呼叫 `GET /admin/plan-requests?status=pending`
- **THEN** 回傳結果僅含所有租戶中 status=pending 的申請

#### Scenario: 一般租戶 admin 被拒存取平台清單
- **WHEN** 一般租戶 admin（非 superuser）呼叫 `GET /admin/plan-requests`
- **THEN** 系統回傳 403
- **AND** 不回傳任何申請清單

### Requirement: 核准 upgrade 改方案並觸發 entitlement 失效鏈
當 superuser 透過 `POST /admin/plan-requests/:id/approve` 核准一筆 `type=upgrade` 且 `status=pending` 的申請時，系統 MUST 將該租戶 `Tenant.planId` 更新為 `requestedPlanId`、將申請 `status` 改為 `approved` 並記錄 `reviewedBy` 與 `reviewedAt`，且 MUST 使該租戶 entitlement 快取失效以即時解鎖對應功能，並 MUST 通知租戶「申請已核准」。

#### Scenario: 核准升級即時解鎖功能
- **GIVEN** 一筆 type=upgrade、status=pending、requestedPlanId 指向較高方案的申請
- **WHEN** superuser 呼叫 `POST /admin/plan-requests/:id/approve`
- **THEN** 該租戶 `Tenant.planId` 被更新為 requestedPlanId
- **AND** 申請 status 變為 approved 且記錄 reviewedBy 與 reviewedAt
- **AND** 該租戶 entitlement 快取被失效，新方案功能即時可用
- **AND** 租戶收到「申請已核准」通知

#### Scenario: 核准非 pending 申請被拒
- **GIVEN** 一筆 status 已為 approved 的 upgrade 申請
- **WHEN** superuser 再次呼叫 `POST /admin/plan-requests/:id/approve`
- **THEN** 系統回傳錯誤且不重複改動 planId
- **AND** entitlement 快取不再被重複失效

#### Scenario: 核准 upgrade 寫入平台稽核
- **WHEN** superuser 核准一筆 upgrade 申請
- **THEN** 系統寫入一筆 PlatformAuditLog，記錄操作者、申請 id、租戶 id 與變更前後的 planId

### Requirement: 核准 token_topup 提高額度並校準 Redis 解除硬擋
當 superuser 核准一筆 `type=token_topup` 且 `status=pending` 的申請時，系統 MUST 依 `topupMode` 生效：`raise_monthly` MUST 永久提高 `Tenant.tokenQuotaMonthly`（每月皆適用）；`one_time_month` MUST 只提高當月有效額度（下月起回歸方案/月額度預設，不動 `tokenQuotaMonthly`）。兩種模式皆 MUST 將申請 `status` 改為 `approved`、校準 Redis 即時月度計數器的額度上限；若該租戶原本因達額度而被硬擋，系統 MUST 立即解除硬擋使 AI 恢復，並 MUST 通知租戶。

#### Scenario: 加購後即時恢復被擋的 AI
- **GIVEN** 一個租戶已達月額度且 AI 呼叫正被硬擋
- **AND** 一筆 type=token_topup、status=pending 的申請
- **WHEN** superuser 呼叫 `POST /admin/plan-requests/:id/approve`
- **THEN** 該租戶 tokenQuotaMonthly 依 topupTokens 提高
- **AND** Redis 月度計數器的額度上限被校準為新額度
- **AND** 因新額度大於已用量，硬擋立即解除、後續 AI 呼叫正常執行
- **AND** 租戶收到核准通知

#### Scenario: 加購後仍未超額則正常放行
- **GIVEN** 一個未達額度的租戶
- **WHEN** superuser 核准其 token_topup 申請
- **THEN** 當月有效額度提高且 Redis 上限校準
- **AND** AI 呼叫維持正常放行（本就未被擋）

#### Scenario: 本月一次性加購下月歸零
- **GIVEN** 一筆 `topupMode=one_time_month` 的加購已核准生效於本月
- **WHEN** 進入下一個自然月、計數器重置
- **THEN** 該租戶的有效額度 MUST 回歸其方案/`tokenQuotaMonthly` 預設，不含本次一次性加購量

#### Scenario: 永久調高月額度持續適用
- **GIVEN** 一筆 `topupMode=raise_monthly` 的加購已核准並提高 `tokenQuotaMonthly`
- **WHEN** 進入下一個自然月、計數器重置
- **THEN** 該租戶的有效額度 MUST 仍為提高後的 `tokenQuotaMonthly`

#### Scenario: 核准 topup 寫入平台稽核
- **WHEN** superuser 核准一筆 token_topup 申請
- **THEN** 系統寫入一筆 PlatformAuditLog，記錄操作者、申請 id、租戶 id 與變更前後的 tokenQuotaMonthly

### Requirement: 平台駁回申請
當 superuser 透過 `POST /admin/plan-requests/:id/reject` 駁回一筆 `status=pending` 的申請時，系統 MUST 將 `status` 改為 `rejected`、記錄 `reviewedBy`、`reviewedAt` 與 `reviewNote`，且 MUST NOT 變更該租戶的 `planId` 或 `tokenQuotaMonthly`，並 MUST 通知租戶，同時 MUST 寫入 PlatformAuditLog。

#### Scenario: 駁回申請不改動租戶額度與方案
- **GIVEN** 一筆 status=pending 的申請與該租戶當前的 planId 與 tokenQuotaMonthly
- **WHEN** superuser 呼叫 `POST /admin/plan-requests/:id/reject` 並填入 reviewNote
- **THEN** 申請 status 變為 rejected 並記錄 reviewedBy、reviewedAt、reviewNote
- **AND** 該租戶 planId 與 tokenQuotaMonthly 維持不變
- **AND** 租戶收到「申請已駁回」通知
- **AND** 系統寫入一筆 PlatformAuditLog

#### Scenario: 駁回非 pending 申請被拒
- **GIVEN** 一筆 status 已為 rejected 或 approved 的申請
- **WHEN** superuser 再次呼叫 `POST /admin/plan-requests/:id/reject`
- **THEN** 系統回傳錯誤且不改動申請狀態
