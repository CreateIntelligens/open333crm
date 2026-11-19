# 用量統計

跨租戶與單一租戶的 AI 用量與成本統計。

- **資料來源**：`apps/api/src/modules/platform/platform-usage.service.ts`、`apps/api/src/modules/ai/pricing.service.ts`、`llm.service.ts`、`llm.flow.ts`、`apps/api/src/modules/trial/token-quota.service.ts`、`apps/web/src/app/admin/usage/page.tsx`
- **核對日期**：2026-11-19

## 程式的入口

| 入口 | 函式 |
| --- | --- |
| `GET /api/v1/platform/usage/overview` | `platform-usage.service.ts` 的 `getUsageOverview()` |
| `GET /api/v1/platform/usage/tenants` | `getTenantUsageRanking()` |
| `GET /api/v1/platform/usage/tenants/:tenantId` | `getTenantUsageDetail()` |
| 呼叫 LLM 之前檢查月額度 | `apps/api/src/modules/ai/llm.flow.ts` 的 `prepareLlmCall()` → `token-quota.service.ts` 的 `isMonthlyTokenExceeded()` |
| 呼叫 LLM | `runLlmCall()`；一次完成檢查、呼叫與記帳的是 `generateReply()` |
| 記帳、累加計數器、告警 | `recordLlmUsage()` → `llm.service.ts` 的 `writeAiUsage()`、`incrMonthlyTokens()`、`claimCrossedThresholds()` |
| 查價與算成本 | `pricing.service.ts` 的 `getPricing()`、`calcCostUsd()` |
| 告警的通知與信件 | `apps/api/src/modules/notification/notification.worker.ts`、`usage-alert-email.worker.ts` |

`/platform/usage/*` 的路由在 `platform.routes.ts`，只接受平台 token，租戶 token 回 401。

新增任何呼叫 LLM 的程式，都要經過 `llm.flow.ts`：`generateReply()`，或 `prepareLlmCall()` 加上 `runLlmCall()`、`recordLlmUsage()`，並在 `llm.service.ts` 的 `AiFeature` 加上新的來源標記。繞過 `llm.flow.ts` 的呼叫不記帳、不計額度，也不會被額度擋下。

## 每個端點回傳什麼

這些端點都查同一張 `ai_usages`，預設區間都是最近 30 天（含今天）：從台灣今天往前 29 天的 00:00 到現在（`taipeiRecentDays(30)`），每日趨勢剛好 30 筆。由 query 的 `from` 與 `to` 覆寫。

| 端點 | 回傳 | 限制 |
| --- | --- | --- |
| `GET /usage/overview` | 全系統的 token、成本、呼叫數，加上各 provider 的佔比與有用量的租戶數 | 無 |
| `GET /usage/tenants` | 各租戶排行，依 token 由多到少 | 只取前 50 名 |
| `GET /usage/tenants/:tenantId` | 單一租戶的每日趨勢與各 feature 分佈 | 每日趨勢用 `$queryRaw` 依台灣日期分組（Prisma 的 `groupBy` 不能截斷日期），再補齊期間內每一天，見下方「每日趨勢的分日」 |

`from`、`to` 以 `z.coerce.date()` 解析，不檢查 `from` 早於 `to`：`from` 晚於 `to` 時回全 0。`:tenantId` 不檢查是不是 UUID，亂碼回 400 `DATABASE_ERROR`（HC-PLATFORM-USAGE-10）。全部呼叫都失敗的租戶不出現在排行（HC-PLATFORM-USAGE-07）。

### 每日趨勢的分日

- `trend` 以台灣時間（`Asia/Taipei`）的日期分日，`day` 是台灣日期。台灣 00:00–08:00 的呼叫算在台灣當天。
- 期間內從 `from` 的台灣日期到 `to` 的台灣日期每天一筆，依日期排序；沒有用量的日子 `tokens: 0`、`costUsd: "0"`、`calls: 0`。期間超過 400 天時只列有用量的日子（`MAX_TREND_DAYS`，與券統計相同）。
- 期間的過濾與總覽、排行相同（同一組 `from`、`to` 時間點），只有分日方式不同，所以趨勢加總等於該租戶在排行中的數字。頭尾兩天可能不足一整天。
- `/admin/usage` 的「近 N 天」送出的區間是台灣今天往前 N−1 天的 00:00 到現在（`apps/web/src/app/admin/lib/usage-range.ts`），三個查詢共用，趨勢剛好 N 格。公式與後端預設期間相同；web 不依賴 core，由 `apps/web/tests/unit/app/admin/usage-range.test.ts` 比對兩者。沒有用量的日子不畫長條，但仍佔一格。
- AI 月額度也以台灣月份計算（見下方「這裡的數字不等於額度用掉的數字」）。

