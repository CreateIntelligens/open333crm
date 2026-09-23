# 用量統計

跨租戶與單一租戶的 AI 用量與成本統計。

- **資料來源**：`apps/api/src/modules/platform/platform-usage.service.ts`、`apps/api/src/modules/ai/pricing.service.ts`、`llm.service.ts`
- **核對日期**：2026-09-23

## 三個查詢

三個端點都查同一張 `ai_usages`，預設區間都是最近 30 天，由 query 的 `from` 與 `to` 覆寫。

| 端點 | 回傳 | 限制 |
| --- | --- | --- |
| `GET /usage/overview` | 全系統的 token、成本、呼叫數，加上各 provider 的佔比與有用量的租戶數 | 無 |
| `GET /usage/tenants` | 各租戶排行，依 token 由多到少 | 只取前 50 名 |
| `GET /usage/tenants/:tenantId` | 單一租戶的每日趨勢與各 feature 分佈 | 每日趨勢用 `$queryRaw` 的 `date_trunc`，Prisma 的 `groupBy` 不能截斷日期 |

排行只有前 50 名，所以把排行的數字加起來不會等於總覽的數字。租戶數多於 50 時，差額落在沒進榜的那些租戶身上。

## 哪些呼叫不算

三個查詢的 `where` 都有 `success: true`，**失敗的呼叫完全不計入，連呼叫次數也不算**。`totalCalls` 算的是成功次數，不是總嘗試次數。

（`platform-usage.service.ts` 開頭的註解寫「失敗成本為 0，計入次數但不計 token/cost」。這句與實作不符，以 `where` 為準。）

下面這些呼叫會進統計，但成本是 0：

| 情況 | `costUsd` | 原因 |
| --- | --- | --- |
| provider 是 `ollama` | 0 | 本機模型，不查價目表 |
| `keySource` 是 `byok` | 0 | 租戶自備金鑰，成本不歸平台 |
| 查不到價目 | 0，並標記 `usageMissing` | `ModelPricing` 沒有這個 model 的價目，log 會留一則 warn |
| provider 沒回傳用量 | 0，並標記 `usageMissing` | token 數也是 0，不是真實值 |

**平台的三個查詢都不看 `usageMissing`，也不分 `keySource`。** 看到的成本因此是「平台實際付的錢」的下限：BYOK 的呼叫與查無價目的呼叫都以 0 併進去，而它們的 token 數仍然計入總量。要分辨得自己查 `ai_usages`。

## 成本怎麼算出來的

成本在寫入 `AiUsage` 的當下就算好，之後不再重算。**改價不回溯歷史帳**，價目表調整只影響之後的呼叫。

計算在 `calcCostUsd()`：

```text
成本 = (prompt − cached) × input 單價
     + cached × cached 單價
     + (candidates + thoughts) × output 單價
     ÷ 1,000,000
```

三個細節：

- `cachedTokens` 是 `promptTokens` 的子集，要先扣掉才不會重複計價。
- thinking token（`thoughtsTokens`）按 output 單價算，這是 Google 的計費規則。
- 該 model 的價目設了 `tierThreshold`，而 `promptTokens` 超過門檻時，**整筆**改用 tier 單價，不是只有超出的部分。

金額全程用 `Prisma.Decimal`，欄位是 `Decimal(12, 8)`，API 回傳的也是字串。前端只負責顯示，不對字串做加總。

## 價目表沒有維護介面

`ModelPricing` 以 `(model, effectiveFrom)` 版本化，查價取 `effectiveFrom <= now` 的最新一列。但是：

- **平台後台沒有任何路由或頁面能編輯它。** 整個 repo 只有 `packages/database/prisma/seed.ts` 會寫入，調價要改 seed 或直接改資料庫。
- 查價結果在 API 行程內快取 10 分鐘。直接改資料庫之後，最久要等 10 分鐘才會套用到新的呼叫，而且 `clearPricingCache()` 沒有對外的端點可以呼叫。多個 API 行程時，每個行程各自快取。

## 這裡的數字不等於額度用掉的數字

兩邊的母體不同，不要互相驗算：

| | 平台用量統計 | AI 月額度 |
| --- | --- | --- |
| 條件 | `success` | `success` 且 `keySource = 'platform'` |
| 區間 | 呼叫端指定，預設最近 30 天 | 當月，UTC 月初起算 |
| 來源 | 每次都查資料庫 | Redis 計數器，miss 時從資料庫回填 |

BYOK 的呼叫出現在用量統計裡，但不計入額度，也不會被額度擋下。額度的判斷見 `apps/api/src/modules/trial/token-quota.service.ts`。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
