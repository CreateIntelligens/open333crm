## Context

系統已有一套「AI token 月額度」機制：

- **累加**：每次成功且 `keySource='platform'` 的 AI 呼叫，於 `recordAiUsage`（`apps/api/src/modules/ai/llm.service.ts`）寫入 `aiUsage` 後，fire-and-forget 呼叫 `incrMonthlyTokens`（`apps/api/src/modules/trial/token-quota.service.ts`），累加到 Redis 計數器 `aiquota:{tenantId}:{YYYY-MM}`（月底過期，miss 時從 DB 回填，含 SET NX 防並發 lost-update）。
- **上限來源**：`getEffectiveLimit(prisma, tenantId, 'monthlyTokens')`（`apps/api/src/modules/platform/plan-limits.service.ts`），有效上限 = `Tenant.limitOverrides.monthlyTokens ?? Plan.limits.monthlyTokens`，回 `null` 代表無上限。
- **硬擋**：`generateReply` 在 `keySource==='platform'` 且 `isMonthlyTokenExceeded` 為真時丟 `AppError('PLAN_LIMIT_EXCEEDED', 403)`。BYOK（`keySource='byok'`）不計額度、不擋、不告警。

現況缺口：租戶在被硬擋前沒有任何預警。本 change 在既有累加流程之後補上「跨越門檻即告警」，不改動硬擋語意。

既有可複用的基礎設施：

- **站內通知**：eventBus（`apps/api/src/events/event-bus.ts`，in-process EventEmitter）→ `notification.worker.ts`（訂閱 event、查 recipient、enqueue `notification:dispatch` job）→ BullMQ → `apps/workers/src/handlers/notification.handler.ts`（寫 `Notification` + `publishSocketEvent` 發 `notification.new`）。此為 CLAUDE.md 所述 **Path B**。
- **email**：`sendEmail`（`apps/api/src/modules/email/email.service.ts`，模式 log/smtp/webhook）；試用信 `trial-emails.ts` 提供 `wrap`/`button`/`safeSend` 與 HTML 轉義範例。
- **冪等閘範例**：`trial.scheduler.ts` 用 `Tenant.trialRemindersSent`（Json 陣列）記已寄門檻。
- **ADMIN 名單查詢**：`trial.scheduler.ts` 的 `adminEmails` 與 `notification.worker.ts` 的 `getSupervisorAndAdminIds` 皆示範以 `role`＋`isActive` 過濾。

## Goals / Non-Goals

**Goals:**

- 當 platform-key 月用量**剛跨越 80%** 或**剛跨越 100%** 時，各對租戶所有啟用中 ADMIN 發送一次站內 Notification + email。
- 每租戶／每月／每門檻**至多一次**（冪等），月初自動重置。
- 完全不阻塞、不影響 AI 回覆主流程（告警任何失敗只 log）。
- 只對 `keySource='platform'` 且有 `monthlyTokens` 上限的租戶生效；BYOK 與無上限租戶不觸發。

**Non-Goals:**

- 超量計費、自動加購、grace 寬限期（牽涉金流，另案）。
- 可自訂門檻百分比（本版寫死 80/100；預留常數但不做設定 UI）。
- 可自訂 email 模板／關閉告警的租戶偏好設定。
- 通知 AGENT/SUPERVISOR（僅 ADMIN，額度是帳務層級議題）。
- 改動既有硬擋（`PLAN_LIMIT_EXCEEDED`）行為。

## Decisions

### 決策 1：門檻跨越偵測 —— 比較「累加前 vs 累加後」的用量

在 `incrMonthlyTokens` 累加成功後，取得**累加後總量** `after`，並推得**累加前總量** `before = after - tokens`。對每個門檻 `T`（80%、100% 對應的 token 值）判斷 `before < T && after >= T` 即「剛跨越」。這樣即使單次呼叫一口氣從 70% 跳到 105%，也能同時觸發 warning 與 critical（兩者都是「剛跨越」）。