排行只有前 50 名，所以把排行的數字加起來不會等於總覽的數字。租戶數多於 50 時，差額落在沒進榜的那些租戶身上。介面沒有標示這個上限，見 `../../system/AUDIT.md` 的 USAGE-01。

## 哪些呼叫不算

這些查詢的 `where` 都有 `success: true`，**失敗的呼叫完全不計入，連呼叫次數也不算**。`totalCalls` 算的是成功次數，不是總嘗試次數。

（`platform-usage.service.ts` 開頭的註解寫「失敗成本為 0，計入次數但不計 token/cost」。這句與實作不符，以 `where` 為準。`/admin/usage` 的頁首與卡片副標寫的是「僅計成功呼叫」，與實作一致。）

下面這些呼叫會進統計，但成本是 0：

| 情況 | `costUsd` | 原因 |
| --- | --- | --- |
| provider 是 `ollama` | 0 | 本機模型，不查價目表 |
| `keySource` 是 `byok` | 0 | 租戶自備金鑰，成本不歸平台 |
| 查不到價目 | 0，並標記 `usageMissing` | `ModelPricing` 沒有這個 model 的價目，log 會留一則 warn |
| provider 沒回傳用量 | 0，並標記 `usageMissing` | token 數也是 0，不是真實值 |

BYOK 是 Bring Your Own Key，指租戶自備 API 金鑰。這個系統只有 Gemini 支援：租戶在自己的後台填入金鑰，密文存 `TenantSettings.geminiApiKeyEnc`。`resolveGeminiKey()` 先找租戶自填的金鑰，回傳 `keySource = 'byok'`；沒有或解密失敗時用全域的 `GEMINI_API_KEY`，回傳 `keySource = 'platform'`。BYOK 的呼叫由 Google 直接向租戶收費，平台不經手，所以 `costUsd` 記 0。

租戶金鑰解密失敗時會靜默退回平台金鑰，連帶改變成本歸屬與額度計算，見 `../../system/AUDIT.md` 的 AI-01。

**平台這些查詢都不看 `usageMissing`，也不分 `keySource`。** 看到的成本因此是「平台實際付的錢」的下限：BYOK 的呼叫與查無價目的呼叫都以 0 併進去，而它們的 token 數仍然計入總量。要分辨得自己查 `ai_usages`。

因此「總 AI Token」與「總成本」兩張卡的母體不同，而介面只在成本那張標了「不含 BYOK」，見 `../../system/AUDIT.md` 的 USAGE-01。

## AI 呼叫怎麼記帳

每次 AI 呼叫，`recordLlmUsage()` 依序做下列事情，全部完成之後才把回覆交給呼叫端：

1. 在一個租戶交易內寫一筆 `ai_usages`（`writeAiUsage()`）。成功而且不是 BYOK 的呼叫，以寫入當下的價目算成本。寫入失敗時只寫 log，不補寫，計數器也不累加。
2. commit 之後，累加 Redis 計數器（`incrMonthlyTokens()`）。計數器只累加成功、而且 `keySource = 'platform'` 的呼叫。
3. 累加之後跨越 80% 或 100% 時，以 `SET NX` 寫入告警旗標（`claimCrossedThresholds()`），寫入成功的門檻才在另一個交易把 `usage.quota.threshold` 寫進 outbox。outbox 寫入失敗只寫 log；旗標已經寫入，這個月不再發這個門檻的告警（主規格 `usage-quota-alerts`）。

每一步失敗都只寫 log，不讓 AI 回覆失敗。token-quota 的 Redis 由呼叫端傳入，API 行程用 `fastify.redis`。`USAGE_QUOTA_ALERTS_ENABLED=0` 時不發告警。

