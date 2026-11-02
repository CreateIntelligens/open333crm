---
name: feature-platform-usage
description: >
  open333CRM「用量統計與 AI 成本」功能顧問：平台後台 /admin/usage 用量統計（總覽、租戶排行、單一租戶每日趨勢）、
  AI 用量紀錄 ai_usages（AiUsage）、模型價目 model_pricings（ModelPricing）與成本計算、BYOK 自備金鑰成本歸屬、
  AI 月額度（monthlyTokens、Redis 計數器 aiquota:*、PLAN_LIMIT_EXCEEDED）、用量告警 80%／100%（usage.quota.threshold、
  站內通知＋email）、月額度每月重置（UTC 月份）。當需求、bug 或新功能碰到「AI 用量」「token 用完」「額度用完 AI 不回」
  「用量告警沒收到」「成本算錯」「用量頁數字對不起來」「加價目」「新模型」「platform-usage.service」「token-quota.service」
  「pricing.service」「recordAiUsage」時使用。也在新增任何會呼叫 LLM 的功能、改 AI 模型清單、改方案額度前使用。
---

# 用量統計與 AI 成本

## 先讀
- 功能現況（以它為準）：`docs/ref/features/platform/USAGE.md`
  - 注意：其中「`resolveGeminiKey()` 依序找租戶自填的金鑰、平台代設的金鑰、全域 `GEMINI_API_KEY`」已過時，程式只有兩層（租戶自填、全域 env），見健檢「文件過時之處」。
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-USAGE.md`
- 規格：`openspec/specs/ai-usage-recording/spec.md`、`openspec/specs/model-pricing/spec.md`、`openspec/specs/platform-usage/spec.md`、`openspec/specs/token-quota/spec.md`、`openspec/specs/usage-quota-alerts/spec.md`
- 已知問題：`docs/ref/system/AUDIT.md` 的 AI-01、USAGE-01、USAGE-02、USAGE-03、PLAN-13、PLAN-10
- 影響分析：`node scripts/feature-impact.mjs --domain platform-usage`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 平台用量總覽 | `/admin/usage`，「近 7／30／90 天」按鈕 | `GET /platform/usage/overview?from&to` → `getUsageOverview` | 無。只算 `success=true`；token 含 BYOK 與查無價目，成本不含（USAGE-01） | 平台 token（`platform.routes.ts` 的 guard）；租戶 token 401 |
| 2 | 租戶排行 | 同頁表格 | `GET /platform/usage/tenants?from&to` → `getTenantUsageRanking`（`take: 50`） | 無。全部呼叫都失敗的租戶不會出現 | 同上 |
| 3 | 單一租戶鑽取 | 點排行列 | `GET /platform/usage/tenants/:tenantId?from&to` → `getTenantUsageDetail`（`date_trunc('day')`，**UTC 日**） | 無。只列有資料的日子，沒有用量的日子不補 0 | 同上；切換天數會收起鑽取 |
| 4 | AI 呼叫記帳（系統） | 任何經 `generateReply()` 或 Agent 的 AI 功能（自動回覆、建議回覆、摘要、分類、情緒、潤稿、Flex 生成、Agent） | `llm.service.ts` 的 `recordAiUsage()` | 寫一筆 `ai_usages`；成功且非 BYOK 時以寫入當下的價目算成本；fire-and-forget 累加 Redis `aiquota:{tenantId}:{YYYY-MM}` | — |
| 5 | 月額度硬擋（系統） | 同上，呼叫 LLM 之前 | `isMonthlyTokenExceeded()`：計數器 ≥ 有效 `monthlyTokens` | 403 `PLAN_LIMIT_EXCEEDED`、`details.limitKey=monthlyTokens`；不呼叫 LLM、不寫 `ai_usages`。潤稿與 Agent 回 403；分類與情緒分析改用關鍵字降級、建議回覆改回知識庫原文、摘要回固定範本文字（HC-PLATFORM-USAGE-04），這四個都回 200、不告訴使用者是額度用完 | BYOK 與無上限不擋；Ollama 也計入、也會被擋 |
| 6 | 用量告警（系統） | 累加後跨越 80%、100% | `checkQuotaThresholdCrossing()`（`SET NX` 旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`）→ 事件 `usage.quota.threshold` → `notification.worker.ts` | 每位 `role=ADMIN` 且啟用的成員：站內通知 `usage_quota_warning`／`usage_quota_critical`（連到 `/dashboard/plan`）＋一封信（`usage-alert-email` 佇列）。`USAGE_QUOTA_ALERTS_ENABLED=0` 時不發 | 依角色列舉 `ADMIN`，不是權限點 |
| 7 | 租戶查看用量 | 告警信「查看用量與方案」、通知點擊 → `/dashboard/plan` | `GET /plan-change` | **頁面只有申請表與申請紀錄，不顯示目前方案、已用量、上限**（PLAN-10、HC-PLATFORM-USAGE-02） | `settings.manage` / 側欄依權限隱藏 |

