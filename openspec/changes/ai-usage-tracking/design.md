# Design: ai-usage-tracking

## Context

- LLM 呼叫鏈：`kb-autoreply / ai.service / classify / sentiment / automation action-executor` → `llm.service.ts:generateReply()` → `getChatProvider()` → `gemini.provider.ts` 或 `ollama.provider.ts`。
- Gemini 走裸 REST（`v1beta models/{model}:generateContent`，非 streaming），回應含 `usageMetadata`（gemini.provider.ts:97-107 已定義型別但成功路徑丟棄）。Ollama `/api/chat` 回應含 `prompt_eval_count` / `eval_count`。
- `ChatProvider.generate(): Promise<string>`（types.ts:32），唯一呼叫端是 `llm.service.ts:117`。
- DB 無任何 token/usage 表；`ChannelUsage` 是渠道訊息費，語意不同不複用。
- Gemini API 只回 token 數不回金額；官方帳單只到 GCP project 粒度，多租戶歸戶必須自己逐次記。

## Goals / Non-Goals

**Goals:**
- 每次 LLM 呼叫（成功與失敗）都留下一筆帶租戶歸屬的用量記錄。
- 成本在寫入當下以 DB 內單價計算並快照，歷史帳不受改價影響。
- 單價可在 DB 調整（參數化），改價不改碼。
- 記錄行為零侵入：不增加回覆延遲、寫入失敗不影響 AI 回覆主流程。

**Non-Goals:**
- 不做額度硬擋、預警、BYOK、平台/租戶 UI、跨租戶統計 API（皆屬 platform-control-plane）。
- 不做 streaming 支援（現行 provider 皆非 streaming；日後改 streaming 時取最後 chunk 的 usageMetadata 即可，介面不需再改）。
- 不做 embedding 用量記錄（embedding 走本機 Ollama BGE-M3，成本為 0；平台層要統計次數時再擴充）。
- 不改 kb-ingest 離線管線（獨立工具、量少、之後可複用 ModelPricing）。

## Decisions

### D1. Provider 介面回傳 `ChatGenerateResult` 物件，而非另開回呼/事件
`generate()` 改回傳 `{ text: string, usage?: TokenUsage }`，`TokenUsage = { promptTokens, cachedTokens, candidatesTokens, thoughtsTokens }`（缺項補 0）。
- 為什麼不用事件/回呼：呼叫端只有 `generateReply()` 一處，直接改簽名最簡單、型別安全；事件匯流反而引入時序與遺漏風險。
- `usage` 為 optional：provider 拿不到用量（如 Ollama 舊版無欄位）時回 undefined，落地層記 0 並標記 `usageMissing`，不擋主流程。

### D2. 落地點在 `generateReply()`，fire-and-forget 寫入
所有呼叫端都經 `generateReply()`，在此統一寫 `AiUsage`——不 `await`（`.catch(log)`），AI 回覆延遲零增加；寫入失敗只 log。
- 為什麼不走 eventBus → BullMQ → workers：單筆 insert 無需查詢接收者、無 socket 副作用，走 Path B 徒增三段鏈路與故障面。直接 async insert 即可。
- 失敗呼叫（provider throw）也要記：在 `generateReply()` 的 catch 中記一筆 `success=false`、token 全 0、costUsd=0、errorCode 摘要，然後原樣 rethrow——保留現有錯誤行為。

### D3. `AiUsage` 每呼叫一筆（raw log），不做預聚合
欄位：`id, tenantId, provider, model, feature, promptTokens, cachedTokens, candidatesTokens, thoughtsTokens, totalTokens, costUsd Decimal(12,8), success, usageMissing, errorCode?, conversationId?, caseId?, createdAt`。索引 `(tenantId, createdAt)`、`(tenantId, feature)`。
- 為什麼不直接寫日彙總：raw log 才能事後對帳、除錯、重算；量級可控（每租戶日千次呼叫 = 千筆/日）。平台層日後要圖表時再從 raw 聚合（可複用 DailyStat 骨架），非本 change 範圍。
- `feature` 用 string literal（`kb-autoreply | summary | classify | sentiment | automation`），由各呼叫端經 `generateReply()` 新增的 `meta` 參數傳入；未傳則 `unknown`。
- 關聯 conversation/case 為 nullable soft reference（不設 FK cascade，避免刪對話連坐刪帳）。

### D4. `ModelPricing` 以 `(model, effectiveFrom)` 版本化，查價取「該模型 effectiveFrom ≤ now 的最新一列」
欄位：`model, inputPer1M, outputPer1M, cachedPer1M, tierThreshold?, tierInputPer1M?, tierOutputPer1M?, effectiveFrom, 全部 Decimal`。全域表（不帶 tenantId，同 Plan 先例需註解標明）。
- 改價 = 新增一列；歷史列不動。查價結果進程內快取 10 分鐘（同 perms 快取先例），改價經 API 不在本 change 範圍——直接 SQL/seed 調整即可。
- 查無價目的模型：costUsd 記 0 並標 `usageMissing`（帳面寧缺勿錯），log warning。
- Ollama：seed 一列單價全 0 的通配（provider='ollama' 時直接 cost 0，不查表）。

### D5. 成本公式與精度
```
costUsd = (promptTokens − cachedTokens) × in/1e6
        + cachedTokens × cached/1e6
        + (candidatesTokens + thoughtsTokens) × out/1e6
若 tierThreshold 存在且 promptTokens > tierThreshold → 整筆改用 tier 價
```
- 計算用 `Prisma.Decimal`（decimal.js）全程運算，不經 float；存 `Decimal(12,8)`（單次成本 ~1e-4 USD，8 位小數足夠）。
- thinking token 按 output 價（Google 計費規則）；cachedTokens 是 promptTokens 的子集要先扣除再折價，此為最易錯處，spec 有對應 scenario。

## Risks / Trade-offs

- [介面 BREAKING 漏改呼叫端] → 呼叫端僅 `llm.service.ts` 一處直接呼叫 provider；`generateReply()` 對外簽名不變（內部取 `.text`），上游五個模組零改動。typecheck 保證不漏。
- [fire-and-forget 寫入掉資料] → 可接受：用量記錄是計費輔助非金流帳本，掉單筆只低估成本；寫入失敗有 log 可察覺。對帳靠月底與 Cloud Billing 比對。
- [Gemini usageMetadata 欄位缺漏（如 preview 模型不回 thoughtsTokenCount）] → 全欄位 `?? 0`，並以 totalTokenCount 交叉檢查，偏差>10% 時 log warning。
- [改價忘記加新列，新模型無價目] → cost 0 + usageMissing 標記 + warning log，月對帳時會浮現；平台層 UI 落地後再補管理介面。
- [單價快取 10 分鐘延遲] → 改價本來就低頻，10 分鐘誤差對成本統計無實質影響。

## Migration Plan

1. schema 加兩 model → `prisma migrate dev` 產正式 migration SQL（勿 db push）。
2. seed.ts 補 ModelPricing（現行 Gemini 價目 + ollama 0 價列）；部署後 entrypoint `migrate deploy` 自動建表，需另跑一次 pricing seed（或做成 idempotent upsert 併入 migration data script）。
3. 程式變更與表同 PR 上；表先建、程式後啟不影響舊行為（沒人寫而已）。回滾：revert 程式即可，表留著無害。

## Open Questions

- 無阻塞性問題。（月匯總聚合與 UI 呈現屬 platform-control-plane，屆時決定聚合表 vs 即時聚合。）
