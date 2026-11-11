# plan-change-request Specification

## Purpose
定義租戶申請換方案或加購 AI token、平台審核申請的流程：租戶送出與查詢申請，平台查詢待審的申請、核准與駁回，以及核准後對方案與月額度的影響。方案的功能天花板見 `tenant-plan`，有效上限的解析見 `plan-limits-core`，試用租戶升級時的變化見 `trial-lifecycle`。

## Requirements

### Requirement: 租戶送出方案異動申請
有 `settings.manage` 權限的成員 SHALL 能以 `POST /api/v1/plan-change` 送出申請。`type` 是 `upgrade`（換方案，`targetPlanSlug` 是目標方案）或 `token_topup`（加購 token，`topupTokens` 是加購量）。新的申請屬於成員的租戶，`status` 是 `pending`。

下列情況系統 MUST 拒絕，而且 MUST NOT 建立申請：

- 租戶已經有 `pending` 的申請：409。
- `upgrade` 沒有 `targetPlanSlug`：400。目標方案不存在：404。目標方案是試用方案時的規則見 `trial-lifecycle`。
- `token_topup` 的 `topupTokens` 不是正整數：400。
- `token_topup` 而租戶的 AI 月額度基礎上限（覆寫值優先，否則方案的 `limits.monthlyTokens`）是無上限：400，`code` 是 `TOPUP_UNLIMITED`。

#### Scenario: 送出升級申請
- **GIVEN** 租戶沒有 `pending` 的申請
- **WHEN** 有 `settings.manage` 權限的成員送出 `type=upgrade`、`targetPlanSlug=standard`
- **THEN** 系統建立一筆申請，`status` 是 `pending`，`tenantId` 是成員的租戶

#### Scenario: 已有待審申請時不能再送出
- **GIVEN** 租戶已經有一筆 `pending` 的申請
- **WHEN** 成員再送出一筆申請
- **THEN** 系統回應 409，租戶的申請數不變

#### Scenario: 升級申請沒有目標方案
- **WHEN** 成員送出 `type=upgrade`，沒有 `targetPlanSlug`
- **THEN** 系統回應 400，不建立申請

#### Scenario: 目標方案不存在
- **WHEN** 成員送出 `type=upgrade`，`targetPlanSlug` 不是任何方案的 slug
- **THEN** 系統回應 404，不建立申請

#### Scenario: 加購量不是正整數
- **WHEN** 成員送出 `type=token_topup`，`topupTokens` 是 0、-1 或 1.5
- **THEN** 系統回應 400，不建立申請

#### Scenario: AI 月額度無上限時不能申請加購
- **GIVEN** 租戶的方案 `limits.monthlyTokens` 是 null，而且沒有覆寫 `monthlyTokens`
- **WHEN** 成員送出 `type=token_topup`、`topupTokens=200000`
- **THEN** 系統回應 400，`code` 是 `TOPUP_UNLIMITED`，不建立申請

#### Scenario: 有月額度時可以申請加購
- **GIVEN** 租戶的方案 `limits.monthlyTokens` 是 1000000
- **WHEN** 成員送出 `type=token_topup`、`topupTokens=200000`
- **THEN** 系統建立一筆 `pending` 的加購申請

#### Scenario: 沒有 settings.manage 權限
- **WHEN** 沒有 `settings.manage` 權限的成員送出申請，或查詢申請
- **THEN** 系統回應 403，`details.requiredPermission` 是 `settings.manage`

### Requirement: 租戶查詢自己的申請
`GET /api/v1/plan-change` SHALL 只回傳成員所屬租戶的申請，依建立時間由新到舊排列，最多 50 筆。呼叫這個 API 也需要 `settings.manage` 權限。

#### Scenario: 只回傳自己租戶的申請
- **GIVEN** 租戶 A 有 2 筆申請，租戶 B 有 1 筆申請
- **WHEN** 租戶 A 的成員查詢申請
- **THEN** 回應只有租戶 A 的 2 筆申請，較新的一筆在前

#### Scenario: 最多回傳 50 筆
- **GIVEN** 租戶有 51 筆申請
- **WHEN** 成員查詢申請
- **THEN** 回應是最新的 50 筆，不含最早的一筆

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

### Requirement: 核准升級申請
平台管理員以 `PATCH /api/v1/platform/plan-change-requests/:id/approve` 核准 `type=upgrade` 的申請時，系統 SHALL 把租戶的方案改成目標方案，新方案的功能天花板 SHALL 立即生效。申請的 `status` SHALL 改成 `approved`，並記錄審核的平台帳號（`reviewedBy`）、審核時間（`reviewedAt`）與審核備註（`reviewNote`）。

