# Proposal

## Why

#337 階段 4 第六批的 6b-1。`ai` 模組的 Agent（`agent/agent.service.ts` 的 `runAgentReply()`）收舊的 `TenantDb`。呼叫端給的連線不同，Agent 的保證也不同：

| 呼叫端 | 傳入的連線 | 結果 |
| --- | --- | --- |
| automation worker（客人的訊息觸發 Agent） | `prismaAdmin` | 沒有 RLS。每個查詢各自 commit |
| `POST /api/v1/ai/agent/run`（客服在後台執行） | `request.tenantPrisma` | 每個查詢各開一個交易 |
| A2A bridge（外部 Agent 經 A2A Hub 送來的任務） | `withTenant()` 的 `tx` | 整段 Agent 迴圈在一個交易內 |

A2A 的寫法違反結構規則 2：Agent 迴圈在交易內呼叫 LLM 與外部 HTTP 工具。交易的逾時是 5 秒，Agent 的逾時預設是 120 秒（`AGENT_TIMEOUT_MS`）。一個 A2A 任務執行超過 5 秒時，之後的資料庫寫入失敗，任務沒有結果。執行到一半失敗時，交易 rollback，`agentRun` 與已經寫入的工具紀錄全部消失，無法診斷失敗的原因。

`kb-autoreply.service.ts` 依賴還沒搬的 `conversation` 與 `identity-binding`，留到 6b-2（使用者 2026-11-10 決定）。

## What Changes

- 新增 `ai/agent/agent.flow.ts`。Agent 的資料庫讀寫各自在短交易內執行，LLM 與工具的呼叫在交易外：
  1. 交易內確認對話仍是 `BOT_HANDLED`（有 `conversationId` 時）。
  2. `prepareLlmCall()` 讀設定並檢查月額度（6a 已完成）。
  3. 交易外遮罩使用者的訊息。
  4. 交易內建立 `agentRun`，讀對話歷史與其他渠道的內容。
  5. 交易外執行 Agent 迴圈。迴圈中的寫入：
     - 每一輪呼叫 LLM 之後，`recordLlmUsage()` 記用量（6a 已完成）。
     - 每次工具呼叫之後，以一個交易寫 `agentToolCall`。
     - 發布 Wiki 之後，以一個交易寫 `agentReportDraft`。
     - 結束時，以一個交易更新 `agentRun`。
  6. 交易外檢查回覆有沒有綁定代碼，再以 `replyGuard` 的交易寫入回覆，commit 之後送出（原本的做法）。
- `runAgentReply()`、`persistAndDeliverAgentReply()`、`loadAgentHistory()` 讀寫資料庫的部分，改成收 `TenantCtx` 的 service 函式。`other-channel-context.ts` 的 `loadOtherChannelContext()` 也改收 `TenantCtx`。還沒搬的 `kb-autoreply` 以過渡 `TenantCtx` 呼叫這個函式。
- 三個呼叫端改呼叫 flow：
  - automation worker：Agent 的資料存取改用 `app_tenant` 連線，不用 `prismaAdmin`。送出回覆的 `deliverToChannel()` 屬於還沒搬的 `conversation`，仍用 `prismaAdmin`。
  - `ai.routes.ts` 的 `POST /ai/agent/run` 與 `GET /ai/agent/runs/:id` 改呼叫 flow，回應不變。
  - A2A bridge 不再以 `withTenant()` 包住 Agent。執行超過 5 秒的 A2A 任務可以完成。任務中途失敗時，`agentRun` 標成 `FAILED`，之前的工具紀錄保留。
- 寫入 Agent 回覆時，遮罩政策沿用 `prepareLlmCall()` 讀到的政策，不再另外讀一次。
- `tool-registry.ts` 的 `AgentToolContext.prisma` 沒有被使用，刪除。
- AGENTS.md「Plan the platform layer in the same change」的「calls an AI model」一列仍寫 6a 改名前的 `recordAiUsage()`，改成 `llm.flow.ts` 的 `recordLlmUsage()`。

不改的事：

- A2A 以「最早建立的啟用租戶」執行任務（AUDIT A2A-01）。主規格 `a2a-agent-tenant-routing` 規定要明確綁定租戶，修正要決定綁定設定放在哪裡，另開 change（使用者 2026-11-10 決定）。
- A2A 先回 ACK 再執行任務，所以每個任務最多執行一次，處理程序在執行途中結束時任務遺失。這次不改。
- Agent 資料的保留期限由 workers 的 `agent-retention-cleanup` 執行，屬於階段 5。
- `generateFlexFromPrompt()` 留到搬 `marketing`（6a 的決定）。

## Capabilities

### New Capabilities

（沒有）

### Modified Capabilities

- `agentic-llm-orchestration`：新增一則需求，規定 Agent 執行時資料庫交易與外部呼叫的界線，以及每一步的保證（最多一次或至少一次）。

## Platform layer

適用「calls an AI model」一列。6a 完成後，Agent 已經做到這一列的要求：

- 呼叫 LLM 之前，`prepareLlmCall()` 檢查月額度並讀遮罩政策。
- 每一輪 LLM 回應之後，`recordLlmUsage()` 以 `AiFeature` 的 `agent` 記用量。

這次保留這些行為，模型與價目也不變。這一列的文字仍寫 `recordAiUsage()`，這次改成 `recordLlmUsage()`。

其他列不適用。這次沒有新增權限碼、功能區、方案上限、渠道類型、平台要看的設定、平台稽核動作或佇列，也沒有新增租戶與平台之間的申請。

## Impact

- 程式：`apps/api/src/modules/ai/agent/`（`agent.service.ts`、新檔 `agent.flow.ts`、`tool-registry.ts`）、`ai/other-channel-context.ts`、`ai/kb-autoreply.service.ts`（只改 `loadOtherChannelContext()` 的呼叫）、`ai/ai.routes.ts`、`automation/automation.worker.ts`、`settings/a2a-bridge.worker.ts`。
- API：`POST /api/v1/ai/agent/run`、`GET /api/v1/ai/agent/runs/:id` 的請求與回應不變。
- 功能領域（`feature-impact.mjs`）：直接影響 knowledge、automation、inbox、contacts、settings。
- `scripts/check-tenant-ctx.baseline.json`：`ai` 的 `TenantDb`、`request.tenantPrisma` 處數減少。
- 文件：`AGENTS.md`（平台層一列）、`docs/ref/features/tenant/KNOWLEDGE.md` 的 Agent 一節、`feature-knowledge` skill、`CHANGELOG.md`。
