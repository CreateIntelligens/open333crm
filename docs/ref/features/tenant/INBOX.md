# 收件匣與對話

收件匣是客服的主畫面。左欄是對話清單，右欄是訊息與聯絡人資料。客服在這裡回覆客人、把對話從機器人手上接過來、指派給同事、關閉對話，或把對話開成工單。

- **資料來源**：`apps/api/src/modules/conversation/*`、`apps/api/src/modules/ai/ai.routes.ts`、`apps/api/src/modules/ai/ai.service.ts`、`apps/api/src/modules/automation/automation.worker.ts`、`apps/api/src/modules/webhook/inbound-postback-interceptors.ts`、`apps/api/src/services/channel-visibility.ts`、`apps/web/src/components/inbox/*`
- **核對日期**：2026-09-30

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `conversation` | 對話清單與篩選、訊息紀錄、送出文字與媒體、標記已讀、貼標、轉真人、指派、關閉、從對話開工單、閒置自動關閉 |
| `webhook` | 客人的訊息進站，見[租戶後台](./README.md#一則訊息進來之後) |
| `automation` 的 `automation.worker.ts` | 機器人回覆與自動轉真人。名稱雖然是自動化，這部分邏輯與自動化規則無關 |
| `ai` | 客服手動觸發的輔助功能 |
| `socket` | Socket 房間授權，決定客服收得到哪些對話的即時事件 |

## 對話的一生

一個聯絡人在一個渠道上，同時最多只有一個尚未關閉的對話。客人傳訊息時，`resolveInboundConversation()` 先找這個對話；找不到才建立新的。因此對話關閉後，客人再傳訊息會開啟一個新對話，不會重新打開舊的。

對話狀態定義在 `schema.prisma` 的 `enum ConversationStatus`：

| 狀態 | 誰負責回覆 | 怎麼進入 |
| --- | --- | --- |
| `BOT_HANDLED` | 機器人 | 新對話的預設狀態 |
| `AGENT_HANDLED` | 客服 | 渠道的 `botMode` 是 `off` 時直接以這個狀態建立；或經由[轉真人](#轉真人)的任一種方式 |
| `ACTIVE` | 客服，機器人不回覆 | 客服在收件匣把狀態選成「進行中」，或按下重新開啟。系統流程不會寫入這個值 |
| `CLOSED` | 無 | 見[關閉對話](#關閉對話) |

機器人只處理 `BOT_HANDLED` 的對話。其他三種狀態下，機器人不回覆，也不檢查自動轉真人。

## 機器人什麼時候回覆

機器人的設定存在渠道上（`Channel.settings.botConfig`），沒有設定的欄位套用 `automation.worker.ts` 的 `DEFAULT_BOT_CONFIG`。因此同一個租戶的不同渠道，可以有不同的機器人行為。

| 欄位 | 作用 |
| --- | --- |
| `botMode` | `keyword`、`llm`、`keyword_then_llm` 或 `off`。`off` 讓新對話直接交給客服 |
| `maxBotReplies` | 機器人在同一個對話最多回覆幾次，超過就自動轉真人 |
| `handoffKeywords` | 客人訊息含任一個關鍵字時，自動轉真人 |
| `handoffMessage` | 轉真人時送給客人的訊息 |
| `offlineGreeting` | 營業時間外的自動回覆，優先於營業時間設定的訊息 |
| `handoffPromptEnabled`、`handoffPromptStyle`、`handoffButtonLabel` | 機器人回答後，要不要附上「轉接客服」的提示，以及用按鈕還是文字 |

`setupAutomationWorker()` 收到 `message.received` 後，對 `BOT_HANDLED` 的對話依序做下列事情：

1. **檢查自動轉真人**（`checkAutoHandoff()`）。見[轉真人](#轉真人)。
2. **決定由誰回覆**。只處理純文字訊息。訊息會命中關鍵字規則時，讓給關鍵字規則回覆，AI 不回。
   - `botMode` 是 `llm` 或 `keyword_then_llm`，而且環境變數 `AGENTIC_LLM_ENABLED` 為 `true` 時，先由 AI agent 回覆。
   - AI agent 沒有處理時，改由 `kb-autoreply.service.ts` 的 `attemptKbAutoReply()` 依知識庫回覆。知識庫回覆怎麼決定內容，見[知識庫與 AI](./KNOWLEDGE.md#機器人怎麼用知識庫回答)。

同一個處理器接著對所有對話做情緒分析、送出規則評估與比對關鍵字，見[自動化](./AUTOMATION.md)。

## 轉真人

轉真人把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`。觸發方式如下：

| 方式 | 觸發條件 | 程式位置 | 指派給誰 |
| --- | --- | --- | --- |
| 客人要求 | 客人點「轉接客服」按鈕，或傳送 `handoff_request` | `inbound-postback-interceptors.ts` 的 `handleHandoffRequest()` | 不指派 |
| 自動轉真人 | 機器人回覆次數達到 `maxBotReplies`、訊息含 `handoffKeywords`，或客人傳圖片、檔案或影片 | `automation.worker.ts` 的 `checkAutoHandoff()` | 不指派 |
| 客服接手 | 客服按下接手（`POST /conversations/:id/handoff`） | `conversation.service.ts` 的 `handoffConversation()` | 指定的客服；沒指定就是按下的人 |

每種方式都會送一則轉接訊息給客人，並寫一則系統訊息。客人要求與自動轉真人送的是渠道設定的 `handoffMessage`；客服接手送的是請求帶的文字，沒帶就用預設文字。客人要求與自動轉真人會發布 `conversation.handoff` 事件。

客人要求與自動轉真人不指派任何人，對話會停在「未指派」。之後客人的每一則訊息，都會通知租戶內所有 `ADMIN` 與 `SUPERVISOR`，直到有人指派或接手，見[通知](./NOTIFICATIONS.md)。

客人在對話已經是 `AGENT_HANDLED` 時再按轉接按鈕，系統只重送 `handoffMessage`，不改任何狀態。

## 客服回覆怎麼送出

客服送出文字走 `POST /conversations/:id/messages`，圖片與影片走 `/send-image`、`/send-video`。這些路由最後都呼叫 `sendMessage()`，依序做下列事情：

1. 寫入一則 `OUTBOUND` 訊息，`senderType` 為 `AGENT`。
2. 更新對話的最後訊息時間，並把未讀數歸零。
3. 推送 `message.new`，收件匣即時顯示這則訊息。
4. 透過渠道外掛送給客人。WebChat 另外推送到訪客的 widget。
5. 發布 `message.sent` 事件。

要知道的事：

- **訊息先寫入、後送出。** 渠道送出失敗時，訊息仍然留在對話裡，看起來像已送出，見 `../../system/AUDIT.md` 的 CONV-03。
- **客服回覆不會改變對話狀態。** 對話是 `BOT_HANDLED` 時客服直接回覆，機器人仍會繼續回應客人的下一則訊息。要讓機器人停下來，必須先接手。
- **客服回覆不會指派對話。** 回覆的人不會自動成為負責人。
- **客服回覆在 LINE 上用 push。** `sendMessage()` 沒有帶 reply token，LINE 外掛以 push 送出，會計入 LINE 官方帳號的訊息額度。機器人的回覆則在 reply token 有效期間內優先用 reply，由 `selectSafeLineStrategy()` 判斷。
- **收到的媒體怎麼顯示。** 訊息泡泡顯示圖片、影片、語音播放器與檔案下載連結（檔名與大小），只採用瀏覽器打得開的網址（`apps/web/src/lib/inbox/message-media.ts`）。媒體還沒下載完成時顯示文字，例如「[語音]」「[檔案] 報價單.pdf」；下載失敗時在文字下方顯示原因（`content.mediaError`），例如「檔案超過 25 MB，未下載」。收到 `message.new` 後重新抓訊息，500 ms 內的多個事件合併，間隔結束後補抓一次，下載完成的通知不會被丟掉。2026-10-05 之前 LINE 的語音與檔案不會下載（issue #206），LINE 的圖片與影片也因為讀到 `line-content:` 佔位網址而顯示不出來。
- **媒體有類型與大小限制。** 圖片限 PNG 與 JPEG，影片限 MP4 與 QuickTime，上限寫在 `conversation.routes.ts` 的 `SEND_IMAGE_CONFIG` 與 `SEND_VIDEO_CONFIG`。只支援 LINE、Facebook 與 WebChat，其他渠道回 501。
- **文字內容會先驗證。** `validateOutboundMessage()` 擋掉空內容與不合法的 `contentType`，避免送一則空訊息給客人。

## 指派與狀態

收件匣右上角有兩個下拉選單：負責人與狀態。兩者都呼叫 `PATCH /conversations/:id`，由 `updateConversation()` 直接改欄位。

同一件事另有專用端點。兩條路的副作用不同：

| 動作 | 專用端點 | `PATCH /conversations/:id` |
| --- | --- | --- |
| 關閉 | `POST /:id/close`：記錄關閉原因、來源與操作者，發布 `conversation.closed` | 只改 `status`，不記原因，不發布事件 |
| 接手 | `POST /:id/handoff`：送出轉接訊息，寫系統訊息，指派給接手的人 | 狀態選單沒有 `BOT_HANDLED` → `AGENT_HANDLED` 以外的副作用 |
| 指派 | 無 | 只改 `assignedToId`，不發布事件，不通知被指派的人 |

`conversation.assigned` 事件在 API 行程沒有發布端。通知模組雖然訂閱了這個事件，被指派的客服實際上不會收到通知。詳見 `../../system/AUDIT.md` 的 CONV-02。

狀態選單的標籤與值不一致：「已處理」送出的值是 `AGENT_HANDLED`，意思是「由客服處理中」，不是「處理完畢」。

## 關閉對話

對話會在下列情況關閉。`closeConversation()` 把來源記在 `Conversation.metadata.closeSource`：

| 來源 | `closeSource` | 觸發 |
| --- | --- | --- |
| 客服手動 | `manual` | `POST /conversations/:id/close` |
| 閒置 | `inactivity` | `setupInactivityCloseWorker()` 定期掃描 |
| CSAT 逾時 | `csat` | 工單發出滿意度調查後逾時未回，CSAT 排程關閉工單時連帶關閉 |

`closeConversation()` 是冪等的：已關閉的對話再關一次，直接回傳現況，不重複發布事件。

**閒置自動關閉。** 排程定期找出 `lastMessageAt` 早於時限、尚未關閉的對話，逐一關閉。時限讀 `TenantSettings.inactivityCloseHours`，值小於等於 0 代表停用。這個欄位沒有維護介面，見 `../../system/AUDIT.md` 的 CONV-01。閒置關閉不分狀態，`BOT_HANDLED` 的對話也會被關閉。

## 誰看得到哪些對話

同一個租戶內，成員不一定看得到所有渠道。這個功能用在「總店與分店」的情境：分店店員只看自己分店的渠道，總店主管看全部。規則在 `services/channel-visibility.ts`，程式怎麼套用見[權限計算](../../modules/PERMISSIONS.md#渠道可見範圍)：

- 持有 `channel.view_all` 的成員看得到所有渠道。
- 其他成員看得到兩種渠道：直接綁給自己的，以及綁給自己所屬團隊的。
- 沒有綁定任何成員或團隊的渠道，所有人都看得到。這是為了相容功能上線前建立的渠道。

可見的渠道再分三個層級，由低到高是 `read_only`、`reply_only`、`full`。同一個渠道有多個來源時，取最高的層級。收件匣的操作要求的層級如下：

| 層級 | 允許的操作 |
| --- | --- |
| `read_only` | 讀對話與訊息、標記已讀 |
| `reply_only` | 回覆、送媒體、貼標、送出正在輸入的提示 |
| `full` | 改狀態、指派、關閉、接手、開工單 |

渠道看不見時回 404，看得見但層級不足時回 403。看不見時不回 403，是為了不透露其他分店的對話是否存在。

**即時事件沒有套用可見範圍。** 客服訂閱單一對話的房間時，`authorizeSocketRoom()` 用同一套規則檢查。但每條 socket 連線一建立就自動加入 `tenant:<租戶 ID>` 房間，而新訊息事件 `message.new` 會帶著訊息內容發到這個房間。因此只能看某些渠道的客服，仍會即時收到租戶內所有渠道的訊息。見 `../../system/AUDIT.md` 的 RBAC-04。

`assertConversationChannelVisible()` 另外有一段團隊限制：對話綁了團隊時，只有負責人與該團隊成員能操作。`Conversation.teamId` 目前沒有任何寫入端，因此這段檢查不會觸發，見 `../../system/AUDIT.md` 的 TEAM-01。

可見範圍只套用在收件匣與工單的 REST 路由，以及單一對話的 socket 房間。租戶房間的即時事件、聯絡人清單與合併、AI 輔助端點都沒有套用，見 `../../system/AUDIT.md` 的 RBAC-04。

## AI 輔助

`ai` 模組提供客服按鈕觸發的輔助功能。每一次呼叫都呼叫 LLM，用量記在租戶名下，計算方式見[用量統計](../platform/USAGE.md)。

| 端點 | 輸入 | 做什麼 |
| --- | --- | --- |
| `POST /ai/suggest-reply` | `conversationId` | 讀對話紀錄，檢索知識庫，產生建議回覆 |
| `POST /ai/summarize` | `conversationId` | 摘要整段對話 |
| `POST /ai/analyze-sentiment` | 文字 | 判斷情緒 |
| `POST /ai/classify` | 文字 | 判斷問題分類 |
| `POST /ai/rewrite` | 文字與動作 | 潤稿、縮短或改語氣 |
| `POST /ai/agent/run` | 文字 | 手動執行 AI agent。需要 `inbox.reply`，而且 `AGENTIC_LLM_ENABLED` 為 `true` |

除了 `/ai/agent/run`，其他端點只驗登入，沒有權限碼，見 `../../system/AUDIT.md` 的 PLAN-12。以 `conversationId` 為輸入的端點不檢查渠道可見範圍，見 RBAC-04。

## 權限

對話的路由以權限碼檢查，並另外檢查渠道可見範圍（見[誰看得到哪些對話](#誰看得到哪些對話)）：

| 動作 | 權限 |
| --- | --- |
| 列表、單筆、訊息、標為已讀 | `inbox.view` |
| 送出文字、圖片、影片，以及「輸入中」狀態 | `inbox.reply` |
| 修改對話（指派、狀態）、貼標與移除標籤、關閉、轉真人 | `inbox.manage` |
| 從對話建立工單 | `inbox.view` 與 `case.create`；同時指派負責人或團隊時另需 `case.assign` |

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **客服回覆送出失敗時，介面沒有標示** | 詳見 `../../system/AUDIT.md` 的 CONV-03 |
| **指派對話不會通知被指派的人** | 詳見 `../../system/AUDIT.md` 的 CONV-02 |
| **即時事件、聯絡人清單與 AI 輔助不套用渠道可見範圍** | 詳見 `../../system/AUDIT.md` 的 RBAC-04 |
| 狀態下拉選單繞過關閉的紀錄與事件 | 詳見 `../../system/AUDIT.md` 的 CONV-02 |
| 閒置時限沒有維護介面 | 詳見 `../../system/AUDIT.md` 的 CONV-01 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
