# Tasks: ai-usage-tracking

## 1. 資料模型

- [x] 1.1 schema.prisma 新增 `AiUsage` model（tenantId、provider、model、feature、promptTokens、cachedTokens、candidatesTokens、thoughtsTokens、totalTokens、costUsd Decimal(12,8)、success、usageMissing、errorCode?、conversationId?、caseId?、createdAt；索引 (tenantId, createdAt)、(tenantId, feature)；註解 soft reference 不設 FK cascade）
- [x] 1.2 schema.prisma 新增 `ModelPricing` model（model、inputPer1M、outputPer1M、cachedPer1M、tierThreshold?、tierInputPer1M?、tierOutputPer1M?、effectiveFrom，全 Decimal；@@unique([model, effectiveFrom])；註解「平台層全域資料，刻意不帶 tenantId」）
- [x] 1.3 `prisma migrate dev` 產正式 migration SQL（不可只 db push），`prisma generate`
- [x] 1.4 seed 補 ModelPricing 現行 Gemini 價目（2.5-flash 0.30/2.50/0.03、2.5-flash-lite 0.10/0.40/0.01、2.5-pro 1.25/10.00/0.125 + tier 200000→2.50/15.00），upsert 確保 idempotent

## 2. Provider 介面與實作

- [x] 2.1 `types.ts`：新增 `TokenUsage` 與 `ChatGenerateResult { text, usage? }`，`generate()` 回傳型別改 `Promise<ChatGenerateResult>`
- [x] 2.2 `gemini.provider.ts`：成功路徑從 `usageMetadata` 組 usage（各欄 `?? 0`，cachedContentTokenCount→cachedTokens）回傳 `{ text, usage }`；欄位缺漏時與 totalTokenCount 交叉檢查、偏差>10% log warning
- [x] 2.3 `ollama.provider.ts`：從 `prompt_eval_count`/`eval_count` 組 usage；欄位不存在時回 `usage: undefined`

## 3. 成本計算與落地

- [x] 3.1 新增 `modules/ai/pricing.service.ts`：`getPricing(model)`（effectiveFrom<=now 最新列、進程內快取 10 分鐘）＋ `calcCostUsd(usage, pricing)`（Decimal 全程、含 cached 扣除與 tier 判斷；ollama 直接 0；查無價目回 null）
- [x] 3.2 `llm.service.ts`：`generateReply()` 增加可選 `meta { feature, conversationId?, caseId? }` 參數；provider 回傳後 fire-and-forget 寫 `AiUsage`（不 await、`.catch(log)`）；provider 拋錯時 catch 中寫 `success=false` 記錄後原樣 rethrow；對外回傳簽名不變（內部取 `.text`）
- [x] 3.3 五個呼叫端傳入 feature：kb-autoreply.service（3 處）、ai.service（回覆+summary 2 處）、classify.service、sentiment.service、automation action-executor，並帶 conversationId/caseId（有值時）

## 4. 驗證

- [x] 4.1 typecheck 全過（確認 provider 簽名變更無漏改）
- [x] 4.2 本機端到端：WEBCHAT 觸發 KB 自動回覆（Gemini），確認 AiUsage 落一筆且 costUsd 與手算一致（含 thinking token）；再以 ollama provider 驗 cost=0
- [x] 4.3 異常路徑：改壞 GEMINI_API_KEY 觸發失敗呼叫，確認 success=false 記錄且上游錯誤行為不變
- [x] 4.4 pricing 快取與改價：SQL 新增一列新價，10 分鐘內舊價、之後新價；歷史列 costUsd 不變
