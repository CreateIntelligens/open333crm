## Why

change `platform-control-plane` 在 `aa274cf0` 以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。這個 change 補回其中的 `plan-change-request`：租戶申請換方案或加購 token，平台核准或駁回。前兩部分已經補回：`restore-platform-plan-specs`（#247）處理認證、方案天花板與上限，`restore-platform-usage-specs`（#249）處理用量與額度。

程式已經實作大部分的需求，但做法與歸檔規格不同。這個 change 照現行程式寫主規格，並修正對照時處理的 AUDIT PLAN-06。

## What Changes

- 新增主規格 `plan-change-request`，7 條需求：
  - 租戶送出方案異動申請。
  - 租戶查詢自己的申請。
  - 平台查詢待審的申請。
  - 核准升級申請。
  - 核准加購申請。
  - 駁回申請。
  - 只處理待審的申請。
- `usage-quota-alerts`：修改「每個門檻每月最多告警一次」，核准加購之後清除本月的告警旗標。
- 修正 AUDIT PLAN-06：核准加購時，`approveRequest()` 原本只刪除用量計數器，本月的告警旗標保留到月底。用量跨越新上限的 80% 與 100% 時，系統都不會再通知。現在核准加購時也呼叫 `clearQuotaAlertFlags()`。

  修正保留刪除用量計數器的那一行。計數器偏低時（見新增的 AUDIT USAGE-03），刪除計數器之後，系統會從 `AiUsage` 補建出正確的值。
- `AUDIT.md`：移除已修正的 PLAN-06，新增對照時發現的 2 項：
  - PLAN-13：換方案或調高方案的額度之後，系統不清除告警旗標，當月的告警不會再發。
  - USAGE-03：計數器漏記之後，當月不會再從 `AiUsage` 校正。

### 歸檔需求的處理方式

| 歸檔的需求 | 處理 |
| --- | --- |
| 申請單建立與租戶發起 | 新增「租戶送出方案異動申請」。路由是 `POST /api/v1/plan-change`，不是 `/me/plan/requests`；目標方案用 `targetPlanSlug`，不是 `requestedPlanId`。現行程式另外限制一個租戶同時只能有一筆待審的申請。下列項目沒有實作：申請不記錄送出的成員（`requestedBy`）；加購的 `topupMode`，已在 #228 請 Daniel 決定（第 4 項）；平台收到新申請時的通知，已在 #228 請 Daniel 決定（第 5 項） |
| 租戶只能檢視自己的申請 | 新增「租戶查詢自己的申請」。沒有查詢單筆申請的路由，所以沒有「跨租戶存取單筆申請」的情境 |
| 平台審核申請清單與權限 | 新增「平台查詢待審的申請」。只回傳 `pending` 的申請，不能依 `status` 查詢，已記錄在 AUDIT PLAN-11。租戶的 JWT 呼叫平台路由時回 401，由 `platform-auth` 規定 |
| 核准 upgrade 改方案並觸發 entitlement 失效鏈 | 新增「核准升級申請」與「只處理待審的申請」。路由是 `PATCH`，不是 `POST`。稽核由 `platform-auth` 的「平台操作稽核」規定，但 payload 只有 `type` 與 `trialExited`，不記錄變更前後的方案。下列項目沒有實作：稽核記錄變更前後的方案；核准的通知（第 5 項） |
| 核准 token_topup 提高額度並校準 Redis 解除硬擋 | 新增「核准加購申請」。沒有 `tokenQuotaMonthly` 欄位，加購量寫入 `limitOverrides.monthlyTokens`，之後的每個月都適用，等於歸檔規格的 `raise_monthly`；`one_time_month` 沒有實作（第 4 項，AUDIT PLAN-02）。上限不存在 Redis，月額度檢查每次都讀資料庫，所以不需要「校準 Redis 的上限」，「核准加購後立即恢復 AI」驗證這個行為。下列項目沒有實作：稽核記錄變更前後的額度；核准的通知（第 5 項） |
| 平台駁回申請 | 新增「駁回申請」。稽核由 `platform-auth` 規定。沒有實作：駁回的通知（第 5 項） |

`requestedBy` 與「稽核記錄變更前後的值」不在 #228 已列的 13 項裡，會在這個 PR 合併後於 #228 請 Daniel 決定。

AUDIT PLAN-05（加購過的租戶升級後，額度停在升級前的數字）沒有在這個 change 處理。修法取決於 #228 第 4 項的決定：加購如果改成只加本月，就不會再寫入覆寫值。

## Capabilities

### New Capabilities

- `plan-change-request`：租戶申請換方案或加購 token，平台查詢、核准與駁回。

### Modified Capabilities

- `usage-quota-alerts`：核准加購之後清除本月的告警旗標。

## Impact

- `apps/api/src/modules/platform/plan-change.service.ts`：核准加購時清除本月的告警旗標。
- `apps/api/src/modules/trial/token-quota.service.ts`：`clearQuotaAlertFlags()` 的註解原本寫「測試用」，改為說明核准加購時呼叫。
- `CHANGELOG.md`：PLAN-06 的修正。
- `docs/ref/system/AUDIT.md`：移除 PLAN-06，新增 PLAN-13、USAGE-03。`docs/ref/system/AUDIT-REVIEWS.md` 新增複查紀錄。
- `docs/ref/features/platform/`：`PLAN-CHANGES.md`、`README.md`、`USAGE.md` 改寫核准加購的效果，並連到新的 AUDIT 項目。
- 歸檔後，新主規格 `plan-change-request` 的 Purpose 是 CLI 產生的佔位文字，要手動改寫。
