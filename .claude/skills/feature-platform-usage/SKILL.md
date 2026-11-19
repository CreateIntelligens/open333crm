---
name: feature-platform-usage
description: >
  open333CRM「用量統計與 AI 成本」功能顧問：/admin/usage、ai_usages 用量紀錄、模型價目與成本、AI 月額度與告警。改到 platform-usage.service、token-quota.service、pricing.service、recordLlmUsage、llm.flow，或新增呼叫 LLM 的功能之前使用。
---

# 用量統計與 AI 成本

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。用量與成本的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

平台後台 `/admin/usage` 用量統計（總覽、租戶排行、單一租戶每日趨勢）、AI 用量紀錄 `ai_usages`（`AiUsage`）、
模型價目 `model_pricings`（`ModelPricing`）與成本計算、BYOK 自備金鑰的成本歸屬、
AI 月額度（`monthlyTokens`、Redis 計數器 `aiquota:*`、`PLAN_LIMIT_EXCEEDED`）、用量告警 80%／100%（`usage.quota.threshold`、站內通知與 email）、月額度每月重置。
常見的說法：「AI 用量」「token 用完」「額度用完 AI 不回」「用量告警沒收到」「成本算錯」「用量頁數字對不起來」「加價目」「新模型」。
改 `platform-usage.service`、`token-quota.service`、`pricing.service`、`recordLlmUsage`、`llm.flow` 之前使用。新增任何會呼叫 LLM 的功能、改 AI 模型清單、改方案額度之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/platform/USAGE.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `USAGE.md` 的章節 |
| --- | --- |
| 找路由與函式、新增呼叫 LLM 的程式 | 程式的入口 |
| `/usage/*` 端點的回傳、區間、每日趨勢 | 每個端點回傳什麼、每日趨勢的分日 |
| 失敗的呼叫、成本為 0 的呼叫、BYOK | 哪些呼叫不算 |
| 記帳、計數器、告警與收件人 | AI 呼叫怎麼記帳 |
| 成本公式、Decimal | 成本怎麼算出來的 |
| 價目表、新增模型 | 價目表沒有維護介面；`docs/ref/features/platform/SETTINGS.md` 的「模型價目」 |
| 月額度、台灣月份、告警旗標、額度用完時各功能的行為 | 這裡的數字不等於額度用掉的數字 |
| `/admin/usage` 頁面 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/ai/`、`apps/api/tests/unit/modules/notification/`、`apps/api/tests/feature/modules/platform/`、`apps/web/tests/unit/app/admin/`，寫法可以照著參考。

`USAGE.md` 裡標 `HC-PLATFORM-USAGE-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-USAGE.md`
- 規格：`openspec/specs/ai-usage-recording/spec.md`、`openspec/specs/model-pricing/spec.md`、`openspec/specs/platform-usage/spec.md`、`openspec/specs/token-quota/spec.md`、`openspec/specs/usage-quota-alerts/spec.md`
- 已知問題：`docs/ref/system/AUDIT.md` 的 AI-01、USAGE-01、USAGE-02、USAGE-03、PLAN-10
- 影響分析：`node scripts/feature-impact.mjs --domain platform-usage`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `USAGE.md` 括號內的章節。

- 新增任何呼叫 LLM 的程式，都要經過 `llm.flow.ts`：`generateReply()`，或 `prepareLlmCall()` 加上 `runLlmCall()`、`recordLlmUsage()`。`AiFeature` 列舉要加新的來源標記。（程式的入口）
- 成本在寫入當下定版，改價不回溯。查無價目記 0 並標 `usageMissing`，之後不會重算。（成本怎麼算出來的）
- 在 `gemini.provider.ts` 的 `CURATED_CHAT_MODELS` 加模型時，一定要同時在 `packages/database/prisma/seed.ts` 的 `seedModelPricing()` 加價目。（價目表沒有維護介面）
- `cachedTokens` 是 `promptTokens` 的子集；`totalTokens = prompt + candidates + thoughts`，不要再加 cached。thinking token 按 output 單價。超過 `tierThreshold` 整筆換 tier 價。（成本怎麼算出來的）
- 金額全程用 `Prisma.Decimal`，欄位 `Decimal(12,8)`，API 回字串。前端只顯示、不加總。（成本怎麼算出來的）
- 計數器只累加成功、而且 `keySource=platform` 的呼叫；BYOK 不計、不擋、不告警。資料庫回填（`readMonthlyTokensFromDb`）要用同一組條件。（這裡的數字不等於額度用掉的數字）
- 月額度、告警旗標與每日趨勢都用台灣時間（`Asia/Taipei`）。改月份或分日的算法時，計數器 key、`monthStart()`、告警旗標、信件的 `monthKey` 要一起改，並改規格。（這裡的數字不等於額度用掉的數字、每日趨勢的分日）
- 會提高月額度的入口要清除告警旗標：核准加購一律清除；其他入口只在上限提高時清除（`monthlyTokensRaisedByPlanChange()`）。（這裡的數字不等於額度用掉的數字）
- 用量紀錄、累加與告警在回覆之前完成，每一步失敗都只寫 log，不能讓 AI 回覆失敗。token-quota 的 Redis 由呼叫端傳入，API 行程用 `fastify.redis`。（AI 呼叫怎麼記帳）
- `apps/api/verify-quota.mts` 會清除 Demo 租戶的計數器並累加假用量，**不要在共用環境或 UAT 執行**。（這裡的數字不等於額度用掉的數字）

## 回歸清單

改到本領域時，至少重走下列項目。**不要動 Demo 租戶的計數器與方案**，測額度用完一律用自建租戶。

1. 記帳：
   - 自建 `hc-` 前綴的租戶（`POST /platform/tenants`，方案 `light`）。
   - 把它的 AI 設定指到假的 Ollama（回 `prompt_eval_count`、`eval_count`），打 `POST /ai/rewrite`。
   - `ai_usages` 有一筆。Redis 計數器等於 totalTokens，TTL 到台灣下個月 1 日 00:00。
2. 讓用量剛好跨 80% 再跨 100%：各有一則站內通知、一封信（`EMAIL_DELIVERY_MODE=log` 時看 API log）。之後的 AI 呼叫回 403 `PLAN_LIMIT_EXCEEDED`。
3. 刪掉自建租戶的計數器，再呼叫一次：計數器從 `ai_usages` 補建，只含本月（台灣月份）成功的平台金鑰呼叫。
4. `/admin/usage` 的總覽、排行、鑽取的數字與 psql 加總一致：`select sum("totalTokens"), sum("costUsd") from ai_usages where success and "createdAt" between ...`。
5. 用 seed 的 supervisor、agent 的 token 打 `/platform/usage/*`，回 401。

自動測試：

- `pnpm --filter @open333crm/api test -- pricing usage-quota agent-quota usage-quota-alert plan-change notification.worker`
- `pnpm --filter @open333crm/web test -- usage-page usage-range`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/platform/platform-usage modules/trial/token-quota-alert`
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`（只開頁）。

## 常見 bug 從哪裡查

- 「AI 突然都不回」：
  - 先查有沒有用完額度（403 `PLAN_LIMIT_EXCEEDED`）。
  - Redis `GET aiquota:{tenantId}:{YYYY-MM}:tpe`（台灣月份），對照有效上限（`tenants.limitOverrides.monthlyTokens ?? plans.limits.monthlyTokens`，加上本月的加購）。
  - 租戶後台看不到用量（HC-PLATFORM-USAGE-02），只能查 Redis 或 `ai_usages`。
- 「用量頁成本是 0 或偏低」：
  - 查 `ai_usages` 的 `keySource`（BYOK 記 0）、`usageMissing`（查無價目記 0）、`provider=ollama`（記 0）。
  - 再查該 model 在 `model_pricings` 有沒有價目（HC-PLATFORM-USAGE-01）。價目快取 10 分鐘（`apps/api/src/modules/ai/pricing.service.ts`）。
- 「用量頁空白、顯示尚無用量資料」：
  - 可能是 API 失敗，頁面不顯示錯誤（HC-PLATFORM-USAGE-03）。
  - 也可能該期間只有失敗的呼叫，失敗不計入。用 `select success, count(*) from ai_usages ...` 分辨。
- 「告警沒收到」：
  - 查旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:warning|critical` 是否已存在。存在就是本月發過；換方案只在月額度提高時清除旗標。
  - 收件人只有 `role=ADMIN` 而且啟用的成員（HC-PLATFORM-USAGE-08）。
  - 信件在 `usage-alert-email` 佇列（`apps/api/src/modules/notification/usage-alert-email.worker.ts`）。
- 「用量對不起來、超用」：計數器少算的情況見 AUDIT USAGE-03；BYOK 金鑰解密失敗退回平台金鑰見 AI-01。
- 「摘要內容和對話無關」：額度用完或 LLM 失敗時，摘要是固定的範本文字（HC-PLATFORM-USAGE-04）。
