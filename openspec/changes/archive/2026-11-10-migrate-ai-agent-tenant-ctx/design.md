# Design

## Context

見 proposal.md「Why」。現況（2026-11-10，main `ba4cde3f`）：

- `runAgentReply(prisma: TenantDb, llm: LlmDeps, input)` 依序做這些事：
  1. 確認對話是 `BOT_HANDLED`。
  2. `prepareLlmCall()`：讀設定、金鑰、遮罩政策，檢查月額度。
  3. 遮罩使用者的訊息。
  4. 建立 `agentRun`，讀對話歷史與其他渠道的內容。
  5. 呼叫 `runAgent()` 跑 Agent 迴圈。
  6. 檢查回覆有沒有綁定代碼。
  7. 需要送出時，呼叫 `persistAndDeliverAgentReply()`。
- `runAgent()`（`agent/runner.ts`）不碰資料庫，以 `AgentRunStore` 的四個回呼寫資料：
  - `recordUsage`：每一輪 LLM 回應之後。
  - `recordToolCall`：每一次工具呼叫之後，先遮罩參數與結果。
  - `finishRun`：結束時，先遮罩最終回答。
  - `onWikiPublished`：在 `executeAgentTool()` 內，發布 Wiki 之後。
- `runAgent()` 的錯誤處理：
  - LLM 呼叫失敗：`runAgent()` 自己結束這次執行，停止原因 `provider_error`，不丟錯。
  - 回呼丟錯：錯誤傳出 `runAgent()`，`runAgentReply()` 的 catch 把 `agentRun` 標成 `FAILED`，再把錯誤丟給呼叫端。
- `persistAndDeliverAgentReply()` 以 `readAiPrivacyPolicy()` 再讀一次遮罩政策，在 `replyGuard.persist()` 的交易內寫回覆。commit 之後，以 `emitToChannel()` 推播，再以 `deliverToChannel()` 送到渠道。
- `replyGuard` 由 automation worker 以 `app_tenant` 連線建立，`persist()` 內是 `inTenant()` 交易（`automation/bot-reply-guard.ts`）。
- automation worker 在 Agent 錯誤時改走 KB 回覆；`ClaimTransactionError` 例外，丟給佇列重試。
- A2A bridge 先回 ACK，再執行任務。執行失敗只寫 log。
- `withTenant()` 的交易逾時預設 5 秒。`AGENT_TIMEOUT_MS` 預設 120 秒，UAT 沒有另外設定。
- UAT 的 `AGENTIC_LLM_ENABLED` 是 `true`，`agent_runs` 有 245 筆，其中 A2A 建立的只有 1 筆（2026-09-15，執行 3.8 秒）。以上是 2026-11-10 的唯讀查詢。
- UAT 的 API 容器 log 看不到 `@open333crm/core` 的 logger 輸出，所以無法從 log 確認 A2A 的交易逾時是否發生過。

## Goals / Non-Goals

**Goals:**

- Agent 的每一次資料庫讀寫都在短交易內，LLM、工具、去識別化服務都在交易外呼叫。
- 三個呼叫端（automation worker、`POST /ai/agent/run`、A2A）用同一個 flow，得到相同的保證。
- 呼叫端看得到的行為不變，只有 A2A 例外：執行超過 5 秒的任務可以完成，中途失敗時保留紀錄。

**Non-Goals:**

- `conversation` 的 `deliverToChannel()` 與 `services/channel-visibility.ts` 不搬，以過渡寫法呼叫。
- `runner.ts` 的迴圈與防護（輪數、工具數、token、重複呼叫、逾時）不改。
- A2A 的租戶綁定（AUDIT A2A-01）與 ACK 時機不改。

**審查基準：** 達到 Laravel 在 queued job 內跑多步驟外部呼叫的水準：每一步以 Eloquent 各自寫入、各自 commit，不在 `DB::transaction()` 內等待外部 API。處理程序在兩步之間中斷時，已經 commit 的紀錄保留，沒做完的步驟不補做，執行紀錄停在 `RUNNING`，由保留期限清除。Laravel 專案也會有的情況記在「Risks / Trade-offs」，不另外處理。