試用租戶核准後的變化見 `trial-lifecycle` 的「轉為付費方案時脫離試用」。目標方案已經不存在時，系統 MUST 回應 404，租戶與申請都不變。

#### Scenario: 核准升級後立即生效
- **GIVEN** 租戶的方案是 light，不含 `marketing`。成員的角色有 `marketing.view`，系統已經讀過租戶的方案
- **AND** 租戶有一筆 `pending` 的申請，目標方案是含 `marketing` 的 standard
- **WHEN** 平台管理員核准申請，備註是「已收款」
- **THEN** 租戶的方案是 standard，成員的有效權限立即含 `marketing.view`
- **AND** 申請的 `status` 是 `approved`，`reviewedBy` 是平台管理員，`reviewedAt` 是核准的時間，`reviewNote` 是「已收款」

#### Scenario: 目標方案已不存在
- **GIVEN** 一筆 `pending` 的升級申請，目標方案在申請之後被刪除
- **WHEN** 平台管理員核准申請
- **THEN** 系統回應 404，租戶的方案不變，申請仍是 `pending`

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

### Requirement: 駁回申請
平台管理員以 `PATCH /api/v1/platform/plan-change-requests/:id/reject` 駁回申請時，系統 SHALL 把申請的 `status` 改成 `rejected`，並記錄 `reviewedBy`、`reviewedAt` 與 `reviewNote`。系統 MUST NOT 改變租戶的方案與覆寫值。

#### Scenario: 駁回不改變租戶
- **GIVEN** 租戶的方案是 light，`monthlyTokens` 的覆寫是 1,200,000，有一筆 `pending` 的升級申請
- **WHEN** 平台管理員駁回申請，備註是「尚未收款」
- **THEN** 申請的 `status` 是 `rejected`，記錄了 `reviewedBy`、`reviewedAt`，`reviewNote` 是「尚未收款」
- **AND** 租戶的方案仍是 light，覆寫仍是 1,200,000

### Requirement: 只處理待審的申請
核准與駁回都 SHALL 只處理 `status` 是 `pending` 的申請。申請已經是 `approved` 或 `rejected` 時，系統 MUST 回應 400，MUST NOT 改變申請與租戶。申請不存在時，系統 MUST 回應 404。

#### Scenario: 已處理的申請不能再核准
- **GIVEN** 一筆已駁回的升級申請，與一筆已核准的加購申請
- **WHEN** 平台管理員核准這兩筆申請
- **THEN** 系統都回應 400
- **AND** 租戶的方案與覆寫不變，兩筆申請的 `status` 與 `reviewedAt` 不變

#### Scenario: 已處理的申請不能駁回
- **GIVEN** 一筆已核准的申請，`reviewNote` 是「已收款」
- **WHEN** 平台管理員駁回這筆申請
- **THEN** 系統回應 400，申請仍是 `approved`，`reviewNote` 仍是「已收款」

#### Scenario: 申請不存在
- **WHEN** 平台管理員核准或駁回一個不存在的申請 id
- **THEN** 系統回應 404

### Requirement: 新申請寄信通知平台帳號
租戶成功送出方案異動申請後，系統 SHALL 寄一封信給每個 `isActive=true` 的平台帳號，MUST NOT 寄給停用的平台帳號。信中 SHALL 有租戶名稱、類型（「升級方案」或「加購 Token」）、內容（升級寫目標方案的名稱，加購寫加購量）、租戶備註（沒有備註時寫「未填寫」），以及 `${WEB_BASE_URL}/admin/plan-changes` 的連結。

申請被拒絕（409、400、404）時，系統 MUST NOT 寄信。

#### Scenario: 送出加購申請後寄信給啟用中的平台帳號
- **GIVEN** 平台有兩個啟用中的帳號與一個停用的帳號，租戶名稱是「好物商行」
- **WHEN** 租戶成員送出 `type=token_topup`、`topupTokens=500000`、`note=AI 快用完了`
- **THEN** 系統寄出兩封信，收件人是兩個啟用中的帳號，沒有寄給停用的帳號
- **AND** 每封信含「好物商行」、「加購 Token」、「500,000」、「AI 快用完了」與 `${WEB_BASE_URL}/admin/plan-changes`

#### Scenario: 升級申請的信寫出目標方案名稱
- **GIVEN** 方案 `standard` 的名稱是「標準版」
- **WHEN** 租戶成員送出 `type=upgrade`、`targetPlanSlug=standard`，沒有備註
- **THEN** 信中含「升級方案」、「標準版」與「未填寫」

