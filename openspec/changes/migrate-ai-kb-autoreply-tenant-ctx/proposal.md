# Proposal

## Why

#337 階段 4 第六批的 6b-2。`ai` 模組的知識庫自動回覆（`kb-autoreply.service.ts` 的 `attemptKbAutoReply()`）收 `PrismaClient`，automation worker 傳入 `prismaAdmin`。所以：

- 讀對話、關鍵字規則、對話歷史、設定與知識庫的查詢都沒有 RLS，每個查詢各自 commit。查詢都自帶 `tenantId`，只有程式層一層隔離。
- 寫入回覆時，系統沒有再確認對話仍是 `BOT_HANDLED`。系統在處理開始時確認一次，之後呼叫 embedding 服務與 LLM，需要幾秒。客服在這段期間接手對話時，系統仍然寫入並送出知識庫的回覆。主規格 `bot-handoff-config`「轉接後關鍵字規則照常回覆」規定知識庫自動回覆 SHALL NOT 回覆 `AGENT_HANDLED` 的對話。Agent 的回覆在 6b-1 之前就以條件更新檢查這件事，知識庫的回覆沒有。
- 寫入回覆時，對話的 `metadata`（追問次數、型號守門）以處理開始時讀到的值合併後覆寫。同一段對話的兩則訊息同時處理時，後寫入的一則會蓋掉先寫入的追問次數。目前只有知識庫自動回覆寫這個欄位。

6b-1 已經把 Agent 搬完（PR #504）。`kb-autoreply` 是 `ai` 模組最後一個收舊連線的回覆流程。

## What Changes

- 新增 `ai/kb-autoreply.flow.ts`。資料庫讀寫各自在短交易內，embedding 服務、LLM 與去識別化服務在交易外呼叫：
  1. 交易內讀對話、判斷關鍵字規則讓步、讀 Chat 設定、對話歷史、其他渠道的內容、向量化設定與遮罩政策。
  2. 交易外向量化客人的訊息。
  3. 交易內搜尋知識庫，型號守門需要時讀型號白名單。
  4. 交易外呼叫 LLM（6a 的 `generateReply()`）。
  5. 檢查綁定代碼，交易外遮罩回覆。
  6. 以 `replyGuard` 的交易寫入回覆：以條件更新確認對話仍是 `BOT_HANDLED`，在交易內讀最新的 `metadata` 再合併。commit 之後推播並送出。
- `kb-autoreply.service.ts` 讀寫資料庫的部分改成收 `TenantCtx` 的函式。追問、型號守門、回覆內容的判斷不變。
- 寫入回覆時，遮罩政策沿用步驟 1 讀到的政策，不再另外讀一次。
- 推播 `message.new` 改用 `notifyChannel()`，commit 之後送出，與原本的時機相同。
- automation worker 改呼叫 flow：資料存取改用 `app_tenant` 連線。送到渠道的 `deliverToChannel()` 屬於還沒搬的 `conversation`，仍用 `prismaAdmin`（比照 6b-1）。

不改的事：

- 追問、型號守門、轉接、`handoff` 提示的規則與文字。
- `identity-binding` 的 `guardAiReplyForTenant()` 與 `conversation` 的 `deliverToChannel()` 不搬，以過渡寫法呼叫。
- `flex-ai.service.ts` 的 `generateFlexFromPrompt()` 留到搬 `marketing`（6a 的決定）。

## Capabilities

### New Capabilities

（沒有）

### Modified Capabilities

- `bot-handoff-config`：
  - 「轉接後關鍵字規則照常回覆」新增一個 scenario：知識庫產生回覆期間客服接手，系統不寫入、不送出這則回覆。
  - 新增一則需求：知識庫自動回覆不在交易內等待外部呼叫。

## Platform layer

適用「calls an AI model」一列。6a 完成後，知識庫自動回覆已經做到這一列的要求：

- 每次呼叫 LLM 之前，`generateReply()` 經由 `prepareLlmCall()` 檢查月額度並讀遮罩政策。
- 每次 LLM 回應之後，`recordLlmUsage()` 以 `AiFeature` 的 `kb-autoreply` 記用量。

這次保留這些行為，模型與價目也不變。

其他列不適用。這次沒有新增權限碼、功能區、方案上限、渠道類型、平台要看的設定、平台稽核動作或佇列，也沒有新增租戶與平台之間的申請。

## Impact

- 程式：`apps/api/src/modules/ai/kb-autoreply.service.ts`、新檔 `ai/kb-autoreply.flow.ts`、`automation/automation.worker.ts`。
- API：沒有改路由。
- 功能領域（`feature-impact.mjs`）：直接影響 knowledge、automation、inbox。
- `scripts/check-tenant-ctx.baseline.json`：`kb-autoreply.service.ts` 的 LLM 入口 1 處移除。
- 文件：`docs/ref/features/tenant/KNOWLEDGE.md` 的知識庫自動回覆一節、`feature-knowledge` skill、`docs/ref/features/feature-map.json`、`CHANGELOG.md`。
