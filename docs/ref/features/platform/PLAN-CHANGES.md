# 方案異動審核

租戶提出升級或加購申請，平台在此審核。

- **資料來源**：`apps/api/src/modules/platform/plan-change.service.ts`、`apps/api/src/modules/platform/plan-limits.service.ts`、`apps/web/src/app/admin/plan-changes/page.tsx`、`apps/api/src/modules/platform/plan-change.flow.ts`、`apps/web/src/app/dashboard/plan/page.tsx`、`apps/web/src/app/admin/layout.tsx`
- **核對日期**：2026-11-10

## 一筆申請的流程

租戶在租戶後台的 `/dashboard/plan` 送出，端點是 `POST /api/v1/plan-change`，需要 `settings.manage` 權限。平台在 `/admin/plan-changes` 核准或駁回。

| 階段 | 端點 | 規則 |
| --- | --- | --- |
| 送出 | `POST /api/v1/plan-change` | 同一個租戶同時只能有一筆 `pending`，否則回 409。`upgrade` 當場檢查目標方案存在，`token_topup` 檢查加購量是正整數 |
| 待審 | `GET /platform/plan-change-requests` | 只回傳 `pending`，依申請時間舊到新。附租戶名稱、目前方案、本月已核准的加購量（`monthlyTopupTokens`）與目前本月的 AI 月額度上限（`monthlyTokenLimit`，null 是無上限） |
| 核准 | `PATCH /platform/plan-change-requests/:id/approve` | 依型別執行動作，見下文 |
| 駁回 | `PATCH /platform/plan-change-requests/:id/reject` | 只改狀態，不動租戶 |

核准與駁回都只接受 `pending` 的申請，已處理過的回 400。兩者都會記下 `reviewedBy`、`reviewedAt` 與審核備註。

## 平台方怎麼知道有新申請

- **寄信**：申請建立後，`plan-change.flow.ts` 寄信給所有啟用中的平台帳號，信中有租戶名稱、類型、內容、備註與 `/admin/plan-changes` 的連結。寄信在回應之後進行，失敗不影響申請，也不重試。
- **寄送紀錄**：每次寄送後寫一筆平台稽核 `plan_change.notify_platform`（`platformUserId` 是 null），`payload` 有 `recipients`、`sent`、`failed`（收件人與原因），寄信之前就失敗時有 `error`。平台後台沒有依 `action` 查稽核的介面（PLAN-11），要查 `platform_audit_logs`。
- **側欄數量**：平台後台側欄的「升級申請」顯示待審數量（`GET /platform/plan-change-requests` 的筆數），沒有待審時不顯示。換頁、每 60 秒，以及在升級申請頁核准或駁回後重新載入。

## 各型別核准後做什麼

| 型別 | 核准後的動作 | 失效的快取 |
| --- | --- | --- |
| `upgrade` | 改 `tenant.planId`。試用租戶同時脫離試用，見[試用](./TRIALS.md#哪些操作會讓租戶脫離試用)。新方案的 AI 月額度較高時，清除本月的額度告警旗標 | 權限天花板快取、租戶方案快取 |
| `token_topup` | 只把申請改成 `approved`（條件更新，只更新仍是 `pending` 的申請），不改租戶。加購量計入核准當月的 AI 月額度，並清除本月的額度告警旗標 | AI 額度計數器 |

`upgrade` 只是換方案，**沒有任何「比較貴」的檢查**。目標方案是更便宜或功能更少的方案時，核准一樣會照做。唯一的例外是試用方案（試用政策 `trial.planSlug` 指定的方案）：建立與核准申請都回 400，見[試用](./TRIALS.md#哪些操作會讓租戶脫離試用)。系統也沒有 `downgrade` 型別，租戶要降級只能請平台直接改，見[租戶管理](./TENANTS.md#改方案的連帶效果)。

核准之後租戶不會收到通知。沒有寄信，也沒有站內通知，租戶要自己回 `/dashboard/plan` 才看得到狀態。

## 加購只計入核准當月

2026-11-10 起（change `make-token-topup-monthly`），加購只加當月，下個月自動回到方案額度。月份一律用台灣時間：

```text
本月 AI 月額度 = 基礎上限 + 本月（台灣時間）已核准的 token_topup 加總
基礎上限       = limitOverrides.monthlyTokens（有這個 key 時）?? Plan.limits.monthlyTokens；null 是無上限
```

- 一筆加購屬於**核准時間**（`reviewedAt`）所在的台灣月份，不是申請時間。月底送出、隔月 1 日才核准的加購算在隔月。
- 當月加購量直接從已核准的申請加總（`plan-limits.service.ts` 的 `sumMonthlyTopupTokens()`），不另外存，也不寫 `limitOverrides`。每一筆加購都是一筆申請，有審核者、時間與備註，可以對帳。
- 解析只有一份：`plan-limits.service.ts` 的 `getEffectiveLimit()`。LLM 呼叫前的月額度檢查、告警門檻與平台審核頁都呼叫它，`approveRequest()` 也用 `resolveEffectiveLimit()` 判斷基礎上限，不再自己算。
- 換方案之後，加購加在新方案的額度上（PLAN-05 已修正）。
- 基礎上限是無上限時，核准會被擋下並回 400 `TOPUP_UNLIMITED`。核准之後才換到無上限方案時，本月仍是無上限。
- 核准是條件更新：同一筆申請同時核准兩次，只有一次成功，另一次回 400。

兩邊畫面都寫明「加購僅限核准當月（台灣時間），下個月回到方案額度」。租戶頁的申請記錄在已核准的加購旁顯示「限 YYYY-MM 使用」；平台審核頁在每筆加購申請下方顯示該租戶「本月已加購」與「本月上限」。

2026-11-10 以前的核准會把「當時有效額度 + 加購量」寫進 `limitOverrides.monthlyTokens`，等於永久提高每月額度（PLAN-02）。migration `20261110120000_remove_topup_monthly_tokens_override` 移除所有租戶的這個 key；部署當月已核准的加購仍由新的計算計入。

## 額度告警旗標

核准加購時一律清除本月的額度告警旗標與用量計數器。旗標到月底才過期，不清除的話，用量跨越新上限的 80%、100% 時，系統不會再通知。

換方案也會清除，但只在 AI 月額度提高時（比較換方案前後的基礎上限，`plan-limits.service.ts` 的 `monthlyTokensRaisedByPlanChange()`）：核准升級、平台改租戶方案（`updateTenant()`）、試用轉付費（`convertToPaid()`），以及平台調高方案的 `limits.monthlyTokens`（`updatePlan()`，只清沒有覆寫 `monthlyTokens` 的租戶）。上限不變或降低時保留旗標。修正紀錄（原 PLAN-13）見 `../../system/AUDIT-REVIEWS.md`。

申請仍不記金額，系統沒有計費，見 `../../system/AUDIT.md` 的 PLAN-10。

## 平台看不到歷史

`listPendingRequests()` 的查詢條件寫死 `status: 'pending'`，平台後台沒有第二個端點可以查已核准或已駁回的申請。要回答「這個租戶上次升級是什麼時候」只能查資料庫，或從稽核紀錄的 `plan_change.approve` 反查。

租戶自己看得到全部，`listTenantPlanChangeRequests()` 回傳該租戶最近 50 筆。

`reviewedBy` 存的是 `platformUserId`，但不是外鍵，要顯示審核者的姓名必須自己查 `platform_users`。

稽核反查也不實用，平台稽核只能依平台帳號查，不能依租戶或 `action` 查，詳見 `../../system/AUDIT.md` 的 PLAN-11。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