`notification.worker.ts` 收到 `usage.quota.threshold` 之後，對該租戶每位 `role=ADMIN` 而且啟用的成員發站內通知 `usage_quota_warning` 或 `usage_quota_critical`（連到 `/dashboard/plan`），並經 `usage-alert-email` 佇列寄一封信。收件人看舊的角色列舉，不看權限：有 `settings.manage` 的 supervisor 能開 `/dashboard/plan`，卻收不到告警（HC-PLATFORM-USAGE-08）。

`/dashboard/plan` 只有升級與加購的申請表和申請紀錄，不顯示目前方案、本月已用量與上限。系統也沒有任何 API 回傳「本月已用／有效上限」，租戶端與平台端都沒有（HC-PLATFORM-USAGE-02）。要知道用量，只能查 Redis 計數器或 `ai_usages`。

`ai_usages` 的 `usageMissing`、`keySource` 與失敗的筆數沒有任何查詢端。

## 成本怎麼算出來的

成本在寫入 `AiUsage` 的當下就算好，之後不再重算。**改價不回溯歷史帳**，價目表調整只影響之後的呼叫。

計算在 `calcCostUsd()`：

```text
成本 = (prompt − cached) × input 單價
     + cached × cached 單價
     + (candidates + thoughts) × output 單價
     ÷ 1,000,000
```

自己驗算時容易弄錯的地方：

- `cachedTokens` 是 `promptTokens` 的子集，要先扣掉才不會重複計價。
- thinking token（`thoughtsTokens`）按 output 單價算，這是 Google 的計費規則。
- 該 model 的價目設了 `tierThreshold`，而 `promptTokens` 超過門檻時，**整筆**改用 tier 單價，不是只有超出的部分。換的是 input 與 output 兩個單價，cached 沒有分級價，一律用 `cachedPer1M`。

金額全程用 `Prisma.Decimal`，欄位是 `Decimal(12, 8)`，API 回傳的也是字串。前端只負責顯示，不對字串做加總。

## 價目表沒有維護介面

`ModelPricing` 以 `(model, effectiveFrom)` 版本化，查價取 `effectiveFrom <= now` 的最新一列。但是：

