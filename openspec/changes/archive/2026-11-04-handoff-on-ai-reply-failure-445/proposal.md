## Why

2026-11-04 UAT Demo 租戶開了 AI 個資遮罩，去識別化服務（2md）短暫回 503。同一則客人訊息的 agent 回覆與知識庫自動回覆都因此失敗，`automation.worker.ts` 的 `message.received` 只記 log：客人沒有收到任何回覆，對話停在 `BOT_HANDLED`，收件匣看不到失敗，也沒有人接手（issue #445）。任何讓 AI 與知識庫都失敗的狀況（去識別化服務、embedding 服務、模型供應商短暫故障）都會這樣。

## What Changes

- 對 `BOT_HANDLED` 對話的一則文字訊息，agent 沒有送出回覆、知識庫自動回覆又「因錯誤」沒有送出回覆時，轉接真人：沿用 `handOffConversation()`（狀態、轉接原因、系統訊息、`conversation.handoff`、通知、渠道推播），commit 之後送出渠道的轉接訊息 `botConfig.handoffMessage`。
- 轉接原因依錯誤種類寫成客服看得懂的文字，例如「AI 暫時無法回覆（去識別化服務無法使用）」，不寫錯誤內容。
- 轉接的系統訊息是程式內固定、不含顧客資料的文字，不呼叫去識別化服務，所以去識別化服務故障時仍能轉接。
- `attemptKbAutoReply()` 改回傳結構化結果（已回覆／正常不回覆與原因／失敗與錯誤），取代 `boolean`，區分「失敗」與「正常的不回覆」。關鍵字規則讓步、`botMode` 關閉、知識庫自動回覆停用、這則訊息已有機器人回覆、對話已不是 `BOT_HANDLED` 都不轉接。
- 轉接以 `bot_reply` + 入站訊息 id 認領，與轉接寫在同一個交易：事件重送不會重複轉接，已回覆過的訊息也不會轉接。commit 之前的失敗讓 job 失敗，由佇列重試。
- 不自動重試 AI 回覆：重試可能讓客人收到兩則回覆，改由客服接手。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `bot-handoff-config`：新增「AI 與知識庫回覆都因錯誤失敗時轉接真人」「正常不回覆時不轉接」「AI 失敗的轉接每則訊息最多一次」。

## Impact

- `apps/api/src/modules/automation/automation.worker.ts`（`message.received` 的 AI 回覆區塊）
- 新檔 `apps/api/src/modules/automation/ai-failure-handoff.flow.ts`
- `apps/api/src/modules/ai/kb-autoreply.service.ts`（回傳型別）
- `apps/api/src/modules/ai/deidentification.service.ts`（固定系統文字不呼叫 2md 的準備函式）
- 不改資料表、不加 migration、不加權限碼。
