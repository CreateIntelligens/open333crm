# Proposal: ai-usage-tracking

## Why

系統目前對 LLM token 用量**零記錄**：`gemini.provider.ts` 拿到回應的 `usageMetadata` 後直接丟棄（只在 MAX_TOKENS 錯誤訊息用一次），`ChatProvider.generate()` 只回傳純文字。沒有用量資料，就無法做租戶 AI 成本歸戶、方案 token 額度硬擋、跨租戶用量統計——這些是 platform-control-plane（平台計費）已定案規劃的共同前提。此 change 把「補 token 記錄」這塊前置工程獨立出來先做，不必等整個平台層。

## What Changes

- **BREAKING（內部介面）**：`ChatProvider.generate()` 回傳型別從 `Promise<string>` 改為 `Promise<ChatGenerateResult>`（`{ text, usage? }`）；gemini 與 ollama 兩個 provider 同步改。Gemini 從 `usageMetadata` 取 promptTokenCount / cachedContentTokenCount / candidatesTokenCount / thoughtsTokenCount；Ollama 從 `prompt_eval_count` / `eval_count` 取。呼叫端只在 `llm.service.ts` 一處，影響面可控。
- **新增 `AiUsage` 表**：每次 LLM 呼叫一筆——tenantId、provider、model、四類 token 數、成本快照 costUsd（Decimal）、feature 來源（kb-autoreply / summary / classify / sentiment / automation）、關聯 conversationId / caseId（nullable）、成功/失敗。失敗呼叫成本記 0 但保留次數（健康度指標用）。
- **新增 `ModelPricing` 表**：每模型單價參數化存 DB（inputPer1M / outputPer1M / cachedPer1M / 分級價門檻與高檔價 / effectiveFrom 版本化），改價新增一列不改舊列。Seed 現行 Gemini 價目；Ollama 本機模型單價 0。
- **統一落地點**：`llm.service.ts` 的 `generateReply()`（所有 AI 呼叫的唯一匯流點）在呼叫完成後計算成本並寫入 `AiUsage`。寫入為 fire-and-forget（不 await 阻塞回覆、寫入失敗只 log 不影響主流程）。
- 成本計算：`(prompt−cached)×input + cached×cached價 + (candidates+thoughts)×output`，thinking token 按 output 價；Pro 系列單筆 prompt 超過門檻整筆用高檔價。寫入時以當下 `ModelPricing` 快照計算，歷史帳不受日後改價影響。

**不包含**（屬 platform-control-plane 後續 change）：per-tenant AI key（BYOK）、token 月額度硬擋、平台後台用量 UI、租戶方案頁顯示。本 change 只做資料落地與成本計算。

## Capabilities

### New Capabilities
- `ai-usage-recording`: 每次 LLM 呼叫的 token 用量與來源記錄——provider 回傳 usage、AiUsage 表落地、失敗呼叫處理、租戶隔離。
- `model-pricing`: 模型單價參數化與成本計算——ModelPricing 表、effectiveFrom 版本化、成本公式（含快取折價、thinking token、分級價）、Decimal 精度。

### Modified Capabilities
（無——現有 spec 無 LLM 用量相關需求；`ChatProvider` 介面變更屬實作細節，行為層面 AI 回覆功能不變。）

## Impact

- **DB**：`packages/database/prisma/schema.prisma` 新增 `AiUsage`、`ModelPricing` 兩個 model；**必須產正式 Prisma migration 檔**（migrate dev 產 SQL，不可只 db push）；seed.ts 補 ModelPricing 種子價目。
- **API**：`apps/api/src/modules/ai/providers/types.ts`（介面）、`gemini.provider.ts`、`ollama.provider.ts`（回傳 usage）、`llm.service.ts`（落地與成本計算）。新增 pricing/成本計算輔助（放 `modules/ai/` 內）。
- **呼叫端不受影響**：kb-autoreply / ai.service / classify / sentiment / automation action-executor 皆經 `generateReply()`，其對外回傳簽名維持不變（內部改取 `.text`）。
- **無前端變更、無 socket 事件、無 workers 變更**。
- 相依：無新套件（Gemini 走既有裸 REST；Decimal 用 Prisma 內建）。
