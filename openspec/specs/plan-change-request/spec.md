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
`GET /api/v1/platform/plan-change-requests` SHALL 回傳所有租戶 `status` 是 `pending` 的申請，依建立時間由舊到新排列。每筆申請 SHALL 包含租戶名稱，以及租戶目前方案的名稱（沒有方案時是 null）。只有平台管理員可以呼叫（見 `platform-auth`）。

#### Scenario: 只列出待審的申請
- **GIVEN** 甲租戶有一筆 `pending` 與一筆 `approved` 的申請，乙租戶有一筆 `rejected` 與一筆較晚的 `pending` 申請
- **WHEN** 平台管理員查詢待審的申請
- **THEN** 回應是甲租戶與乙租戶的 `pending` 申請，甲租戶的在前
- **AND** 每筆含租戶名稱與目前方案的名稱，乙租戶沒有方案，方案名稱是 null

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
平台管理員核准 `type=token_topup` 的申請時，系統 SHALL 把租戶的 `limitOverrides.monthlyTokens` 設為「目前有效的 `monthlyTokens`（見 `plan-limits-core`）加上 `topupTokens`」，其他覆寫值不變。之後的月額度檢查（見 `token-quota`）SHALL 立即使用新的上限。申請 SHALL 改成 `approved`，並記錄 `reviewedBy`、`reviewedAt` 與 `reviewNote`。

目前有效的 `monthlyTokens` 是無上限時，系統 MUST 回應 400 `TOPUP_UNLIMITED`，租戶與申請都不變。核准後用量告警的變化見 `usage-quota-alerts`。

#### Scenario: 沒有覆寫時加在方案的額度上
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶沒有覆寫
- **WHEN** 平台管理員核准加購 500,000 的申請
- **THEN** 租戶的 `limitOverrides.monthlyTokens` 是 1,500,000
- **AND** 申請的 `status` 是 `approved`，記錄了 `reviewedBy`、`reviewedAt` 與 `reviewNote`

#### Scenario: 已有覆寫時加在覆寫值上
- **GIVEN** 方案的 `monthlyTokens` 是 1,000,000，租戶的覆寫是 `monthlyTokens` 1,200,000 與 `maxAgents` 8
- **WHEN** 平台管理員核准加購 500,000 的申請
- **THEN** 租戶的覆寫是 `monthlyTokens` 1,700,000 與 `maxAgents` 8

#### Scenario: 有效額度是無上限時不能加購
- **GIVEN** 租戶的有效 `monthlyTokens` 是無上限
- **WHEN** 平台管理員核准加購申請
- **THEN** 系統回應 400 `TOPUP_UNLIMITED`，租戶的覆寫不變，申請仍是 `pending`

#### Scenario: 核准加購後立即恢復 AI
- **GIVEN** 租戶的有效 `monthlyTokens` 是 1,000,000，本月用量是 1,000,000，AI 呼叫被月額度擋下
- **WHEN** 平台管理員核准加購 500,000 的申請
- **THEN** 下一次月額度檢查放行 AI 呼叫

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
