## Context

- AI 月額度的檢查：`llm.service.ts` 的 `readLlmInputs()` 每次呼叫 LLM 前以 `getEffectiveLimit(ctx.tx, tenantId, 'monthlyTokens')` 讀上限，
  `token-quota.service.ts` 的 `isMonthlyTokenExceeded()` 拿 Redis 計數器（台灣月份）比對。上限不快取，每次從資料庫讀。
- 有效上限：`plan-limits.service.ts` 的 `resolveEffectiveLimit()`，`limitOverrides` 有 key 就用覆寫值，否則用 `plan.limits`。
- `approveRequest()` 的 `token_topup` 分支自己再算一次有效上限，再把「上限 + 加購量」整份覆寫進 `limitOverrides`（PLAN-02 的兩份邏輯與競態）。
- `plan_change_requests` 已有 `reviewedAt`、`topupTokens`、`status`，有 `(tenantId, status)` 索引，啟用 RLS。

## Goals / Non-Goals

**Goals:** 加購只計入核准當月（台灣時間）；當月上限 = 基礎上限 + 當月已核准加購量；換方案後用新方案額度；月額度提高後告警可以再次發送；
既有的加購覆寫值清除；兩邊畫面說明清楚。

**Non-Goals:** 計費（PLAN-10）；租戶撤回申請；降級回收超額資源；升級審核的條件更新與 pending 唯一索引（PLAN-16）。

## Decisions

### D1：當月加購量從已核准的申請算出，不新增欄位

`sumMonthlyTopupTokens(prisma, tenantId, at)` 對 `plan_change_requests` 做 `aggregate`：`tenantId`、`type='token_topup'`、`status='approved'`、
`reviewedAt` 在 `[taipeiMonthStart(at), taipeiNextMonthStart(at))`，加總 `topupTokens`。

- 一筆加購屬於**核准時間**所在的台灣月份，不是申請時間。月底送出、隔月 1 日才核准的加購算在新月份：租戶拿到的是完整的一個月。
- 可加總同月多筆、可對帳（每一筆都是一筆申請，有審核者、時間與備註）。
- 核准本身只寫申請的狀態，不改租戶，沒有「讀出、加總、覆寫」的競態。
- 替代方案：新增 `TokenTopup` 表或在 `limitOverrides` 存 `{ month, tokens }`。前者多一張要開 RLS 的表與 migration，資料和申請重複；
  後者仍是 JSON 整份覆寫。都不採用。

### D2：解析只留一份

`plan-limits.service.ts`：

- `resolveEffectiveLimit(tenant, key, monthlyTopupTokens = 0)`：原本的覆寫優先解析得到基礎上限；`key === 'monthlyTokens'` 而且基礎上限不是 null 時，加上 `monthlyTopupTokens`。
  不傳第三個參數時就是基礎上限，換方案前後比較用這個。
- `getEffectiveLimit(prisma, tenantId, key)`：查租戶；`monthlyTokens` 再查 `sumMonthlyTopupTokens()`。所有讀月額度的地方（LLM 呼叫前的檢查、告警門檻、平台審核頁）都走它。
- `approveRequest()` 用 `resolveEffectiveLimit(tenant, 'monthlyTokens')` 判斷基礎上限是不是無上限（`TOPUP_UNLIMITED`），不再自己寫一份。
- 基礎上限是 null 時加購沒有意義，仍擋核准；之後換到無上限方案時，本月已核准的加購不影響（仍無上限）。

### D3：核准加購用條件更新

`planChangeRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', ... } })`，`count` 是 0 時回 400「此申請已處理」。
同一筆申請同時核准兩次，只有一次成功，平台稽核也只記一次。升級分支維持原樣（PLAN-16）。

### D4：月額度提高後清除告警旗標

`plan-limits.service.ts` 新增 `isLimitRaised(before, after)`（null 是無上限：有限變無上限算提高，無上限變有限不算）與
`monthlyTokensRaisedByPlanChange(tenant, newPlan)`，比較換方案前後的基礎上限（同一個月的加購量兩邊相同，可以不算）。
`token-quota.service.ts` 的 `clearQuotaAlertFlags()` 是唯一的清除函式。呼叫點：

| 操作 | 判斷 |
| --- | --- |
| 核准加購 | 一律提高：清計數器（`clearTokenQuotaCache`，校正 USAGE-03）與告警旗標 |
| 核准升級（`approveRequest`） | 比較舊方案與目標方案的基礎上限 |
| 平台改租戶方案（`updateTenant`） | 同上 |
| 試用轉正式（`convertToPaid`） | 同上 |
| 平台改方案的 `limits`（`updatePlan`） | 對這個方案的每個租戶，比較舊 `limits` 與新 `limits` 的基礎上限 |

上限降低時不清：旗標代表用量曾跨越較高的門檻，降低後用量必定仍在新門檻之上，清除也不會再觸發告警，保留可以避免無謂的 Redis 寫入。
Redis 失敗時 `clearQuotaAlertFlags()` 只記 log，不影響換方案（與既有行為相同）。

### D5：Redis 硬擋即時解除

上限不快取，核准後下一次 `readLlmInputs()` 就讀到含加購的上限。核准加購時仍刪除計數器，讓系統從 `AiUsage` 重建（既有行為）。

### D6：既有資料的 migration

`UPDATE "tenants" SET "limitOverrides" = "limitOverrides" - 'monthlyTokens' WHERE "limitOverrides" ? 'monthlyTokens';`

- AUDIT 記載這個 key 唯一的寫入端是核准加購，所以全是加購造成的。沒有路由或頁面可以寫它。
- 本月（部署當月）已核准的加購仍由 D1 的計算計入，部署當月租戶不會少額度；更早月份的加購不再計入，這正是決定的語意。
- 只移除這一個 key，其他覆寫值（例如 `maxAgents`）不動；可重複執行（第二次沒有符合的列）。
- 風險：若有人直接改資料庫手動設定過 `monthlyTokens`，也會被清掉。部署前應在 UAT 以 `SELECT id, name, "limitOverrides" FROM tenants WHERE "limitOverrides" ? 'monthlyTokens'`
  對照已核准的加購確認（由使用者執行，本 change 不碰 UAT）。

### D7：畫面

- `/dashboard/plan`：選「加購 Token」時顯示「加購的額度只在核准當月（台灣時間）有效，下個月回到方案額度。」頁首說明同步。已核准的加購在申請記錄顯示有效月份（核准時間的台灣月份）。
- `/admin/plan-changes`：頁首說明「加購僅限核准當月（台灣時間），下個月回到方案額度」；加購申請在「內容」欄下方顯示「本月已加購 N token・本月上限 M token」（無上限顯示「無上限」）。
  `listPendingRequests()` 對每筆申請呼叫 `getEffectiveLimit()` 與 `sumMonthlyTopupTokens()`（待審申請很少，逐筆查詢可接受）。

## Risks / Trade-offs

- **核准時間跨月**：月底申請、隔月核准，加購算在隔月。這是刻意的（D1），畫面寫的是「核准當月」。
- **每次 LLM 呼叫多一個 aggregate 查詢**：走 `(tenantId, status)` 索引，每個租戶的申請很少。
- **歸檔順序**：`usage-quota-alerts` 的同一條需求也被 `fix-platform-usage-trial-display` 修改，本 change 必須後歸檔。