- **為何在累加後（而非硬擋處）攔**：硬擋只在 `>=100%` 時發生且會擋 AI，無法涵蓋 80% 預警；累加後是唯一同時知道 before/after 且涵蓋所有呼叫的點。
- **token 值計算**：`thresholdTokens = Math.ceil(limit * pct)`。`limit` 由 `getEffectiveLimit` 取得；`limit===null`（無上限）時直接跳過偵測。
- **實作放哪**：在 `token-quota.service.ts` 新增 `checkQuotaThresholdCrossing(prisma, tenantId, tokensAdded, after)`，回傳「本次剛跨越且尚未發過」的門檻清單（如 `['warning']`／`['warning','critical']`／`[]`）。`incrMonthlyTokens` 需回傳累加後值（目前回 `void`，改為回 `number | null`，Redis 不可用時回 `null` 表示無法偵測，跳過告警）。
- **替代方案**：（A）每次呼叫都算目前百分比並在 X% 以上就發 → 需靠冪等擋，但無法區分「剛跨越」語意、且並發下更難推理，捨棄。（B）用排程週期性掃描所有租戶用量 → 延遲高（最壞一小時）、且要掃全租戶，捨棄；即時偵測延遲近零。

### 決策 2：冪等閘 —— Redis flag（key 帶月份，隨月自然過期）

用 Redis key `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`（level = `warning`｜`critical`）作為「已發旗標」，以 **`SET NX PXAT(nextMonthStart)`** 原子搶佔：搶到（回 `OK`）才真的發告警；沒搶到代表本月本門檻已發過，跳過。key 與計數器同樣設月底過期，月初自動重置，無需清理。

- **為何用 Redis 而非 DB 欄位（`Tenant.quotaAlertsSent` 類比 `trialRemindersSent`）**：
  - 告警本就依賴 Redis 計數器（`incrMonthlyTokens` 在 Redis 不可用時無法可靠偵測跨越），冪états 也放 Redis 一致、免 migration。
  - `SET NX` 原生原子，天然擋住並發雙發（兩個並發呼叫同時跨越同一門檻，只有一個搶到 flag）。DB 欄位要另做交易或 `updateMany` 條件更新才安全。
  - 隨月份 key 自動過期＝自動重置，不必每月清欄位。
- **代價 / 風險**：Redis flush／key 遺失會導致同月可能重發一次（可容忍：告警不是金流，重發一封信不致命）。若日後需嚴格審計已發告警，可再補 DB 記錄（列入 Open Questions）。
- **替代方案**：DB `Tenant.quotaAlertsSent` Json 陣列（如 `{"2026-08":["warning","critical"]}`）——可持久審計但需 migration、需自行處理並發與月度清理，且與「偵測本就靠 Redis」不對稱，故不採為主方案。

### 決策 3：通知走 Path B（async queue），email 於 API 端 event worker 直接寄

發送需「查該租戶所有啟用中 ADMIN」＝額外 DB 查詢＋多接收者，依 CLAUDE.md 屬 **Path B**。作法：

1. `recordAiUsage` 內、`incrMonthlyTokens` 之後，若偵測到剛跨越門檻，`eventBus.publish({ name: 'usage.quota.threshold', tenantId, payload: { level, usedTokens, limitTokens, monthKey } })`（fire-and-forget）。
2. 在 `notification.worker.ts`（或新 `usage-alert.worker.ts`，掛同一 eventBus）訂閱 `usage.quota.threshold`：查該租戶 `role='ADMIN' && isActive` 的 agents →
   - **站內**：對每位 ADMIN `enqueue notification:dispatch`（**複用既有 job 與 handler，零改動 worker**），`type='usage_quota_warning'|'usage_quota_critical'`，`clickUrl` 指向平台方案／用量頁。
   - **email**：對每位 ADMIN 的 email 呼叫新增的 `sendQuotaWarningEmail`／`sendQuotaCriticalEmail`（fire-and-forget，`safeSend` 失敗只 log）。
- **為何 email 在 API 端 event handler 直接寄、而非丟進 worker**：現有 email（試用信）皆在 API process 內以 `sendEmail` fire-and-forget 寄出，無專屬 email queue；沿用既有慣例最省。event handler 本就在 API process，可直接呼叫 `sendEmail`。
- **冪等閘的位置**：在「決定要不要 publish event」之前就用 `SET NX` 搶 flag（於 `checkQuotaThresholdCrossing` 內或其呼叫端），確保 event 只 publish 一次；worker 端不需再做冪等（單一 event → 對多位 ADMIN 各發一份是預期行為，非重複）。
- **替代方案**：Path A 在 `recordAiUsage` 直接 `createAndDispatch` → 但 `recordAiUsage` 無 `io` 實例、且需自行查 ADMIN，違反 Path B 準則，捨棄。

### 決策 4：email 內容與模板位置

