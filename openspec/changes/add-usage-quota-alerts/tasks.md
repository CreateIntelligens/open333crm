## 1. 門檻偵測與冪等（token-quota.service.ts）

- [x] 1.1 在 `apps/api/src/modules/trial/token-quota.service.ts` 定義門檻常數 `QUOTA_ALERT_THRESHOLDS = [{ level: 'warning', pct: 0.8 }, { level: 'critical', pct: 1.0 }] as const`
- [x] 1.2 修改 `incrMonthlyTokens` 回傳型別由 `Promise<void>` 改為 `Promise<number | null>`：正常路徑回傳累加後計數器總量，Redis 不可用時回傳 `null`（各分支——NX 搶到、NX 未搶到補 incrby、已存在直接 incrby——都要回正確 after 值）
- [x] 1.3 新增 `checkQuotaThresholdCrossing(prisma, tenantId, tokensAdded, after)`：取得 `limit = getEffectiveLimit(..., 'monthlyTokens')`，`limit===null` 直接回 `[]`；對每個門檻算 `thresholdTokens = Math.ceil(limit * pct)`，以 `before = after - tokensAdded`、判斷 `before < thresholdTokens && after >= thresholdTokens` 找出剛跨越的門檻
- [x] 1.4 在 `checkQuotaThresholdCrossing` 內對每個剛跨越的門檻以 Redis `SET aiquota-alert:{tenantId}:{YYYY-MM}:{level} 1 PXAT {nextMonthStart} NX` 搶佔冪等旗標；僅搶到（回 `OK`）的門檻納入回傳清單
- [x] 1.5 新增測試用 helper：清除某租戶當月告警旗標（類比 `clearTokenQuotaCache`），供整合測試重跑

## 2. 事件與觸發（llm.service.ts / event-bus.ts）

- [x] 2.1 在 `apps/api/src/events/event-bus.ts` 的 `AppEventName` 新增 `'usage.quota.threshold'`
- [x] 2.2 在 `apps/api/src/modules/ai/llm.service.ts` 的 `recordAiUsage` 中，將 `incrMonthlyTokens(...)` 的回傳值接起來（保持 fire-and-forget、失敗只 log），拿到 `after` 後呼叫 `checkQuotaThresholdCrossing`
- [x] 2.3 對每個回傳的剛跨越門檻，`eventBus.publish({ name: 'usage.quota.threshold', tenantId, timestamp, payload: { level, usedTokens: after, limitTokens: limit, monthKey } })`（整段包在既有的 `.catch(log)` 內，不阻塞回覆）
- [x] 2.4 確認僅在 `success && !isByok && totalTokens > 0` 路徑觸發（沿用既有 `incrMonthlyTokens` 呼叫條件，BYOK 天然排除）

## 3. 告警發送 worker（eventBus 訂閱）

- [x] 3.1 在 `apps/api/src/modules/notification/notification.worker.ts`（或新增 `usage-alert.worker.ts` 並於 bootstrap 註冊）訂閱 `'usage.quota.threshold'`
- [x] 3.2 handler 內查該租戶 `role='ADMIN' && isActive=true` 的 agents（id + email），無 ADMIN 時記 log 並結束
- [x] 3.3 站內通知：對每位 ADMIN `enqueue notification:dispatch`（複用既有 job／handler），`type` 依 level 為 `usage_quota_warning`／`usage_quota_critical`，`title`/`body` 帶用量概況，`clickUrl` 指向用量／方案頁
- [x] 3.4 email：對每位 ADMIN email 呼叫對應的 `sendQuotaWarningEmail`／`sendQuotaCriticalEmail`（fire-and-forget，失敗只 log）
- [x] 3.5 全程 try/catch 逐租戶／逐接收者隔離，任一失敗不影響其他，且不拋回 eventBus

## 4. Email 模板（usage-alert-emails.ts）

- [x] 4.1 新增 `apps/api/src/modules/trial/usage-alert-emails.ts`，沿用 `trial-emails.ts` 的 `wrap`/`button`/`p`/`safeSend`/`escapeHtml`／`render` 樣式（或抽共用）
- [x] 4.2 實作 warning 模板（accent 琥珀 `#b7791f`）：標題「AI 用量已達 80%」，內文帶 `{siteName}`、已用／上限 token、月份，CTA 查看用量／升級
- [x] 4.3 實作 critical 模板（accent 紅 `#d1443e`）：標題「AI 用量已達上限」，說明 AI 自動回覆暫停、真人回覆不受影響，CTA 升級／查看用量
- [x] 4.4 匯出 `sendQuotaWarningEmail(to, vars)` 與 `sendQuotaCriticalEmail(to, vars)`，主旨分別為 `【open333】AI 用量提醒（80%）：{siteName}`、`【open333】AI 用量已達上限：{siteName}`，變數一律 `escapeHtml` 後代入

## 5. 測試與驗證

- [x] 5.1 單元測試 `checkQuotaThresholdCrossing`：涵蓋剛跨越 80%、剛跨越 100%、單次同時跨越兩者、未跨越（回 `[]`）、`limit===null`（回 `[]`）
- [x] 5.2 冪等測試：同門檻連續跨越只回一次；模擬並發僅一方搶到旗標；清旗標／跨月後可再發
- [x] 5.3 範圍測試：BYOK 路徑不觸發；無上限租戶不觸發
- [x] 5.4 整合／手動驗證：本機 `EMAIL_DELIVERY_MODE=log`，將測試租戶 `limitOverrides.monthlyTokens` 壓到很小值，連打 AI 觀察站內 `notification.new` 與 log email 依序出現 warning→critical 各一次，重打不再重發，且 AI 回覆與硬擋照常
- [x] 5.5 確認 Redis 關閉時告警被跳過（log 提示）但 AI 回覆與 DB 兜底硬擋不受影響

## 6. 收尾

- [x] 6.1 （選配）以 env flag `USAGE_QUOTA_ALERTS_ENABLED` 包住 eventBus publish，供上線初期灰度／快速回滾
- [ ] 6.2 （選配）平台端 `platform-usage`（`platform.routes.ts` `/usage/*`）標記 over-quota／已告警狀態供平台方檢視
- [x] 6.3 更新 `CHANGELOG.md` 於最新版本區塊新增本功能（MANDATORY RULE）
- [x] 6.4 執行 `openspec validate add-usage-quota-alerts` 確認通過；typecheck／lint 通過
