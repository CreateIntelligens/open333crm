## Why

Issue #419（AUDIT KB-01、健檢 HC-KNOWLEDGE-01）：知識庫自動回覆的追問次數用完時，機器人送出「…已為您轉接客服人員，請稍候」，
但只寫了這則訊息，沒有改對話狀態。對話仍是 `BOT_HANDLED`，沒有 `handoffReason`、沒有系統訊息，客服收不到；客人再傳訊息，
又收到同一句。真正的轉接要等機器人回覆數達到渠道的 `maxBotReplies` 才發生，`maxBotReplies` 調高的渠道，客人會一直收到假的
轉接訊息。追問的 LLM 呼叫失敗（含月額度用完的 `PLAN_LIMIT_EXCEEDED`）時也送同一句。

另外 `conversation.handoff` 事件沒有通知訂閱者：主規格「Webhook intercepts handoff_request postback」寫事件讓主管與管理員
收到通知，但 outbox 只把它送給對外 webhook，任何轉接都沒有站內通知。

## What Changes

- 追問次數用完（`clarify_handoff`）或追問的 LLM 呼叫失敗時，在送出「已為您轉接」的同一個交易真的轉接：條件更新對話為
  `AGENT_HANDLED`、寫 `handoffReason`、寫系統訊息、發出 `conversation.handoff`，commit 後推播到渠道房間（`notifyChannel`）。
- 抽出共用的轉接步驟 `handOffConversation()`（`apps/api/src/modules/automation/handoff.flow.ts`，資料寫入在
  `handoff.service.ts`），自動轉接 `checkAutoHandoff()` 與 KB 追問用完都用它。
- 轉接時追問次數歸零，客服交回 Bot 之後重新計算。
- `conversation.handoff` 加入通知訂閱者：通知負責客服，沒有指派時通知主管與管理員（通知類型 `conversation_handoff`，
  鈴鐺與通知頁顯示「轉接真人」）。
- 規格寫明轉接後關鍵字規則的行為：命中關鍵字的訊息由關鍵字規則回覆、不算追問；轉接後關鍵字規則照樣回覆，KB 與 agent 不回覆。
- `kb-autoreply.service.ts` 步驟 2.5 的註解改寫：原註解說轉接後關鍵字規則「無法回」，但 workers 執行關鍵字規則不看對話狀態。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `bot-handoff-config`：新增「知識庫追問用完或 AI 失敗時轉接真人」「轉接後關鍵字規則照常回覆」「轉接真人時通知客服」。
  修改「Webhook intercepts handoff_request postback」：通知對象指向新需求（指派時通知負責人），渠道推播的情境加上知識庫轉接。
  `integrate-clef-decision-model`（未歸檔）在同一個 capability 新增的是不同名稱的需求，沒有修改這條，沒有衝突。

## Impact

- `apps/api/src/modules/ai/kb-autoreply.service.ts`、`apps/api/src/modules/automation/automation.worker.ts`、
  新增 `handoff.flow.ts`、`handoff.service.ts`。
- `packages/core/src/outbox/queues.ts`（通知訂閱的事件）、`apps/api/src/modules/notification/notification.worker.ts`。
- `apps/web` 的 `NotificationBell.tsx` 與通知頁加上 `conversation_handoff` 的圖示與標籤。
- 所有轉接路徑（自動轉接、KB、`handoff_request` 按鈕）都會多一則站內通知。
- 文件：`docs/ref/features/tenant/KNOWLEDGE.md`、`docs/ref/features/health/KNOWLEDGE.md`、相關 feature skill。
