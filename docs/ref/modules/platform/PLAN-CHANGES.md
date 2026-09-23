# 方案異動審核

租戶提出升級或加購申請，平台在此審核。

- **資料來源**：`apps/api/src/modules/platform/plan-change.service.ts`、`apps/web/src/app/dashboard/plan/page.tsx`
- **核對日期**：2026-09-23

## 一筆申請的流程

租戶在租戶後台的 `/dashboard/plan` 送出，端點是 `POST /api/v1/plan-change`，需要 `settings.manage` 權限。平台在 `/admin/plan-changes` 核准或駁回。

| 階段 | 端點 | 規則 |
| --- | --- | --- |
| 送出 | `POST /api/v1/plan-change` | 同一個租戶同時只能有一筆 `pending`，否則回 409。`upgrade` 當場檢查目標方案存在，`token_topup` 檢查加購量是正整數 |
| 待審 | `GET /platform/plan-change-requests` | 只回傳 `pending`，依申請時間舊到新。附租戶名稱與目前方案 |
| 核准 | `PATCH /platform/plan-change-requests/:id/approve` | 依型別執行動作，見下文 |
| 駁回 | `PATCH /platform/plan-change-requests/:id/reject` | 只改狀態，不動租戶 |

核准與駁回都只接受 `pending` 的申請，已處理過的回 400。兩者都會記下 `reviewedBy`、`reviewedAt` 與審核備註。

## 兩種型別核准後做什麼

| 型別 | 核准後的動作 | 失效的快取 |
| --- | --- | --- |
| `upgrade` | 改 `tenant.planId` | 權限天花板快取、租戶方案快取 |
| `token_topup` | 把加購量加進 `tenant.limitOverrides.monthlyTokens` | 租戶方案快取、AI 額度計數器 |

`upgrade` 只是換方案，**沒有任何「比較貴」的檢查**。目標方案是更便宜或功能更少的方案時，核准一樣會照做。系統也沒有 `downgrade` 型別，租戶要降級只能請平台直接改，見[租戶管理](./TENANTS.md#改方案的連帶效果)。

核准之後租戶不會收到通知。沒有寄信，也沒有站內通知，租戶要自己回 `/dashboard/plan` 才看得到狀態。

## 加購是永久提高每月額度

`token_topup` 的計算是「現有有效額度加上加購量」，寫回 `limitOverrides.monthlyTokens`：

```text
新的每月額度 = 現有有效額度 + topupTokens
```

現有有效額度的解析方式與其他上限相同，覆寫優先，見[方案與上限](./PLANS.md#有效上限怎麼算)。

這個欄位是**每月額度的上限**，不是可消耗的餘額。額度計數器的 Redis key 帶年月、月底過期，每個月從零開始重算，但 `limitOverrides` 留著不動。因此核准一次加購 20 萬 token，是把這個租戶**往後每一個月**的額度都提高 20 萬，不是給他一次 20 萬。

介面兩邊寫的都是「加購 Token」，看不出是一次性還是長期，詳見 `../../system/AUDIT.md` 的 PLAN-02。

有一道保護：目前有效額度已經是無上限時，核准會被擋下並回 400 `TOPUP_UNLIMITED`。若不擋，加算出來的值沒有意義，管理員還會以為加購生效了。

## 平台看不到歷史

`listPendingRequests()` 的查詢條件寫死 `status: 'pending'`，平台後台沒有第二個端點可以查已核准或已駁回的申請。要回答「這個租戶上次升級是什麼時候」只能查資料庫，或從稽核紀錄的 `plan_change.approve` 反查。

租戶自己看得到全部，`listTenantPlanChangeRequests()` 回傳該租戶最近 50 筆。

`reviewedBy` 存的是 `platformUserId`，但不是外鍵，要顯示審核者的姓名必須自己查 `platform_users`。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
