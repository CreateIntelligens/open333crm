## Context

`message.received` 的 AI 回覆區塊依序做：自動轉接檢查 → agent 回覆（`runAgentReply`）→ agent 沒有處理時改走知識庫（`attemptKbAutoReply`）。兩者的失敗原本只記 log，job 照常完成（issue #445）。

## Decisions

### 1. 什麼算「失敗」

只在知識庫自動回覆的結果是「失敗」時轉接。知識庫只在 agent 沒有送出回覆時才執行，所以「知識庫失敗」就代表這則訊息沒有任何 AI 回覆。

`runAgentReply` 的結果：

| 結果 | 分類 | 轉接？ |
| --- | --- | --- |
| 沒有呼叫：關鍵字規則讓步、`AGENTIC_LLM_ENABLED` 關閉、`botMode` 不跑 agent | 不是失敗，交給知識庫 | 看知識庫 |
| 丟錯：`PLAN_LIMIT_EXCEEDED`、去識別化 `AI_DEIDENTIFICATION_UNAVAILABLE`、`AI_PRIVACY_POLICY_UNAVAILABLE`、資料庫或供應商設定錯誤 | 失敗，改走知識庫；錯誤留著當轉接原因的備用 | 看知識庫 |
| 丟錯：`Conversation is not eligible`（對話已不是 `BOT_HANDLED`） | 正常（另一個處理已轉接或客服已接手） | 知識庫會回「對話已不是 BOT_HANDLED」，不轉接 |
| `handled: false`：`provider_error`、`timeout`、`max_tokens`、`empty_response`、`max_tool_calls`、`repeated_tool_call`、`max_turns` | 失敗，改走知識庫 | 看知識庫 |
| `handled: true`，認領不到或對話已不是 `BOT_HANDLED` 而沒寫入 | 正常（別的處理已回覆） | 不呼叫知識庫，不轉接 |
| `ClaimTransactionError` | 認領的交易失敗 | 不轉接，job 失敗由佇列重試 |

`attemptKbAutoReply` 的結果（改成 `KbAutoReplyResult`）：

| 步驟 | 原本 | 改成 | 轉接？ |
| --- | --- | --- | --- |
| 1 `KB_AUTO_REPLY_ENABLED` 關閉 | `false` | `skipped: kb_disabled` | 否 |
| 2 對話不是 `BOT_HANDLED` | `false` | `skipped: not_bot_handled` | 否 |
| 2.5 關鍵字規則能回覆 | `false` | `skipped: keyword_rule` | 否 |
| 3 `botMode` 是 `off`、`keyword` | `false` | `skipped: bot_mode` | 否 |
| 4、5、7 讀設定、對話紀錄、檢索丟錯 | 丟錯（worker 只記 log） | 丟錯，worker 視為 `failed` | 是 |
| 6 `generateEmbedding` 失敗 | `false` | `failed` | 是 |
| 7.5 型號守門的 LLM 失敗 | 固定文字回覆 | 不變（`replied`） | 否 |
| 8 追問的 LLM 失敗、追問用完 | 「已為您轉接」並轉接（#419） | 不變（`replied`） | 已在同一個交易轉接 |
| 8 知識庫回答的 LLM 失敗 | 文章內容回覆（KB-04） | 不變（`replied`） | 否 |
| 寫入前的遮罩或綁定代碼檢查丟錯 | 丟錯（worker 只記 log） | 丟錯，worker 視為 `failed` | 是 |
| 寫入時認領不到、或轉接不成立 | `false` | `skipped: already_handled` | 否 |
| `ClaimTransactionError` | 丟錯，job 重試 | 不變 | 否，job 重試 |
| 寫入之後送出渠道 | `true` | `replied` | 否 |

worker 層的略過（不呼叫 agent 與知識庫，也不轉接）：非文字訊息、對話不是 `BOT_HANDLED`、這則訊息已有 `bot_reply` 認領。

知識庫自動回覆停用、agent 又失敗時，這則訊息仍然沒有回覆、也不轉接。這是使用者核准的預設（「KB 停用不可轉接」），記在 AUDIT.md。

### 2. 轉接原因

先看知識庫的錯誤，是一般錯誤時再看 agent 丟出的錯誤：

| 錯誤 | `handoffReason` |
| --- | --- |
| `AI_DEIDENTIFICATION_UNAVAILABLE` | AI 暫時無法回覆（去識別化服務無法使用） |
| `AI_PRIVACY_POLICY_UNAVAILABLE` | AI 暫時無法回覆（個資保護設定無法讀取） |
| `PLAN_LIMIT_EXCEEDED` | AI 暫時無法回覆（AI 月額度已用完） |
| 其他 | AI 暫時無法回覆（AI 服務發生錯誤） |

錯誤訊息不寫進原因或系統訊息：可能含供應商回應或內部網址。

### 3. 系統訊息不呼叫去識別化服務

`checkAutoHandoff` 與知識庫轉接用 `prepareStoredMessageContent(..., 'system')` 遮罩系統訊息，會呼叫 2md。這次的轉接正是在 2md 故障時發生，再呼叫一次一定失敗。系統訊息的文字是「自動轉接人工客服：」加上上表的固定原因，不含顧客或租戶資料。新增 `prepareFixedSystemMessageContent()`：租戶開啟遮罩時，遮罩副本就是原文（`mode: system_fixed`），不呼叫 2md；讀取遮罩設定失敗時丟錯。

不寫對話摘要：摘要要呼叫 LLM，這時多半也會失敗（LLM-05）。

### 4. 每個步驟失敗時的處理

| 步驟 | 可能失敗的地方 | 失敗後資料在哪 | 由誰重做 | 保證 |
| --- | --- | --- | --- | --- |
| agent、知識庫（交易外，呼叫 2md、LLM、embedding） | 外部服務 | 沒有寫入 | 不重做，進入轉接 | 不重試回覆，避免兩則回覆 |
| 讀對話、遮罩設定（交易外） | 資料庫 | 沒有寫入 | job 失敗，佇列重試整個 `message.received` | 至少一次 |
| 轉接交易：認領 `bot_reply`、改 `AGENT_HANDLED`、寫系統訊息、寫 outbox `conversation.handoff` | 資料庫 | rollback，對話仍是 `BOT_HANDLED`、沒有認領 | job 失敗，佇列重試 | 轉接最多一次（認領＋條件更新） |
| commit 之後推播 `conversation.updated`、`message.new` | Socket | 轉接已 commit | 不重做 | 最多一次 |
| commit 之後送出 `handoffMessage` | 渠道 API | 轉接已 commit | 不重做，只記 log | 最多一次 |
| `conversation.handoff` 通知 | 通知訂閱者 | outbox | outbox 重送，通知訂閱者自己認領 | 至少一次（既有行為） |

佇列重試時，agent 與知識庫會再執行一次：這時沒有任何回覆送出過（沒有 `bot_reply` 認領），所以不會重複。外部服務已恢復時，客人收到 AI 回覆、不轉接。
