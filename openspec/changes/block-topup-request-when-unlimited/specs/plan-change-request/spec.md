## MODIFIED Requirements

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

## ADDED Requirements

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
