## MODIFIED Requirements

### Requirement: 平台查詢待審的申請
`GET /api/v1/platform/plan-change-requests` SHALL 回傳所有租戶 `status` 是 `pending` 的申請，依建立時間由舊到新排列。每筆申請 SHALL 包含租戶名稱、租戶目前方案的名稱（沒有方案時是 null）、租戶本月（台灣時間）已核准的加購量 `monthlyTopupTokens`，以及租戶目前本月的有效 `monthlyTokens` `monthlyTokenLimit`（見 `plan-limits-core` 的「AI 月額度含當月加購量」，無上限時是 null）。只有平台管理員可以呼叫（見 `platform-auth`）。

#### Scenario: 只列出待審的申請
- **GIVEN** 甲租戶有一筆 `pending` 與一筆 `approved` 的申請，乙租戶有一筆 `rejected` 與一筆較晚的 `pending` 申請
- **WHEN** 平台管理員查詢待審的申請
- **THEN** 回應是甲租戶與乙租戶的 `pending` 申請，甲租戶的在前
- **AND** 每筆含租戶名稱與目前方案的名稱，乙租戶沒有方案，方案名稱是 null

#### Scenario: 待審的申請附本月加購量與本月上限
- **GIVEN** 甲租戶的方案 `monthlyTokens` 是 1,000,000，本月已核准加購 200,000，上個月核准過加購 300,000，有一筆待審的加購申請
- **AND** 乙租戶的方案 `monthlyTokens` 是無上限，有一筆待審的升級申請
- **WHEN** 平台管理員查詢待審的申請
- **THEN** 甲租戶的申請 `monthlyTopupTokens` 是 200,000，`monthlyTokenLimit` 是 1,200,000
- **AND** 乙租戶的申請 `monthlyTopupTokens` 是 0，`monthlyTokenLimit` 是 null

### Requirement: 核准加購申請
平台管理員核准 `type=token_topup` 的申請時，系統 SHALL 把申請改成 `approved`，並記錄 `reviewedBy`、`reviewedAt` 與 `reviewNote`。系統 MUST NOT 改寫租戶的 `limitOverrides`。這筆加購量只計入核准當月（台灣時間）的有效 `monthlyTokens`（見 `plan-limits-core` 的「AI 月額度含當月加購量」），之後的月額度檢查（見 `token-quota`）SHALL 立即使用新的上限。

系統 SHALL 以條件更新核准：只更新 `status` 仍是 `pending` 的申請。同一筆申請同時核准兩次時，只有一次成功，另一次 MUST 回應 400。

租戶的基礎 `monthlyTokens` 是無上限時，系統 MUST 回應 400 `TOPUP_UNLIMITED`，申請仍是 `pending`。核准後用量告警的變化見 `usage-quota-alerts`。

#### Scenario: 沒有覆寫時加在方案的額度上
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶沒有覆寫
- **WHEN** 平台管理員核准加購 500,000 的申請
- **THEN** 租戶本月的有效 `monthlyTokens` 是 1,500,000，租戶的 `limitOverrides` 仍是空的
- **AND** 申請的 `status` 是 `approved`，記錄了 `reviewedBy`、`reviewedAt` 與 `reviewNote`

#### Scenario: 已有覆寫時加在覆寫值上
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶的覆寫是 `monthlyTokens` 1,200,000 與 `maxAgents` 8
- **WHEN** 平台管理員核准加購 500,000 的申請
- **THEN** 租戶本月的有效 `monthlyTokens` 是 1,700,000
- **AND** 租戶的覆寫仍是 `monthlyTokens` 1,200,000 與 `maxAgents` 8

#### Scenario: 有效額度是無上限時不能加購
- **GIVEN** 租戶的基礎 `monthlyTokens` 是無上限
- **WHEN** 平台管理員核准加購申請
- **THEN** 系統回應 400 `TOPUP_UNLIMITED`，租戶的覆寫不變，申請仍是 `pending`

#### Scenario: 核准加購後立即恢復 AI
- **GIVEN** 租戶的有效 `monthlyTokens` 是 1,000,000，本月用量是 1,000,000，AI 呼叫被月額度擋下
- **WHEN** 平台管理員核准加購 500,000 的申請
- **THEN** 下一次月額度檢查放行 AI 呼叫

#### Scenario: 同月第二筆加購累加
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶本月已核准加購 200,000
- **WHEN** 平台管理員核准租戶的第二筆加購 300,000
- **THEN** 租戶本月的有效 `monthlyTokens` 是 1,500,000

#### Scenario: 同一筆申請同時核准兩次
- **GIVEN** 一筆 `pending` 的加購申請 500,000，方案的 `monthlyTokens` 是 1,000,000
- **WHEN** 兩個核准請求同時處理這筆申請
- **THEN** 一個成功，另一個回應 400
- **AND** 租戶本月的有效 `monthlyTokens` 是 1,500,000

## ADDED Requirements

### Requirement: 畫面說明加購僅限當月
租戶端 `/dashboard/plan` 選擇加購時 SHALL 顯示「加購的額度只在核准當月（台灣時間）有效，下個月回到方案額度」；申請記錄中已核准的加購 SHALL 顯示它有效的台灣月份（核准時間所在的月份）。

平台端 `/admin/plan-changes` SHALL 顯示「加購僅限核准當月（台灣時間），下個月回到方案額度」，並在每筆加購申請顯示該租戶本月已加購的量與目前本月的上限；上限是 null 時顯示「無上限」。兩個頁面 MUST NOT 使用 emoji 或勾號符號。

#### Scenario: 租戶選擇加購時看到當月限制
- **WHEN** 有 `settings.manage` 權限的成員在 `/dashboard/plan` 點選「加購 Token」
- **THEN** 頁面顯示「加購的額度只在核准當月（台灣時間）有效，下個月回到方案額度」

#### Scenario: 已核准的加購顯示有效月份
- **GIVEN** 一筆加購在 UTC 2026-11-30 16:30（台灣時間 2026-12-01 00:30）核准
- **WHEN** 成員開啟 `/dashboard/plan`
- **THEN** 這筆申請記錄顯示「限 2026-12 使用」

#### Scenario: 平台審核時看到本月加購量與上限
- **GIVEN** 待審的加購申請回傳 `monthlyTopupTokens` 200,000、`monthlyTokenLimit` 1,200,000；另一筆加購申請的 `monthlyTokenLimit` 是 null
- **WHEN** 平台管理員開啟 `/admin/plan-changes`
- **THEN** 頁面顯示「加購僅限核准當月（台灣時間），下個月回到方案額度」
- **AND** 第一筆顯示「本月已加購 200.0k token」與「本月上限 1.20M token」（平台後台的 token 格式），第二筆的本月上限顯示「無上限」