## Decisions

### D1. 新增 `agent.flow.ts`，每一步的交易與保證

`runAgentReplyFlow(deps, input)` 取代 `runAgentReply()`。`deps` 是 `{ prisma, llm, io?, replyGuard?, deliverDb? }`，`prisma` 是 `app_tenant` 的基礎連線。

| 步驟 | 交易 | 保證 | 失敗時 |
| --- | --- | --- | --- |
| 1. 確認對話是 `BOT_HANDLED`（有 `conversationId` 時） | 交易 A | — | 不符合時丟錯，不建立紀錄（原本的行為） |
| 2. `prepareLlmCall()` | 6a 的交易 1 | — | 月額度用完時丟 403（原本的行為） |
| 3. 遮罩使用者的訊息 | 交易外 | — | 丟錯，不建立紀錄（原本的行為） |
| 4. 建立 `agentRun` | 交易 B | 每次執行最多一筆 | 丟錯，不呼叫 LLM |
| 4a. 讀對話歷史與其他渠道的內容（有 `conversationId` 時） | 交易 B2 | — | 執行紀錄標成 `FAILED`，丟錯給呼叫端（原本的行為） |
| 5. 每一輪呼叫 LLM | 交易外 | 每一輪最多一次 | runner 結束這次執行（`provider_error`） |
| 6. 記用量 `recordLlmUsage()` | 6a 的交易 2、3 | 最多一次 | 只寫 log（6a） |
| 7. 呼叫工具 | 交易外 | 每次模型要求最多一次 | 工具結果記為失敗，回給模型（原本的行為） |
| 8. 遮罩工具紀錄並寫入 `agentToolCall` | 遮罩在交易外，寫入是交易 C | 每次工具呼叫最多一筆 | 執行紀錄標成 `FAILED`，丟錯給呼叫端 |
| 9. 發布 Wiki 後寫 `agentReportDraft` | 交易 D | 最多一次 | 工具記為失敗（原本的行為，見 Risks） |
| 10. 遮罩最終回答，更新 `agentRun` | 遮罩在交易外，更新是交易 E | 最多一次 | 執行紀錄標成 `FAILED`，丟錯給呼叫端 |
| 11. 檢查綁定代碼 | 交易 F（只讀） | — | 丟錯給呼叫端 |
| 12. 寫回覆（需要送出時） | `replyGuard.persist()` | 每則進站訊息最多一則（原本的行為） | `ClaimTransactionError` 給佇列重試（原本的行為） |
| 13. 推播 `message.new`、送到渠道 | commit 之後 | 最多一次（原本的行為） | 原本的行為 |

步驟 4 與 4a 分成兩個交易：讀取失敗時，執行紀錄已經 commit，可以標成 `FAILED`，與搬遷前相同。

步驟 1 留在 `prepareLlmCall()` 之前：對話不符合、月額度也用完時，呼叫端收到的錯誤與原本相同。多開的交易 A 只有一個查詢，相對於 LLM 呼叫的時間可以忽略。

步驟 8 與 10 原本就是「寫入失敗時丟錯」。A2A 原本在一個交易內執行，失敗時整個交易 rollback。改成各自 commit 之後，失敗前寫入的紀錄會保留（spec「執行到一半失敗時保留之前的工具紀錄」）。

替代方案：把步驟 4～10 放在一個長交易內，並延長逾時。不採用：違反結構規則 2，而且 Agent 的逾時是 120 秒，會長時間佔住連線。

### D2. `AgentRunStore` 的回呼各自開交易

`agent.flow.ts` 建立 `AgentRunStore`。每個回呼先在交易外遮罩，再以 `inTenant(deps.prisma, tenantId, …)` 呼叫 service 寫入。service 函式收 `TenantCtx`，放在 `agent.service.ts`：

