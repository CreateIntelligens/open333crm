# Tasks

## 1. 搬遷前補測試

- [ ] 1.1 確認下列現有測試涵蓋搬遷前的行為，列出搬遷時要改寫注入方式的測試：`tests/unit/modules/ai/agent-quota.test.ts`、`agent-runner.test.ts`、`agent-tools.test.ts`、`agent-multimodal-tools.test.ts`、`agent/agent-binding-guard.test.ts`、`agent/agent-history.test.ts`、`other-channel-context-wiring.test.ts`、`deidentification.test.ts`（Agent 的部分）、`ai-routes-channel-scope.test.ts`、`tests/unit/modules/automation/bot-reply-claim.test.ts`、`ai-failure-handoff.test.ts`、`keyword-suppresses-ai.test.ts`、`tests/feature/modules/ai/other-channel-context.test.ts`、`tests/feature/modules/identity-binding/email-registration.test.ts`。改寫時只改注入方式，不改斷言。`keyword-suppresses-ai.test.ts` 讀原始碼找 `await runAgentReply(`，改名之後要改成新的函式名稱，保證不變。

## 2. Agent 的 flow（design D1、D2）

- [ ] 2.1 寫測試「呼叫外部服務之前交易已經結束」（新檔 `tests/unit/modules/ai/agent/agent-flow.test.ts`）。測試以 `tests/support/flow-harness.ts` 記錄交易與呼叫的順序，執行一次有 1 次工具呼叫的 Agent，斷言每次呼叫 LLM 與工具之前，紀錄裡沒有未結束的交易。因為函式的簽名改了，這個測試無法在搬遷前的程式上執行，改以突變驗證：把工具紀錄的寫入與工具呼叫放進同一個交易。突變記在 7.1。
- [ ] 2.2 寫測試「執行到一半失敗時保留之前的工具紀錄」「工具紀錄寫入失敗」（新檔 `tests/feature/modules/ai/agent-flow.test.ts`，app_tenant 連線，provider 換成假的）：
  - 第 1 輪工具成功、第 2 輪 LLM 失敗：`agentRun` 是 `FAILED`，停止原因是 `provider_error`，第 1 輪的 `agentToolCall` 仍然存在。
  - 寫入 `agentToolCall` 失敗：`agentRun` 是 `FAILED`，系統不再呼叫 LLM，呼叫端收到錯誤。

  以突變驗證：把整段執行包在一個 `withTenant()` 交易內。突變記在 7.1。
- [ ] 2.3 `agent.service.ts` 改成收 `TenantCtx` 的查詢：`assertAgentEligible`、`createAgentRun`、`recordAgentToolCall`、`upsertAgentReportDraft`、`finishAgentRun`、`markAgentRunFailed`、`loadAgentHistory`、`readAgentRun`。新增 `ai/agent/agent.flow.ts`：`runAgentReplyFlow`、`readAgentRunFlow`，`AgentRunStore` 的回呼在交易外遮罩、各自以 `inTenant()` 寫入。`tool-registry.ts` 刪除 `AgentToolContext.prisma`。讓 2.1、2.2 與 1.1 列出的 Agent 測試通過。

## 3. 寫入回覆（design D3、D6）

- [ ] 3.1 `persistAndDeliverAgentReply()` 改收遮罩政策，不再呼叫 `readAiPrivacyPolicy()`；推播改用 `replyGuard.persist()` 的 scope 呼叫 `notifyChannel()`；`deliverToChannel()` 以 `deps.deliverDb` 呼叫。綁定代碼的檢查在交易 F 內呼叫 `guardAiReplyForTenant()`。`bot-reply-claim.test.ts`、`agent-binding-guard.test.ts` 通過。

## 4. `loadOtherChannelContext()`（design D5）

- [ ] 4.1 `other-channel-context.ts` 的 `loadOtherChannelContext()` 改收 `TenantCtx`；`kb-autoreply.service.ts` 以過渡 `TenantCtx` 呼叫。`other-channel-context.test.ts`、`email-registration.test.ts`、`other-channel-context-wiring.test.ts`、`kb-clarify-handoff.test.ts`、`kb-model-guard.test.ts` 通過。

## 5. 呼叫端（design D4）

- [ ] 5.1 寫測試「A2A 任務執行超過 5 秒」（`tests/feature/modules/ai/agent-flow.test.ts`）：
  1. 把 `a2a-bridge.worker.ts` 處理一個任務的程式抽成 `handleA2ATask(deps, item)`。Hub 的 HTTP 呼叫改用注入的 `fetch`，測試傳入假的 `fetch`。
  2. 假的 provider 等 6 秒才回最終回答。
  3. 斷言 Hub 收到這個回答，`agentRun` 的狀態是 `COMPLETED`。

  以突變驗證：`handleA2ATask` 改回以 `withTenant()` 包住 Agent。突變記在 7.1。
- [ ] 5.2 `a2a-bridge.worker.ts` 改呼叫 `handleA2ATask()`，不再包 `withTenant()`。讓 5.1 通過。
- [ ] 5.3 `automation.worker.ts` 改呼叫 `runAgentReplyFlow()`：`prisma` 傳 `tenantDeps.tenantPrisma`，`deliverDb` 傳 `prismaAdmin`。`ai-failure-handoff.test.ts`、`automation.worker.test.ts`、`keyword-suppresses-ai.test.ts`、`non-text-no-ai-reply.test.ts`、`auto-handoff.test.ts` 通過。
- [ ] 5.4 `ai.routes.ts` 的 `POST /ai/agent/run`、`GET /ai/agent/runs/:id` 改呼叫 flow，渠道可見範圍的檢查留在 route，順序不變。`ai-routes-channel-scope.test.ts` 通過。

## 6. 文件與平台層

- [ ] 6.1 `AGENTS.md`「Plan the platform layer in the same change」的「calls an AI model」一列改成 `llm.flow.ts` 的 `recordLlmUsage()`。執行 `grep -rn "recordAiUsage" AGENTS.md docs/ref .claude/skills`，確認沒有其他過期的引用。
- [ ] 6.2 更新 `docs/ref/features/tenant/KNOWLEDGE.md` 的 Agent 段落與 `feature-knowledge` skill：Agent 的寫入各自在短交易內，A2A 不在交易內執行。新檔 `agent.flow.ts` 加進 `docs/ref/features/feature-map.json`，`node scripts/feature-impact.mjs --check` 通過。

## 7. 完成檢查

- [ ] 7.1 在本檔記下 2.1、2.2、5.1 的突變與結果。
- [ ] 7.2 `pnpm test` 通過。
- [ ] 7.3 `pnpm test:feature` 通過。
- [ ] 7.4 `node scripts/check-tenant-ctx.mjs --strict` 通過，執行 `--update-baseline`；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規。
- [ ] 7.5 `node scripts/feature-impact.mjs` 列出的直接受影響領域（knowledge、automation、inbox、contacts、settings），逐項走過回歸清單。
- [ ] 7.6 `CHANGELOG.md` 的 `Changed` 寫明可觀察的差異：A2A 任務執行超過 5 秒可以完成；執行中途失敗時保留執行紀錄與之前的工具紀錄；automation 觸發的 Agent 改用 app_tenant 連線。
- [ ] 7.7 `node scripts/validate-openspec.mjs migrate-ai-agent-tenant-ctx` 與 `--specs` 通過。
- [ ] 7.8 部署到 UAT 後重跑規劃檔 6.2 的腳本，`bench.mjs` 加上 `GET /ai/agent/runs/:id`（不存在的 id，回 404）。