新增 `apps/api/src/modules/trial/usage-alert-emails.ts`（或併入既有 email 模組），沿用 `trial-emails.ts` 的 `wrap`/`button`/`p`/`safeSend`/`escapeHtml` 樣式：

- **warning（80%）**：accent 用琥珀色（同試用提醒 `#b7791f`），標題「AI 用量已達 80%」，內文帶已用／上限 token 與月份，CTA「查看用量／升級方案」。
- **critical（100%）**：accent 用紅色（`#d1443e`），標題「AI 用量已達上限」，說明 AI 自動回覆將暫停、真人回覆不受影響，CTA 同上。
- 主旨：`【open333】AI 用量提醒（80%）：{siteName}` / `【open333】AI 用量已達上限：{siteName}`。
- 變數（siteName 等使用者可控字串）一律 `escapeHtml` 後代入。

### 決策 5：計費範圍與門檻常數

- 告警範圍與計數器完全對齊：只在 `keySource='platform'`、`success`、`totalTokens>0` 的累加路徑觸發（即現有 `incrMonthlyTokens` 呼叫點），BYOK 天然不會進來。
- `limit===null`（無上限）→ 不偵測、不告警。
- 門檻常數集中定義：`const QUOTA_ALERT_THRESHOLDS = [{ level: 'warning', pct: 0.8 }, { level: 'critical', pct: 1.0 }] as const;`，方便日後擴充（如加 90%）而不散落。

## Risks / Trade-offs

- **[Redis 不可用時漏發告警]** → 偵測本就依賴 Redis 計數器；Redis 掛掉時 `incrMonthlyTokens` 走 DB fallback 且回 `null`，直接跳過告警（fail-silent）。硬擋仍靠 DB 兜底不受影響。可接受：告警是加值預警非硬性保證。
- **[Redis flag 遺失導致同月重發]** → flush／驅逐可能使冪等 flag 消失，最壞同一門檻重發一次。影響僅為多一封信/通知，可容忍。
- **[門檻略過（單次跳過整個門檻）]** → 用 `before < T && after >= T` 的區間判斷，一次巨量呼叫從 70% 跳到 105% 會同時觸發 warning 與 critical，不漏門檻。
- **[email 大量寄送]** → 一租戶多位 ADMIN 各寄一封；因冪等每月每門檻只一輪，總量受控。`sendEmail` 失敗只 log 不重試（沿用現有行為）。
- **[並發雙發]** → `SET NX` 原子搶佔保證同門檻只有一個呼叫勝出 publish event。
- **[incrMonthlyTokens 回傳值變更]** → 從 `void` 改回 `number | null` 屬向後相容擴充（現有唯一呼叫點在 `recordAiUsage` 且以 `.catch()` fire-and-forget，需一併更新以接收回傳值並觸發偵測）。

## Migration Plan

1. **無 DB migration**（採 Redis flag 方案）。若最終選 DB 欄位方案，才需為 `Tenant` 新增 `quotaAlertsSent Json @default("{}")` 並產正式 migration（依專案規則不可只 db push）。
2. 部署順序：API 先部署（含 event 定義、偵測、email 模板、eventBus 訂閱）。Worker 無需改動（複用既有 `notification:dispatch`）。
3. **回滾**：移除 eventBus publish 呼叫（或以 feature flag／env `USAGE_QUOTA_ALERTS_ENABLED` 包住 publish）即可停用告警，計數器與硬擋不受影響。建議上線初期以 env flag 保護。
4. **驗證**：本機以 `EMAIL_DELIVERY_MODE=log` 觀察 email 內容；壓低某測試租戶 `limitOverrides.monthlyTokens` 到很小值，連續打 AI 觀察站內＋log 出現 warning→critical 各一次、重打不再重發。

## Open Questions

- 是否需要在平台端 `platform-usage`（`apps/api/src/modules/platform/platform.routes.ts` 的 `/usage/*`）標記 over-quota／已告警狀態供平台方檢視？（傾向列為 optional task，先不阻塞本 change。）
- 是否需持久化「已發告警」供審計（DB 記錄一列）？目前僅 Redis flag，無持久審計。若合規需要再補。
- warning 門檻是否要可由平台方 per-plan 設定？本版寫死，預留常數。
- `clickUrl` 應指向哪個前端頁面（租戶端用量頁是否存在）？需確認 apps/web 是否有對應租戶用量畫面，否則暫指向方案說明頁。