- `assertAgentEligible(ctx, conversationId)`
- `createAgentRun(ctx, data)`
- `recordAgentToolCall(ctx, data)`
- `upsertAgentReportDraft(ctx, data)`
- `finishAgentRun(ctx, runId, data)`
- `markAgentRunFailed(ctx, runId, stopReason)`
- `loadAgentHistory(ctx, conversationId, excludeMessageId)`
- `readAgentRun(ctx, runId)`

`runner.ts` 不改。`runner.ts` 只認得 `AgentRunStore` 介面，不知道交易。

### D3. 寫入回覆

`persistAndDeliverAgentReply()` 改收 `prepareLlmCall()` 讀到的遮罩政策，不再呼叫 `readAiPrivacyPolicy()`。推播改用 `replyGuard.persist()` 提供的 scope 呼叫 `notifyChannel()`。`notifyChannel()` 在 commit 之後才送出，rollback 時不送出。送出的時機與原本「commit 之後呼叫 `emitToChannel()`」相同。

`deliverToChannel()` 屬於還沒搬的 `conversation`，收 `TenantDb`。flow 以 `deps.deliverDb` 傳入：automation worker 傳 `prismaAdmin`，與原本相同。只有 automation worker 會送出回覆。

### D4. 呼叫端

- automation worker：`deps.prisma` 傳 `tenantDeps.tenantPrisma`，`deliverDb` 傳 `prismaAdmin`。Agent 的資料存取因此從 `prismaAdmin` 改成 `app_tenant` 連線，受 RLS 保護。
- `POST /ai/agent/run`：route 檢查渠道可見範圍（`assertConversationChannelVisible()`、`resolveChannelVisibility()`，兩者都以 `request` 查詢，屬於還沒搬的 `services/channel-visibility.ts`），再呼叫 flow。
- `GET /ai/agent/runs/:id`：以 `readAgentRunFlow` 讀紀錄。讀到之後，route 檢查關聯對話的渠道可見範圍，順序與原本相同。
- A2A bridge：直接呼叫 flow，不再包 `withTenant()`。

### D5. `loadOtherChannelContext()` 改收 `TenantCtx`

這個函式只讀資料，Agent 在步驟 4 的交易 B 內呼叫。另一個呼叫端 `kb-autoreply` 還沒搬，以過渡 `TenantCtx`（`{ tx: prisma, tenantId }`）呼叫，同 6a 對 `getChatSettings()` 的做法。這個檔案歸 contacts 領域，spec `ai-cross-channel-context` 的行為不變。

### D6. 綁定代碼的檢查

`guardAiReplyForTenant()` 屬於還沒搬的 `identity-binding`，收 `TenantDb`。回覆含綁定代碼時，這個函式讀身分綁定設定（處理程序內的快取）。flow 以交易 F 的 `scope.tx` 呼叫它；回覆不含代碼時，函式不查詢資料庫。

## Risks / Trade-offs

- [處理程序在 Agent 執行途中結束，`agentRun` 停在 `RUNNING`] → 審查基準接受。automation 與 `POST /ai/agent/run` 原本就是這樣；保留期限到了之後，workers 的 `agent-retention-cleanup` 把它標成 `EXPIRED`。
- [automation 的 job 重試時，Agent 再跑一次，建立第二筆 `agentRun`，工具也再呼叫一次] → 原本的行為。`replyGuard` 保證每則進站訊息最多一則回覆。
- [Wiki 發布成功，寫 `agentReportDraft` 失敗：工具記為失敗，模型可能再發布一次] → 原本的行為。重複呼叫的防護（同一個工具與參數最多 3 次）限制次數。這次不改。
- [A2A 以最早建立的啟用租戶執行任務] → AUDIT A2A-01，另開 change。
- [`deliverToChannel()` 仍用 `prismaAdmin`] → 隨 `conversation` 搬遷。
- [LLM 與工具的呼叫不收 `TenantCtx`，型別擋不住在交易內呼叫] → 同第五批、6a，由 code review 與規劃檔 5.2 的檢查清單把關。

## Migration Plan

沒有 schema 變更。部署後重跑規劃檔 6.2 的腳本，`bench.mjs` 加上 `GET /ai/agent/runs/:id`（不存在的 id，回 404）。回滾：revert 這次的 commit。