**有後端、沒有前端入口**：`ModelPricing` 沒有任何讀寫路由（只有 seed 寫入，USAGE-02）；`clearPricingCache()` 沒有呼叫端；租戶本月已用 token 與上限沒有任何 API（租戶端、平台端都沒有）；`ai_usages` 的 `usageMissing`、`keySource`、失敗筆數沒有任何查詢端。

**前端實際送出的值**：`/admin/usage` 送 `from`、`to` 為 `new Date(now - days*86400000).toISOString()`（滾動視窗，不是對齊台灣日界）；後端 `z.coerce.date()`，不檢查 `from <= to`、不檢查 `tenantId` 是 UUID（亂碼回 400 `DATABASE_ERROR`）。

## 不可破壞的規則
- **新增任何呼叫 LLM 的程式，都要經 `generateReply()` 或在呼叫後自己 `recordAiUsage()`**，並在呼叫前檢查 `isMonthlyTokenExceeded()`（只對 `keySource=platform`）。繞過的呼叫不記帳、不計額度、不會被擋。`AiFeature` 列舉要加新的來源標記。
- 成本在寫入當下定版，**改價不回溯**；查無價目記 0 並標 `usageMissing`，之後不會重算。新增 model 到下拉清單（`gemini.provider.ts` 的 `CURATED_CHAT_MODELS`）時，一定要同時在 `packages/database/prisma/seed.ts` 的 `seedModelPricing()` 加價目，否則平台金鑰的呼叫成本永久是 0（HC-PLATFORM-USAGE-01）。
- `cachedTokens` 是 `promptTokens` 的子集；`totalTokens = prompt + candidates + thoughts`，不要再加 cached。thinking token 按 output 單價。超過 `tierThreshold` 整筆換 tier 價。
- 金額全程 `Prisma.Decimal`，欄位 `Decimal(12,8)`，API 回字串；前端只顯示、不加總。
- 計數器只累加「成功且 `keySource=platform`」的呼叫；BYOK 不計、不擋、不告警。資料庫回填（`dbMonthlyTokens`）也要用同一組條件，兩邊母體不一致會讓額度判斷錯。
- 月份一律用 **UTC**（規格 `token-quota` 明定）：台灣時間每月 1 日 08:00 才換月，1 日 00:00–08:00 的用量算上個月。平台每日趨勢也是 UTC 日。要改成台灣時間，計數器 key、`monthStart()`、告警旗標、信件的 `monthKey`、`date_trunc` 要一起改，並改規格。
- 告警旗標到月底才過期。任何「提高月額度」的操作要考慮清旗標（目前只有核准加購會清，PLAN-13）；清計數器（`clearTokenQuotaCache`）會讓下一次讀取從 `ai_usages` 補建。
- `recordAiUsage()` 與累加都是 fire-and-forget，失敗只寫 log，不能讓 AI 回覆失敗；但呼叫端若傳入 `withTenant` 的 `tx`，交易結束後背景工作會用到已關閉的交易（A2A 路徑），見健檢 HC-PLATFORM-USAGE-06。
- `apps/api/verify-quota.mts` 會清 Demo 租戶的計數器並累加假用量，**不要在共用環境或 UAT 執行**。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-usage` 看最新版本。重點：
- **依賴**：知識庫／AI 模組（`llm.service.ts`、Agent、`ai-key.service.ts` 的 BYOK）、方案（`plan-limits.service.ts` 的有效 `monthlyTokens`）、方案異動（核准加購清計數器與旗標）、通知（`notification.worker.ts`、`usage-alert-email` 佇列）、設定（租戶的 provider、model、自備金鑰）。
- **被依賴**：所有 AI 功能（自動回覆、Agent、建議回覆、摘要、分類、情緒、素材潤稿、Flex 生成）在額度用完時被擋或降級；租戶端 `/dashboard/plan` 是告警的落地頁。

## 回歸清單
改到本領域時，至少重走：
1. 自建 `hc-` 前綴租戶（`POST /platform/tenants`，方案 `light`），把它的 AI 設定指到假的 Ollama（回 `prompt_eval_count`／`eval_count`），打 `POST /ai/rewrite`：`ai_usages` 有一筆、Redis 計數器等於 totalTokens、TTL 到下個月 1 日 00:00 UTC。
2. 讓用量剛好跨 80% 再跨 100%：各一則站內通知、各一封信（`EMAIL_DELIVERY_MODE=log` 時看 API log），之後的 AI 呼叫回 403 `PLAN_LIMIT_EXCEEDED`。
3. 刪掉自己租戶的計數器再呼叫一次：計數器從 `ai_usages` 補建，只含本月（UTC）成功的平台金鑰呼叫。
4. `/admin/usage` 的總覽、排行、鑽取數字與 psql 加總一致（`select sum("totalTokens"), sum("costUsd") from ai_usages where success and "createdAt" between ...`）。
5. 用 seed 的 supervisor、agent 打 `/platform/usage/*` 要 401。
- 自動測試：`pnpm --filter @open333crm/api test -- pricing usage-quota agent-quota usage-quota-alert plan-change notification.worker`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/platform/platform-usage modules/trial/token-quota-alert`。
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`（只開頁）。
- **不要動 Demo 租戶的計數器與方案**；測額度用完一律自建租戶。

## 常見 bug 從哪裡查
- 「AI 突然都不回」：先查有沒有用完額度（403 `PLAN_LIMIT_EXCEEDED`）。Redis `GET aiquota:{tenantId}:{YYYY-MM}`（UTC 月）對照有效上限（`tenants.limitOverrides.monthlyTokens ?? plans.limits.monthlyTokens`）。租戶後台看不到用量，只能查 Redis 或 `ai_usages`。
- 「用量頁成本是 0 或偏低」：查 `ai_usages` 的 `keySource`（BYOK 記 0）、`usageMissing`（查無價目記 0）、`provider=ollama`（記 0）；再查該 model 在 `model_pricings` 有沒有價目。價目快取 10 分鐘（`apps/api/src/modules/ai/pricing.service.ts`）。
- 「用量頁空白、顯示尚無用量資料」：可能是 API 失敗（頁面不顯示錯誤，HC-PLATFORM-USAGE-03），也可能該期間只有失敗的呼叫（失敗不計入）。用 `select success, count(*) from ai_usages ...` 分辨。
- 「告警沒收到」：查旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:warning|critical` 是否已存在（本月發過、或換方案前發過，PLAN-13）；收件人只有 `role=ADMIN` 且啟用的成員；信件在 `usage-alert-email` 佇列（`apps/api/src/modules/notification/usage-alert-email.worker.ts`）。
- 「用量對不起來、超用」：計數器少算的三種情況見 AUDIT USAGE-03；BYOK 金鑰解密失敗退回平台金鑰見 AI-01。
- 「某天的用量算到前一天」：每日趨勢是 UTC 日（`apps/api/src/modules/platform/platform-usage.service.ts` 的 `date_trunc('day', "createdAt")`），台灣 00:00–08:00 的呼叫落在前一天。