- **平台後台沒有任何路由或頁面能編輯它。** 整個 repo 只有 `packages/database/prisma/seed.ts` 的 `seedModelPricing()` 會寫入，調價要改 seed 或直接改資料庫。seed 以 `update: {}` 寫入，改價要新增一列較新的 `effectiveFrom`，見[平台設定](./SETTINGS.md#模型價目)。
- **新增模型要同時加價目。** 在模型下拉清單（`apps/api/src/modules/ai/providers/gemini.provider.ts` 的 `CURATED_CHAT_MODELS`）加模型時，也要在 `seedModelPricing()` 加價目。下拉清單的模型多於價目表，用平台金鑰呼叫缺價的模型，成本永久是 0（HC-PLATFORM-USAGE-01）。
- 查價結果在 API 行程內快取 10 分鐘，**查無價目的結果也一起快取**。直接改資料庫之後，最久要等 10 分鐘才會套用到新的呼叫，而且 `clearPricingCache()` 沒有對外的端點可以呼叫。多個 API 行程時，每個行程各自快取。
- seed 在 API 容器每次啟動時都會執行，改 seed 的價目再部署就會寫入，但這是改程式碼，不是平台方能自己做的調價。正式環境的 seed 只寫方案、價目與系統範本這類共用資料，不建 Demo 帳號（`seed-data/demo-accounts.ts`）。

成本在寫入時定版、之後不重算，所以缺價期間的呼叫成本永久是 0。修正方向見 `../../system/AUDIT.md` 的 USAGE-02。

## 這裡的數字不等於額度用掉的數字

兩邊的母體不同，不要互相驗算：

| | 平台用量統計 | AI 月額度 |
| --- | --- | --- |
| 條件 | `success` | `success` 且 `keySource = 'platform'` |
| 區間 | 呼叫端指定，預設台灣今天往前 29 天的 00:00 起 | 當月，台灣時間 1 日 00:00 起算 |
| 來源 | 每次都查資料庫 | Redis 計數器，miss 時從資料庫回填（`readMonthlyTokensFromDb()`，條件與左欄的「條件」列相同） |
| 上限 | — | 有效的 `monthlyTokens`：`tenants.limitOverrides.monthlyTokens ?? plans.limits.monthlyTokens`，加上本月已核准的加購（`plan-limits.service.ts`） |

計數器與回填必須用同一組條件。兩邊的母體不一致，額度的判斷就會錯。

AI 月額度的月份一律是台灣月份（`taipeiMonthString()`）：Redis 計數器 key 是 `aiquota:{tenantId}:{YYYY-MM}:tpe`，告警旗標是 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`，兩者都在台灣下個月 1 日 00:00 過期；告警站內通知與 email 的「本月（YYYY-MM）」也是台灣月份。系統不讀取沒有 `:tpe` 的 UTC 月份計數器 `aiquota:{tenantId}:{YYYY-MM}`（主規格 `token-quota`）。月份的計算在 `token-quota.service.ts` 的 `monthKey()` 與 `monthStart()`。

告警旗標到台灣下個月 1 日才過期。會提高月額度的操作都要清除旗標，讓提高之後能再次告警：

- 核准加購：一律清除，並清除計數器（`clearTokenQuotaCache()`、`clearQuotaAlertFlags()`）。計數器清除之後，下一次讀取從 `ai_usages` 回填。
- 核准升級、平台改租戶方案、試用轉正式、改方案的 `limits.monthlyTokens`：只在上限提高時清除（`monthlyTokensRaisedByPlanChange()`）。

新增會提高月額度的入口，也要照這個規則清除旗標。

`apps/api/verify-quota.mts` 會清除 Demo 租戶的計數器並累加假的用量。不要在共用環境或 UAT 執行。

系統在每次呼叫 LLM 之前檢查月額度：計數器大於或等於有效的 `monthlyTokens` 時，檢查丟出 403 `PLAN_LIMIT_EXCEEDED`，`details.limitKey` 是 `monthlyTokens`，系統不呼叫模型，也不寫 `ai_usages`。這個檢查只對平台金鑰的呼叫生效；BYOK 與無上限的租戶不擋。provider 是 Ollama 的呼叫也計入額度，也會被擋。各功能對這個錯誤的處理不同：

| 功能 | 額度用完時 |
| --- | --- |
| AI 潤稿、AI Agent | 回 403 `PLAN_LIMIT_EXCEEDED`，畫面顯示錯誤 |
| AI 建議回覆 | 回 200。每篇搜尋到的知識庫文章改用文章原文當作建議，不告訴使用者額度已用完 |
| 對話摘要 | 回 200。摘要改用一段固定的範本文字，內容與對話無關。自動轉真人時，這段文字會以「Bot 對話摘要」寫進對話的系統訊息（HC-PLATFORM-USAGE-04） |
| 情緒分析 | 改用關鍵字判斷 |
| 工單分類 | 改用關鍵字分類 |
| 知識庫自動回覆 | 轉真人，原因是「AI 月額度已用完」，見[知識庫與 AI](../tenant/KNOWLEDGE.md) |

BYOK 的呼叫出現在用量統計裡，但不計入額度，也不會被額度擋下。額度的判斷見 `apps/api/src/modules/trial/token-quota.service.ts`。計數器少算用量之後，當月不會校正，見 `../../system/AUDIT.md` 的 USAGE-03。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| `/admin/usage` 的「近 7／30／90 天」按鈕 | `GET /usage/overview`、`GET /usage/tenants`，帶 `from`、`to` | 區間由 `apps/web/src/app/admin/lib/usage-range.ts` 的 `usageRange()` 計算。切換天數時收起租戶鑽取 |
| 點排行的一列 → 租戶鑽取 | `GET /usage/tenants/:tenantId` | 每日趨勢與各 feature 分佈 |
| 上面任何一個請求失敗 | — | 請求都沒有 `catch`，畫面不顯示錯誤：總覽卡消失，排行顯示「此區間尚無用量資料」，鑽取的列變色但不出現趨勢（HC-PLATFORM-USAGE-03） |
| 告警信「查看用量與方案」、站內通知 → `/dashboard/plan` | `GET /plan-change` | 頁面不顯示用量與上限（HC-PLATFORM-USAGE-02） |

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
