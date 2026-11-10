## Why

issue #497：寫平台教學講義時發現平台後台兩處直接顯示原始資料。

- 試用管理「申請記錄」的狀態欄直接輸出 `pending_verification`、`provisioned`、`failed`，營運人員看不懂。同一頁「試用租戶」分頁已有中文標籤（`STATUS_META`）。
- 用量統計的單一租戶每日趨勢只回有用量的日子（`GROUP BY date_trunc('day', "createdAt")`），`TrendChart` 依陣列順序一根接一根畫。UAT「創造智能・近 30 天」只畫了 16 根長條擠在左半邊，下方卻標著完整 30 天的起訖，看起來像後半個月沒有用量。
- 每日切點是資料庫時區（UTC），台灣早上 8 點才換日，台灣 00:00–08:00 的用量算到前一天（健檢 HC-PLATFORM-USAGE-05 的每日趨勢部分、HC-PLATFORM-USAGE-09）。

主規格 `platform-usage` 只寫「一個租戶每日的 token、成本與呼叫次數」，沒有規定時區，也沒有規定沒有用量的日子。補 0 會讓 API 回傳的陣列變長，換時區會讓同一筆用量歸到不同日期，API 呼叫端看得到，所以照 AGENTS.md 開 change、修改既有需求。申請狀態的中文標籤是使用者看得到的畫面變更，主規格沒有涵蓋，一併新增需求。

## What Changes

- `GET /api/v1/platform/usage/tenants/:tenantId` 的 `trend`：以台灣日期（`Asia/Taipei`）分日，`day` 是台灣日期；查詢期間內每一個台灣日期都有一筆，依日期排序，沒有用量的日子 `tokens: 0`、`costUsd: "0"`、`calls: 0`。期間超過 400 天時只列有用量的日子（與券統計的 `fillDays()` 相同上限，避免回應過大）。
- 期間（`from`、`to`）的過濾不變。總覽、租戶排行與每日趨勢用同一個時間點區間，三者的加總一致；只有每日趨勢的分日方式改變。
- `/admin/usage` 的「近 7／30／90 天」改從台灣今天往前 N−1 天的 00:00 起算到現在，三個查詢共用這個區間，每日趨勢剛好 N 格。沒有用量的日子不畫最小高度的長條。
- 試用管理「申請記錄」的狀態顯示中文：`pending_verification` 等待驗證、`provisioned` 已開通、`failed` 失敗／已作廢；未知的狀態顯示原值。
- 月額度（`token-quota`）仍以 UTC 月份計算，不在這個 change 的範圍。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `platform-usage`：修改「平台用量查詢」（每日用量以台灣日期分日並補齊沒有用量的日子）。
- `trial-application`：新增「平台後台以中文顯示申請狀態」。

## Impact

- `apps/api/src/modules/platform/platform-usage.service.ts`（`getTenantUsageDetail()`）
- `packages/core/src/coupon/taipei-time.ts`（新增 `taipeiDatesBetween()`，券統計的 `fillDays()` 改用它）、`apps/api/src/modules/coupon/coupon-stats.service.ts`
- `apps/web/src/app/admin/usage/page.tsx`、`apps/web/src/app/admin/lib/usage-range.ts`（新增）、`apps/web/src/app/admin/trial/page.tsx`
- `docs/ref/features/platform/USAGE.md`、`docs/ref/features/platform/TRIALS.md`
- 不需要資料庫 migration。
