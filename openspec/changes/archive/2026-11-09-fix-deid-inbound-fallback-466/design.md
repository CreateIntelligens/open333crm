## Context

進站管線（`webhook.service.ts` 的 `processInboundMessage()`）還沒有搬遷到 flow（#337 階段 4），以傳入的 client 逐一查詢，沒有包在交易裡。`createInboundMessage()` 在 `message.create` 之前呼叫去識別化服務；服務失敗時丟出 `AI_DEIDENTIFICATION_UNAVAILABLE`，整個處理中止。

AI 回覆在 `automation.worker.ts` 的 `message.received` 處理。所有模型呼叫都經過 `getPrivacyAwareChatProvider()`，送出前會再呼叫一次去識別化服務，所以原文不會直接送到模型。但這層保護依賴「去識別化服務仍然失敗」：服務在進站與 AI 處理之間恢復時，AI 會照常回覆，客服不知道這則訊息沒有遮罩副本。

## Goals / Non-Goals

**Goals**

- 進站訊息一定存下來，客服在收件匣看得到。
- 沒有遮罩副本的訊息不交給模型，改由客服接手，收件匣看得到原因。
- 短暫故障自動恢復；持續故障讓維運知道。

**Non-Goals**

- 不加備援的去識別化服務，也不把網址改成環境變數（issue 提到，另案處理）。
- 不補做遮罩：服務恢復後，未遮罩的訊息不會自動補上遮罩副本。
- 不改 AI 回覆時去識別化失敗的處理（#445 已處理）。

## Decisions

### D1：重試放在去識別化用戶端（`maskTexts()`）

所有呼叫 2md 的路徑都受益（進站、AI 包裝、embedding）。每次嘗試有自己的逾時（6 秒），重試前等 300 毫秒。原本整批 10 秒；改成 6 秒 + 300 毫秒 + 6 秒，最壞約 12.3 秒。UAT 實測正常回應約 0.6 秒，6 秒仍有十倍餘裕。網站聊天室的送出是同步的 HTTP 請求，最壞延遲與原本相近。

失敗分類：逾時（我們的 AbortController 觸發，或 fetch 丟 `TimeoutError`／`AbortError`）、連線錯誤（fetch 丟出的其他錯誤，例如 DNS 解析失敗）、5xx 會重試；4xx、回應格式不符、回應過大、文字過長不重試。錯誤仍是固定訊息的 `AppError`，`details.reason` 只帶原因代碼，不帶上游回應或原文。

### D2：進站降級用新函式 `prepareInboundMessageContent()`

`prepareStoredMessageContent()` 的語意不變（失敗就丟錯），其他寫入路徑（座席回覆、AI 回覆）仍然不可以存未遮罩的內容。新函式只給進站用，捕捉 `AI_DEIDENTIFICATION_UNAVAILABLE`，回傳原文與 `{ mode: 'inbound_unmasked', reason }`，並回傳 `unmaskedReason` 讓呼叫端發告警。網站聊天室模擬器（`simulator.service.ts`）也是進站，一起改用。

### D3：AI 流程以事件 payload 的旗標判斷

`publishMessageReceived()` 從剛存入的訊息 metadata 判斷（`isUnmaskedInbound()`），在 payload 加 `privacyUnmasked: true`。worker 已經從 payload 讀文字，不另查資料庫。

worker 在原本呼叫 agent／知識庫的位置判斷：關鍵字規則讓步時照舊不處理；`botMode` 會跑 AI（`shouldRunAgentReply()`）且 agent 或知識庫至少一個啟用時，呼叫 `handOffAfterAiFailure()`，帶入固定的轉接原因與 `source: 'inbound_unmasked'`。沿用它的 `bot_reply` 認領、`handOffConversation()` 與固定文字系統訊息，每則訊息最多轉接一次。

### D4：模型讀取函式略過未遮罩的訊息

