## Why

租戶在 `/dashboard/plan` 申請加購 AI token，平台在 `/admin/plan-changes` 核准後，`approveRequest()` 把「目前有效額度 + 加購量」寫進
`tenant.limitOverrides.monthlyTokens`。這個覆寫值沒有期限，等於**永久**調高每月額度（AUDIT PLAN-02，issue #222 第 26 項）。
覆寫值又優先於方案的 `limits`，加購過的租戶升級方案之後，AI 月額度停在升級前的數字（PLAN-05）；降級後仍維持加購後的額度（PLAN-03）。

另外，換方案或調高方案的額度之後，本月的額度告警旗標還在，用量跨越新上限的 80%／100% 時不會再通知（PLAN-13，#222 第 27a 項）。

使用者 2026-11-10 決定：加購只加當月（台灣時間），下個月自動回到方案額度。

## What Changes

- **BREAKING（行為）**：核准加購不再寫 `limitOverrides`。加購量只計入核准當月（台灣時間）的 AI 月額度，下個月回到方案額度。
- AI 月額度的有效上限改為「基礎上限 + 本月已核准的加購量總和」。基礎上限沿用原本的解析（`limitOverrides.monthlyTokens` 有設定時用它，否則用
  `plan.limits.monthlyTokens`；null 是無上限）。基礎上限是無上限時，有效上限仍是無上限。
- 當月加購量從已核准的 `token_topup` 申請本身算出（`status=approved`，`reviewedAt` 落在本月台灣時間），不新增欄位，也不再「讀出 JSON、
  記憶體加總、整份覆寫」。核准改為條件更新（只更新仍是 `pending` 的申請），同一筆申請同時核准兩次只有一次成功。
- 有效上限的解析只留一份：`plan-limits.service.ts`。`approveRequest()` 呼叫它，不再自己重寫。
- 會提高月額度的操作之後，清除受影響租戶本月的額度告警旗標：核准加購、核准升級、平台改租戶方案、試用轉正式、平台調高方案的
  `limits.monthlyTokens`。上限不變或降低時保留旗標。
- 一次性 migration：移除所有租戶 `limitOverrides` 的 `monthlyTokens` key（這個 key 唯一的寫入端是核准加購）。本月已核准的加購仍會由新的計算方式計入。
- 畫面：租戶端 `/dashboard/plan` 與平台端 `/admin/plan-changes` 寫清楚「加購僅限當月（台灣時間），下個月回到方案額度」；平台審核時每筆申請顯示該租戶本月已加購多少、目前本月上限。
- 不處理：PLAN-03 的其他兩點（降級不回收超額資源、多行程的方案快取）、PLAN-16 的升級審核競態與 pending 唯一性、PLAN-10 計費。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `plan-limits-core`：MODIFIED「有效上限解析」（`monthlyTokens` 的解析結果是基礎上限）；ADDED「AI 月額度含當月加購量」。
- `plan-change-request`：MODIFIED「核准加購申請」（不寫覆寫值、只計入當月、條件更新）；MODIFIED「平台查詢待審的申請」（加上本月已加購量與本月上限）；
  ADDED「畫面說明加購僅限當月」。
- `usage-quota-alerts`：MODIFIED「每個門檻每月最多告警一次」；ADDED「月額度提高後可以再次告警」。
  開啟中的 change `fix-platform-usage-trial-display` 也 MODIFIED 了「每個門檻每月最多告警一次」（改成台灣月份）。本 change 的版本以它為基礎，
  **必須在 `fix-platform-usage-trial-display` 歸檔之後再歸檔**，否則台灣月份的文字會被舊版覆蓋。

## Platform layer

逐項檢查 AGENTS.md「Plan the platform layer in the same change」的表格：

- **adds a resource that a plan should limit**：不新增上限 key。`monthlyTokens` 的檢查點不變（`token-quota.service.ts`），只改有效上限的算法。
- **adds a tenant setting or state that the platform team must see or control**：適用。當月加購量是新的租戶狀態，平台審核頁（`/admin/plan-changes`）每筆申請顯示該租戶
  本月已加購量與目前本月上限，由 `GET /api/v1/platform/plan-change-requests` 回傳。平台用量頁（`/admin/usage`）目前不顯示月上限，所以不用改。
- **sends a request from a tenant to the platform team, or the other way**：既有的申請流程，不新增請求；兩邊畫面同步說明加購只限當月。
- **writes a new platform audit action**：不新增稽核 action。核准仍寫 `plan_change.approve`。
- 其他項（權限碼、feature 區、AI 呼叫、渠道類型、BullMQ 佇列）不適用：本 change 不新增這些東西。

## Impact

- API：`apps/api/src/modules/platform/plan-limits.service.ts`、`plan-change.service.ts`、`platform-tenant.service.ts`、`trial-admin.service.ts`、
  `plan.service.ts`；`apps/api/src/modules/trial/token-quota.service.ts` 不改介面。
- Web：`apps/web/src/app/dashboard/plan/page.tsx`、`apps/web/src/app/admin/plan-changes/page.tsx`。
- 資料庫：一個 migration 移除 `tenants."limitOverrides"` 的 `monthlyTokens` key；不改 schema。
- 文件：`docs/ref/system/AUDIT.md`（PLAN-02、PLAN-03、PLAN-05、PLAN-13）、`AUDIT-REVIEWS.md`、`docs/ref/features/platform/PLANS.md`、
  `PLAN-CHANGES.md`、`USAGE.md`、`feature-map.json`、`feature-platform-plan-changes` skill。