#### Scenario: 申請被拒絕時不寄信
- **GIVEN** 租戶已經有一筆 `pending` 的申請
- **WHEN** 租戶成員再送出一筆申請
- **THEN** 系統回應 409，沒有寄出任何信

### Requirement: 通知信寄送失敗不影響申請且留下稽核紀錄
寄送通知信 MUST NOT 延遲或改變申請的回應：任一封信寄送失敗時，申請仍 SHALL 成功建立並回應 200，其他收件人的信照常寄出。

每次寄送通知後，系統 SHALL 寫一筆平台稽核紀錄：`action` 是 `plan_change.notify_platform`，`targetType` 是 `plan_change_request`，`targetId` 是申請的 id，`platformUserId` 是 null（系統動作）。`payload` SHALL 含收件人數、寄出數，以及每個寄送失敗的收件人 email 與失敗原因。沒有啟用中的平台帳號時，系統也 SHALL 寫這筆紀錄，收件人數是 0。

#### Scenario: 一封信寄送失敗時申請仍成功
- **GIVEN** 平台有兩個啟用中的帳號，寄給其中 `ops@example.com` 的信會失敗，原因是「SMTP timeout」
- **WHEN** 租戶成員送出加購申請
- **THEN** 系統回應 200，租戶有一筆 `pending` 的申請
- **AND** 另一個帳號收到通知信
- **AND** 平台稽核有一筆 `plan_change.notify_platform`，`targetId` 是這筆申請，`payload` 的收件人數是 2、寄出數是 1，失敗清單是 `ops@example.com` 與「SMTP timeout」

#### Scenario: 沒有啟用中的平台帳號
- **GIVEN** 平台所有帳號都已停用
- **WHEN** 租戶成員送出申請
- **THEN** 系統回應 200，沒有寄出任何信
- **AND** 平台稽核有一筆 `plan_change.notify_platform`，`payload` 的收件人數是 0

### Requirement: 平台側欄顯示待審申請數量
平台後台側欄的「升級申請」SHALL 顯示 `GET /api/v1/platform/plan-change-requests` 回傳的待審申請數量。沒有待審申請時，系統 MUST NOT 顯示數量。平台管理員在升級申請頁核准或駁回申請後，側欄的數量 SHALL 更新。

#### Scenario: 有待審申請時顯示數量
- **GIVEN** 有 2 筆 `pending` 的申請
- **WHEN** 平台管理員打開平台後台
- **THEN** 側欄的「升級申請」旁顯示 2

#### Scenario: 沒有待審申請時不顯示數量
- **GIVEN** 沒有 `pending` 的申請
- **WHEN** 平台管理員打開平台後台
- **THEN** 側欄的「升級申請」旁沒有數量

#### Scenario: 審核後數量更新
- **GIVEN** 有 2 筆 `pending` 的申請，側欄顯示 2
- **WHEN** 平台管理員在升級申請頁核准其中一筆
- **THEN** 側欄的「升級申請」旁顯示 1

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

### Requirement: 租戶查詢能否申請加購
有 `settings.manage` 權限的成員 SHALL 能以 `GET /api/v1/plan-change/topup-eligibility` 查詢自己的租戶能不能申請加購。回應的 `allowed` 在 AI 月額度基礎上限是無上限時為 `false`，否則為 `true`；`monthlyTokenLimit` 是本月上限（含本月已核准的加購），無上限時是 null。`/dashboard/plan` SHALL 在 `allowed` 是 `false` 時停用「加購 Token」選項，並說明目前方案的 AI 額度已無上限，不需要加購。

#### Scenario: 無上限的租戶查詢
- **GIVEN** 租戶的方案 `limits.monthlyTokens` 是 null
- **WHEN** 成員查詢 `GET /api/v1/plan-change/topup-eligibility`
- **THEN** 回應 `allowed` 是 `false`，`monthlyTokenLimit` 是 null

#### Scenario: 有月額度的租戶查詢
- **GIVEN** 租戶的方案 `limits.monthlyTokens` 是 1000000，本月已核准加購 200000
- **WHEN** 成員查詢 `GET /api/v1/plan-change/topup-eligibility`
- **THEN** 回應 `allowed` 是 `true`，`monthlyTokenLimit` 是 1200000

#### Scenario: 方案頁停用加購選項
- **GIVEN** `topup-eligibility` 回應 `allowed` 是 `false`
- **WHEN** 成員打開 `/dashboard/plan`
- **THEN** 「加購 Token」選項停用，畫面顯示「目前方案的 AI 額度已無上限，不需要加購」
