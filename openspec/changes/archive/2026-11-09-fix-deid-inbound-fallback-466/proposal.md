## Why

2026-11-05 UAT：Demo 租戶開啟 AI 個資遮罩，去識別化服務（2md，`https://2md.aiurl.tw/api/deid`）整個早上連不上。進站管線在存訊息前呼叫 `prepareStoredMessageContent(..., 'inbound')`，2md 失敗就丟出 `AI_DEIDENTIFICATION_UNAVAILABLE`，例外往上丟，整個 webhook 處理中止：訊息沒有存、機器人不回、對話不轉接，後台只有一行 `[Webhook] LINE processing failed`（issue #466）。#445 只處理「AI 回覆時」去識別化失敗，不涵蓋進站存檔這條路徑；按鈕轉接人工等 `system_template` 系統訊息也會呼叫 2md，同樣失敗。

## What Changes

- 呼叫 2md 遇到短暫故障（逾時、連線或 DNS 錯誤、5xx）時，短暫等待後重試一次。每次嘗試的逾時從 10 秒改為 6 秒，兩次加起來約 12 秒，與原本的上限相近。其他失敗（4xx、回應格式不符、回應過大、文字過長）不重試。
- 進站訊息在重試後仍無法遮罩時，存原文，`metadata.privacy` 記 `{ version: 1, mode: 'inbound_unmasked', reason }`（沒有遮罩副本），不丟出例外，管線照常推播與發布 `message.received`（payload 帶 `privacyUnmasked: true`）。
- 未遮罩的進站訊息不交給 AI：`message.received` 看到標記時不呼叫 agent 與知識庫自動回覆，改走 `handOffConversation()` 轉真人（沿用 #445 的 `handOffAfterAiFailure()` 與固定文字系統訊息），收件匣顯示「去識別化服務無法使用，這則訊息未遮罩、未交給 AI」。情緒分析改用關鍵字判斷，不呼叫模型。關鍵字規則讓步、`botMode` 不跑 AI 時照舊不轉接。
- 模型讀對話紀錄的函式（`readModelMessageContent()`、`toAiHistory()`，以及工單自動分類）略過未遮罩的訊息：AI 建議回覆、摘要、agent 與知識庫歷史、其他渠道脈絡都不會讀到原文。
- 程式內固定、不含顧客輸入的系統文字改用 `fixedSystemMessageContent()`，不呼叫 2md：按鈕轉接人工、跨渠道綁定失敗提示、滿意度調查與評分後的固定回覆、座席轉接時的預設轉接訊息。含顧客名稱的綁定訊息、含座席名稱的交回 Bot 訊息維持原本的遮罩。
- 自動轉接（轉接關鍵字、回覆次數上限、客人傳圖片）在去識別化服務無法使用時照常完成：轉接的系統訊息含對話摘要（模型輸出）而必須遮罩，遮罩失敗時捨棄摘要，改用固定文字「自動轉接人工客服：<原因>」，不再讓 `message.received` 一直失敗重試、對話永遠轉不出去。
- 進站訊息降級時發出維運告警（`sendOpsAlert()`，合併鍵 `deidentification-unavailable`），10 分鐘內只送一則，帶上期間內未送出的次數。告警不含訊息內容。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `inbound-message-processing`：新增「去識別化服務短暫故障時重試一次」「去識別化服務無法使用時進站訊息存原文並標記未遮罩」「進站訊息未遮罩時發出維運告警」。
- `bot-handoff-config`：新增「未遮罩的進站訊息不交給 AI，轉接真人」「模型讀取的對話紀錄略過未遮罩的訊息」「程式固定的系統文字不呼叫去識別化服務」「去識別化服務無法使用時自動轉接照常完成」。

## Impact

- `apps/api/src/modules/ai/deidentification.service.ts`：重試、失敗原因代碼、`prepareInboundMessageContent()`、`isUnmaskedInbound()`、`readModelMessageContent()` 略過未遮罩訊息
- 新檔 `apps/api/src/modules/ai/deidentification-alert.ts`：進站降級的維運告警
- `apps/api/src/modules/webhook/inbound-message-writer.ts`、`inbound-side-effects.ts`、`inbound-postback-interceptors.ts`、`inbound-identity-binding.ts`
- `apps/api/src/channels/simulator/simulator.service.ts`
- `apps/api/src/modules/automation/automation.worker.ts`、`ai-failure-handoff.flow.ts`
- `apps/api/src/modules/ai/sentiment.service.ts`、`classify.service.ts`、`identity-binding/ai-guard.ts`
- `apps/api/src/modules/csat/csat.service.ts`、`conversation/conversation.service.ts`
- 不改資料表、不加 migration、不加權限碼。