`readModelMessageContent()` 與 `toAiHistory()` 的 `modelText()` 對 `inbound_unmasked` 回傳空字串（呼叫端已經略過空字串）。`autoClassifyNewCase()` 讀原文，另外加判斷。這是 D3 之外的第二層：即使之後有新的模型呼叫漏了旗標，也讀不到原文。

### D5：維運告警

`deidentification-alert.ts` 的 `alertInboundUnmasked()` 呼叫 `sendOpsAlert()`（合併鍵 `deidentification-unavailable`，10 分鐘內只送一則，下一則帶上期間內未送出的次數）。每則降級的訊息都呼叫一次，由 `sendOpsAlert()` 節流；不另外計算「連續失敗」：每次降級本身已是連續兩次呼叫失敗。進站管線拿不到 `fastify.redis`，所以預設用 `getSharedRedis()`（`lib/redis-client.ts` 的說明列出 webhook 收訊流程是暫時的使用者），可注入。告警失敗只記 log。

### D6：固定系統文字

只改確定不含顧客輸入或名稱的常數文字（見 spec）。綁定訊息帶顧客在其他渠道的顯示名稱，交回 Bot 訊息帶座席名稱，維持 `system_template`（呼叫 2md）。

### D7：自動轉接的系統訊息遮罩失敗時改用固定文字

`checkAutoHandoff()` 在交易前把「自動轉接人工客服：<原因>」加上對話摘要送去遮罩。摘要是模型輸出（模型失敗時是含顧客名稱的固定範本），必須遮罩；2md 無法使用時原本丟出錯誤，`message.received` 失敗重試，對話一直轉不出去，未遮罩的訊息也因 `handoffFailed` 不會走 D3 的轉接。改為只捕捉去識別化失敗（`deidentificationFailureReason()`），捨棄摘要，以 `fixedSystemMessageContent()` 寫入「自動轉接人工客服：<原因>」。原因只有程式的固定文字與租戶設定的轉接關鍵字，不含顧客輸入。其他錯誤照舊往外丟、由佇列重試。

### 與未歸檔的 `add-admin-ai-deidentification` 的關係

能力 `ai-input-deidentification` 只存在於未歸檔的 change `add-admin-ai-deidentification`，`openspec/specs/` 沒有這份主規格，這個 change 無法對它寫 `MODIFIED`，所以需求放在已存在的 `inbound-message-processing` 與 `bot-handoff-config`。那份 change 的「Masking storage failure preserves no unclassified model path」與「Fixed system wording keeps its authored text（mode `system_template`）」和這裡的行為不同：進站訊息改為存原文並標記 `inbound_unmasked`，部分固定文字改為 `system_fixed`。歸檔那份 change 之前要先改寫這兩段。

## 每個步驟的保證

| 步驟 | 失敗時 | 資料在哪 | 誰重做 | 保證 |
| --- | --- | --- | --- | --- |
| 呼叫 2md（交易外） | 重試一次，仍失敗就降級 | 記憶體 | 無 | 每則訊息最多兩次 |
| 存訊息 | 丟錯（與原本相同） | 無 | 渠道平台重送 | 以平台訊息 ID 去重 |
| 發告警（存訊息之後、交易外） | 只記 log | Redis／ops-alert 佇列 | ops-alert 佇列重試送出 | 合併後至少一次 |
| 轉接（worker，`bot_reply` 認領的交易） | 丟錯，佇列重試 `message.received` | 資料庫 | BullMQ | 每則訊息最多一次 |
| 送出轉接訊息（commit 之後） | 只記 log | 無 | 無 | 最多一次 |

## Risks / Trade-offs

- 降級時資料庫存了沒有遮罩副本的原文：這和「遮罩開啟時進站訊息本來就存原文、另存遮罩副本」一致，原文只給客服看；模型讀不到（D3、D4）。
- 客服接手之後，未遮罩的訊息仍在對話紀錄裡；之後交回 Bot，AI 讀歷史時會略過它，AI 可能缺少這則的脈絡。
