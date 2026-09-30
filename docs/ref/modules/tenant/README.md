# 租戶後台（dashboard）

租戶後台是租戶的客服與管理員每天使用的介面。客服在這裡回覆客人、處理工單。管理員在這裡設定渠道、自動回覆、人員與權限，也在這裡發送行銷訊息。

本文件從租戶後台的功能區出發，說明每一區由哪些模組負責、每個模組做什麼，以及模組之間怎麼接力。單一模組的完整機制另有專文，本文件只連結過去。

- **資料來源**：`apps/api/src/index.ts`、`apps/api/src/modules/*`、`apps/workers/src/*`、`apps/web/src/app/dashboard/*`、`apps/web/src/components/layout/Sidebar.tsx`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-09-30

## 先讀這一段

租戶後台的模組分成五組，對應客服中心的五件事：

1. **接住訊息**：客人從 LINE、Facebook 等渠道傳訊息進來。系統找出或建立聯絡人與對話，再推到收件匣。
2. **先讓系統處理**：客服接手之前，機器人依關鍵字、知識庫或 AI 自動回覆。自動化規則依事件貼標、指派、發通知。
3. **追蹤處理結果**：需要追蹤的問題開成工單，由 SLA 計時。工單解決後系統發出滿意度調查，數字進入報表。
4. **主動觸及客人**：群發訊息、舉辦粉絲活動、發送短連結，並追蹤誰點了、誰回了。
5. **管理租戶**：渠道、人員、角色、營業時間、AI 設定與方案。

多數模組只屬於其中一組。自動化是例外：它訂閱第 1 組產生的事件，替第 2 組與第 3 組做事。

模組掛在哪個路由前綴、需要哪個權限碼，見[模組總覽](../OVERVIEW.md)。本文件不重複那些表。

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 側欄的每一項由哪個模組負責？ | [側欄與模組對照](#側欄與模組對照) |
| 一則訊息進來之後，經過哪些模組？ | [一則訊息進來之後](#一則訊息進來之後) |
| 機器人什麼時候回覆？什麼時候轉給真人？ | [收件匣與對話](#收件匣與對話) |
| 工單怎麼指派？解決之後會發生什麼？ | [工單](#工單) |
| 自動化規則在哪裡執行？ | [自動化](#自動化) |
| 群發、素材、分群之間是什麼關係？ | [行銷](#行銷) |
| 設定頁的每個分頁由哪個模組負責？ | [設定](#設定) |
| 哪些功能有 API、沒有頁面？ | [沒有頁面的功能](#沒有頁面的功能) |
| 為什麼側欄看得到，點進去卻回 403？ | [側欄顯示與 API 權限](#側欄顯示與-api-權限) |
| 目前有哪些已知問題？ | [目前的限制](#目前的限制) |

## 側欄與模組對照

「主要模組」持有該頁的資料與路由。「協作模組」是這一頁的功能會用到、但資料不歸這一頁的模組。

| 側欄 | 頁面 | 主要模組 | 協作模組 |
| --- | --- | --- | --- |
| 收件匣 | `/dashboard/inbox` | `conversation` | `webhook`（訊息進站）、`ai`（回覆輔助）、`socket`（即時推送） |
| 工單 | `/dashboard/cases` | `case` | `csat`、`sla`、`notification` |
| 聯絡人 | `/dashboard/contacts` | `contact` | `tag` |
| 通知 | `/dashboard/notifications` | `notification` | `apps/workers` 的 notification handler |
| 自動化 | `/dashboard/automation` | `automation` | `apps/workers` 的 automation handler |
| 知識庫 | `/dashboard/knowledge/*` | `knowledge` | `embedding`、`ai`、`settings`（Embedding 與 Chat 設定） |
| 行銷 | `/dashboard/marketing/*` | `marketing` | `shortlink`（素材內的連結）、`tag` |
| 渠道 | `/dashboard/line/*` | `line` | `automation`（關鍵字回覆）、`marketing`（素材） |
| 粉絲活動 | `/dashboard/portal/*` | `portal` | 無 |
| 短連結 | `/dashboard/shortlinks/*` | `shortlink` | `tag`（點擊貼標）、`settings`（追蹤碼） |
| 報表 | `/dashboard/analytics`、`/dashboard/analytics/my` | `analytics` | 無 |
| 方案／帳務 | `/dashboard/plan` | `platform` 的 plan-change 部分 | `platform/plan-limits.service.ts`、`trial/token-quota.service.ts` |
| 設定 | `/dashboard/settings/*` | 依分頁而不同 | 見[設定](#設定) |

側欄的定義在 `Sidebar.tsx` 的 `NAV_TREE`。側欄的「渠道」只放 LINE 專用的工具；新增與管理渠道本身在「設定 → 渠道管理」。

## 一則訊息進來之後

這條路徑是租戶後台大部分功能的起點，因此先講。

渠道平台呼叫 `/api/v1/webhooks/<渠道>/:channelId`。`webhook` 模組驗證簽章之後，`webhook.service.ts` 的 `processInboundMessage()` 依序執行下表的步驟。

| 步驟 | 函式 | 做什麼 | 涉及的模組 |
| --- | --- | --- | --- |
| 1 | `resolveInboundContact()` | 依渠道身分（`ChannelIdentity`）找出聯絡人，找不到就建立 | `contact` |
| 2 | `resolveInboundConversation()` | 找出該聯絡人在該渠道尚未關閉的對話，找不到就建立。新對話的初始狀態看渠道的機器人設定：`botMode` 是 `off` 時為 `AGENT_HANDLED`，其他值為 `BOT_HANDLED` | `conversation` |
| 3 | `findDuplicateInboundMessage()`、`createInboundMessage()` | 排除渠道重送的重複訊息，然後寫入訊息 | `conversation` |
| 4 | `updateConversationAfterInboundMessage()` | 更新對話的最後訊息時間與未讀數 | `conversation` |
| 5 | `sendFirstContactGreeting()` | 聯絡人第一次進站、而且渠道設定了 `firstContactGreeting` 時，送出招呼語 | `channel` |
| 6 | `runInboundPostbackInterceptors()` | 處理按鈕回傳。點擊貼標處理完會繼續往下；CSAT 評分、知識庫回饋、轉真人這三種處理完，管線就在這一步結束 | `tag`、`csat`、`knowledge`、`conversation` |
| 7 | `trackInboundBroadcastReply()` | 把這次回覆記到該聯絡人最近一筆群發的收件紀錄 | `marketing` |
| 8 | `emitInboundSocketEvents()` | 推送 `message.new` 與 `conversation.updated`，收件匣即時更新 | `socket` |
| 9 | `publishMessageReceived()` | 在 eventBus 發布 `message.received` | 見下表 |
| 10 | `triggerWebhookFlow()` | 觸發 Canvas 流程 | `canvas` |
| 11 | `sendOutsideHoursAutoReply()` | 營業時間外送出自動回覆。同一個聯絡人在去重間隔內只回一次 | `settings`（營業時間） |

第 9 步發布的 `message.received`，訂閱者都在 API 行程：

| 訂閱者 | 做什麼 |
| --- | --- |
| `automation.worker.ts` 的 `setupAutomationWorker()` | 機器人回覆、情緒分析與規則評估，細節見[收件匣與對話](#收件匣與對話)與[自動化](#自動化) |
| `notification.worker.ts` 的 `setupNotificationWorker()` | 發出「收到新訊息」通知。對話已指派時只通知負責人；未指派時通知所有 `ADMIN` 與 `SUPERVISOR` |
| `webhook-dispatcher.ts` 的 `setupWebhookDispatcher()` | 轉發給租戶訂閱了這個事件的外部 URL |

eventBus 是 API 行程內的 `EventEmitter`，不經過 Redis。需要查資料或會拖慢回應的工作，再由訂閱者送進 BullMQ，交給 `apps/workers` 處理。兩個行程的分工見[模組總覽](../OVERVIEW.md#背景工作的歸屬)。

## 收件匣與對話

收件匣是客服的主畫面。左欄是對話清單，右欄是訊息與聯絡人資料。

| 模組 | 負責什麼 |
| --- | --- |
| `conversation` | 對話清單與篩選、訊息紀錄、送出文字與媒體、標記已讀、轉真人、關閉對話、從對話開工單。閒置自動關閉的排程也在這裡 |
| `webhook` | 訊息進站，見上一節。對外送出不經過這個模組 |
| `ai` | 客服按鈕觸發的輔助功能：建議回覆、摘要、情緒分析、分類、改寫。也提供 AI agent 的執行入口 |
| `socket` | Socket 房間的授權。客服只收得到自己看得見的渠道的事件 |

### 對話的狀態

對話狀態定義在 `schema.prisma` 的 `enum ConversationStatus`：

| 狀態 | 意思 | 怎麼進入 |
| --- | --- | --- |
| `BOT_HANDLED` | 機器人負責回覆 | 新對話的預設狀態 |
| `AGENT_HANDLED` | 客服負責回覆 | 渠道的 `botMode` 是 `off`、客人要求轉真人、機器人觸發自動轉真人，或客服按下轉真人 |
| `ACTIVE` | 進行中，機器人不回覆 | 客服在收件匣把狀態選成「進行中」，或重新開啟已關閉的對話。系統流程不會寫入這個值 |
| `CLOSED` | 已關閉 | 客服關閉、工單因 CSAT 逾時被自動關閉時連帶關閉，或閒置超過時限 |

閒置自動關閉由 `inactivity-close.worker.ts` 的 `setupInactivityCloseWorker()` 定期掃描。時限讀 `TenantSettings.inactivityCloseHours`，值小於等於 0 代表關閉這個功能。這個欄位沒有任何頁面或 API 能修改，租戶一律使用 schema 的預設值，要調整只能直接改資料庫。見 `../../system/AUDIT.md` 的 CONV-01。

### 機器人什麼時候回覆

機器人的設定存在渠道上（`Channel.settings.botConfig`），沒有設定的欄位套用 `automation.worker.ts` 的 `DEFAULT_BOT_CONFIG`。因此同一個租戶的不同渠道可以有不同的機器人行為。

`setupAutomationWorker()` 收到 `message.received` 後，依序做下列事情。第 1 步與第 2 步只對 `BOT_HANDLED` 的對話執行，第 3 步到第 5 步對所有對話都執行。

1. **檢查是否自動轉真人**（`checkAutoHandoff()`）。符合任一條件就把對話改成 `AGENT_HANDLED`：機器人回覆次數達到 `maxBotReplies`、訊息含 `handoffKeywords` 的任一個關鍵字，或客人傳的是圖片、檔案或影片。
2. **決定由誰回覆**。只處理純文字訊息。訊息會命中關鍵字規則時，讓給關鍵字規則回覆，AI 不回。
   - `botMode` 是 `llm` 或 `keyword_then_llm`，而且環境變數 `AGENTIC_LLM_ENABLED` 為 `true` 時，先由 AI agent 回覆。
   - AI agent 沒有處理時，改由 `kb-autoreply.service.ts` 的 `attemptKbAutoReply()` 依知識庫回覆。
3. **情緒分析**。每一則文字訊息都做，結果寫進訊息的 `metadata`。負面且信心值夠高時，發布 `sentiment.negative`。
4. **送出規則評估**。把 `message.received` 送進 `automation` queue，由 workers 評估自動化規則。
5. **比對關鍵字規則**。命中時發布 `keyword.matched`，關鍵字回覆由此觸發。

知識庫自動回覆依相似度分三段處理，說明在 `kb-autoreply.service.ts` 的檔頭註解：

| 相似度 | 處理 |
| --- | --- |
| 0.80 以上 | 以知識庫內容為依據，由 LLM 直接回答 |
| 門檻值到 0.80 之間 | 以知識庫內容為依據由 LLM 回答，並在回答後附上轉真人提示 |
| 低於門檻值，或沒有相關文章 | 追問一個問題釐清需求。追問次數有上限，超過就轉真人 |

## 工單

對話是「客人說了什麼」，工單是「這件事處理完了沒」。一個工單可以連結多個對話。

| 模組 | 負責什麼 |
| --- | --- |
| `case` | 工單的建立、指派、狀態轉換、升級、備註、標籤與事件紀錄。自動指派在 `assignment.service.ts` |
| `csat` | 工單解決後發送滿意度調查，並記錄分數。沒有路由，由排程與進站攔截器呼叫 |
| `sla` | SLA 政策的 CRUD。逾時的判定與處置在 `apps/workers`，見[服務水準協議](../SLA.md) |
| `notification` | 指派與升級時通知相關人員 |

### 工單的狀態

合法的狀態轉換定義在 `packages/shared` 的 `VALID_CASE_TRANSITIONS`，API 以 `case-state-machine.ts` 的 `validateTransition()` 檢查：

| 目前狀態 | 可以轉成 |
| --- | --- |
| `OPEN` | `IN_PROGRESS`、`CLOSED` |
| `IN_PROGRESS` | `PENDING`、`RESOLVED`、`ESCALATED`、`CLOSED` |
| `PENDING` | `IN_PROGRESS`、`ESCALATED`、`CLOSED` |
| `RESOLVED` | `CLOSED`、`IN_PROGRESS` |
| `ESCALATED` | `IN_PROGRESS`、`CLOSED` |
| `CLOSED` | `OPEN` |

改狀態有兩條路，副作用不同，見 `../../system/AUDIT.md` 的 CASE-01：

- **專用端點**：`POST /cases/:id/resolve`、`/close`、`/reopen`、`/escalate`。會寫入 `CaseEvent`，並發布 `case.resolved`、`case.closed` 或 `case.escalated` 事件。
- **`PATCH /cases/:id` 帶 `status`**：工單詳情頁的狀態下拉選單走這一條。只改欄位與推送 socket，不寫 `CaseEvent`，也不發布事件。

### 指派

建立工單時沒有指定負責人、但有指定團隊，`autoAssignCase()` 會在團隊內自動指派。規則是挑未結工單最少的人，同數時輪流。

候選人只限 `role` 欄位是 `AGENT` 的成員。`role` 是舊的三級角色列舉，不是「角色與權限」頁設定的細粒度角色，見 `../../system/AUDIT.md` 的 RBAC-03。

### 解決之後

`csat.scheduler.ts` 的 `setupCsatScheduler()` 定期執行下列工作：

1. 工單轉成 `RESOLVED` 一段時間後，對連結的對話發送滿意度調查。
2. 發出調查後超過時限仍沒有回覆，自動把工單轉成 `CLOSED`。

客人點選分數時，進站管線第 6 步的 CSAT 攔截器記錄分數。WebChat 或人工記錄走 `POST /cases/:id/csat`。延遲與時限是 `csat.scheduler.ts` 開頭的常數，租戶不能調整。

CSAT 排程自動關閉工單時，會呼叫 `closeConversationsForCase()` 關閉該工單所有尚未關閉的對話。客服以 `/close` 或下拉選單關閉工單時，不會連帶關閉對話。

## 聯絡人與標籤

| 模組 | 負責什麼 |
| --- | --- |
| `contact` | 聯絡人清單、資料編輯、歷史對話與工單、時間軸、手動合併 |
| `tag` | 標籤的 CRUD，以及對聯絡人、對話、工單貼標與移除 |
| `canvas` 的 identity 部分 | 系統自動產生的合併建議，由人工核准或駁回。沒有頁面，見[沒有頁面的功能](#沒有頁面的功能) |
| `line` 的 line-profile 部分 | 重新向 LINE 抓取聯絡人的名稱與頭像。沒有頁面 |

一個聯絡人可以有多個渠道身分。`ChannelIdentity` 以 `(channelId, uid)` 唯一，因此同一個人從 LINE 與 Facebook 進來，一開始是兩個聯絡人。合併之後，次要聯絡人的渠道身分、對話與工單改掛到主要聯絡人。次要聯絡人不刪除，而是設為封存（`isArchived`），並以 `mergedIntoId` 指向主要聯絡人。

標籤有兩個分類維度：

- **`scope`**：標籤能貼在哪種對象上，值為 `CONTACT`、`CONVERSATION`、`CASE`、`MATERIAL`。貼標時 scope 不符會被拒絕。同一個租戶內，名稱加 scope 不能重複。
- **`type`**：標籤的來源，值為 `MANUAL`、`AUTO`、`SYSTEM`、`CHANNEL`。

對聯絡人貼標會發布 `contact.tagged`，自動化規則可以訂閱這個事件。事件帶有貼標來源，規則據此避免「自動化貼標 → 觸發自動化 → 再貼標」的迴圈。

## 通知

| 模組 | 負責什麼 |
| --- | --- |
| `notification`（API 行程） | 訂閱 eventBus，決定誰該收到通知，把工作送進 `notification` queue。也提供通知清單、未讀數與標記已讀的路由 |
| `apps/workers` 的 notification handler | 寫入通知紀錄，並透過 Redis 推送給前端 |

API 行程會送出通知的事件：

| 事件 | 收件人 |
| --- | --- |
| `message.received` | 對話的負責人；未指派時，所有 `ADMIN` 與 `SUPERVISOR` |
| `conversation.assigned` | 被指派的客服 |
| `case.assigned` | 被指派的客服 |
| `case.escalated` | 所有 `ADMIN` 與 `SUPERVISOR` |
| `usage.quota.threshold` | 所有 `ADMIN` |

SLA 的預警與逾時通知由 workers 的 SLA handler 直接送出，不經過上表，見[服務水準協議](../SLA.md)。

收件人以 `role` 欄位判斷，與工單指派相同，見 RBAC-03。

## 自動化

自動化規則是「某事件發生時，符合條件就執行動作」。側欄的「自動化」與「渠道 → LINE 關鍵字回覆」兩頁，底層都是 `AutomationRule`。

| 模組 | 負責什麼 |
| --- | --- |
| `automation`（API 行程） | 規則的 CRUD、試跑（`POST /rules/:id/test`）、執行紀錄查詢。訂閱 eventBus，把事件送進 `automation` queue |
| `apps/workers` 的 `automation.handler.ts` | 取出該事件的啟用規則，評估條件，執行命中規則的動作 |
| `packages/automation` | 規則的契約：每個事件提供哪些資料、允許哪些條件與動作，以及規則引擎本身 |

一條規則由三部分組成，存在 `AutomationRule` 的 JSON 欄位：

| 部分 | 欄位 | 內容 |
| --- | --- | --- |
| 觸發事件 | `eventType` | 例如 `message.received`、`keyword.matched`、`case.created`、`contact.tagged` |
| 條件 | `conditions` | json-rules-engine 格式。可用的事實（fact）依事件而不同 |
| 動作 | `actions` | 動作陣列，例如貼標、指派、發通知、傳訊息、傳素材 |

**規則在 workers 行程執行。** 2026-05-12 的 `9255245` 把規則執行從 API 行程搬到 workers。搬遷時 workers 只實作了一部分動作。前端提供、但 workers 沒有實作的動作，儲存與命中都正常，執行時只記一行 log 就略過，見 `../../system/AUDIT.md` 的 AUTO-01。規則的執行紀錄與執行次數也從那時起停止更新，見 AUTO-02。

**關鍵字回覆**是 `keyword.matched` 事件加上「傳送素材」動作的規則。前端把它包成獨立頁面，說明在 `line/keyword-replies/page.tsx` 的檔頭註解。

**Canvas** 是另一套多步驟流程引擎，與自動化規則互不相干。它由進站管線第 10 步觸發，機制見[互動流程引擎](../CANVAS-FLOW-ENGINE.md)。Canvas 目前沒有後台頁面。

## 知識庫與 AI

| 模組 | 負責什麼 |
| --- | --- |
| `knowledge` | 文章的 CRUD、發布與封存、檔案上傳與解析、批次產生向量、語意搜尋、客人回報的處理。也接收外部夥伴系統的文件匯入 |
| `embedding` | 產生向量與 pgvector 檢索。沒有路由，由 `knowledge` 與 `ai` 呼叫 |
| `ai` | 機器人回覆（AI agent 與知識庫自動回覆）、客服輔助功能、LLM 呼叫、模型與價目 |
| `settings` 的 embedding、chat、gemini-key 部分 | 各租戶的 Embedding 模型、Chat 模型與提示詞，以及租戶自備的 Gemini 金鑰 |

文章有三種狀態：`DRAFT`、`PUBLISHED`、`ARCHIVED`。機器人只檢索已發布的文章。

**客人回報。** 機器人回答時附上「有幫助／沒幫助」按鈕。客人按下後，進站管線第 6 步的攔截器記錄回饋。管理員在「知識庫 → 回報調教」查看各文章的回報，並標記為已處理。

**外部匯入。** `POST /knowledge/partner-ingest` 接受 `pk_` 開頭的長效 API 金鑰，讓夥伴系統逐篇推送文件。重送舊版本會被略過；刪除指令只把文章改成 `ARCHIVED`。金鑰在「設定 → API 金鑰」建立。

**AI 設定的層級。** Chat 與 Embedding 的模型、位址與提示詞都是租戶層級的設定，存在 `TenantSettings`。AI agent 的開關則是整個部署共用的環境變數 `AGENTIC_LLM_ENABLED`，租戶不能各自開關。AI 用量怎麼計入額度，見[用量統計](../platform/USAGE.md)。

## 行銷

| 模組 | 負責什麼 |
| --- | --- |
| `marketing` 的 `campaign.service.ts` | 行銷活動：把多筆群發歸在同一個活動下，方便一起看成效 |
| `marketing` 的 `marketing.service.ts` | 群發：建立、立即發送、排程、取消，以及執行發送 |
| `marketing` 的 `segment.service.ts` | 受眾分群：以條件組合定義一群聯絡人，並預覽人數 |
| `marketing` 的 `material.service.ts` | 素材庫：訊息內容的範本，含分類、標籤、版本紀錄、預覽與成效統計。LINE Flex 可以匯入、驗證，也可以由 AI 產生 |
| `broadcast.scheduler.ts` | 定期找出到期的排程群發並執行 |
| `broadcast.tracking.ts` | 把客人的回覆與後續開的工單歸因到最近一筆群發 |

四者的關係：

```text
行銷活動（Campaign）
  └─ 群發（Broadcast）── 發送內容：素材（Material）
                      ── 發送對象：全部 / 分群（Segment）/ 標籤 / 指定聯絡人
                      ── 發送渠道：一個渠道
```

一筆群發只走一個渠道。發送時，素材內的外部連結會換成帶素材 ID 的短連結，點擊因此能歸因到素材。

解析出的發送對象是零人時，群發會回傳錯誤，不會顯示為「已完成」。

## 渠道工具（LINE）

側欄「渠道」底下都是 LINE 專用工具：

| 頁面 | 模組 | 負責什麼 |
| --- | --- | --- |
| LINE Rich Menu | `line` 的 `rich-menu.service.ts` | 圖文選單的編輯、複製、發布與下架。發布後綁定到使用者的工作送進 `rich-menu-bind` queue，由 workers 執行 |
| LINE 關鍵字回覆 | `automation` | 見[自動化](#自動化) |
| LINE 快速回覆 | `line` 的 `quick-reply-preset.service.ts` | 快速回覆按鈕的預設組合 |

渠道本身的新增、驗證與 webhook 設定在「設定 → 渠道管理」，由 `channel` 模組負責，見[設定](#設定)。

## 粉絲活動

`portal` 模組讓租戶在 LINE 裡辦活動。後台管理活動，粉絲透過 LIFF 參加。

| 部分 | 路由前綴 | 使用者 | 負責什麼 |
| --- | --- | --- | --- |
| 後台 | `/api/v1/portal` | 客服與管理員 | 活動的 CRUD、發布、結束、封存、查看提交紀錄、抽獎、積分查詢與人工調整 |
| 粉絲端 | `/api/v1/fan` | LINE 粉絲 | 以 LINE 身分登入、瀏覽與提交活動、查看結果與自己的積分 |

活動有三種類型：投票（`POLL`）、表單（`FORM`）、問答（`QUIZ`）。活動設定了 `pointsPerSubmit` 時，粉絲提交後自動加積分。每次提交都會發布 `portal.activity.submitted`，自動化規則可以訂閱這個事件。

## 短連結

| 部分 | 路由 | 負責什麼 |
| --- | --- | --- |
| 後台 | `/api/v1/shortlinks` | 短連結的 CRUD、點擊統計、點擊明細、QR code |
| 轉址 | `/s/:slug` | 點擊時依來源挑選轉址策略，記錄點擊 |

轉址策略在 `shortlink/strategies/`，依點擊者的環境挑選：

- **爬蟲**：回傳 OG 預覽頁，讓分享卡片顯示標題與圖片。
- **LINE 內建瀏覽器**：短連結綁定的 LINE 渠道設有 `liffId` 時，先導向 LIFF 取得點擊者的 LINE 身分。點擊貼標靠這一步辨識聯絡人。
- **外部瀏覽器**：嵌入 GA 與 Meta Pixel 追蹤碼後再轉址。追蹤碼在「設定 → 追蹤設定」填寫。

短連結設定了 `tagOnClick` 時，辨識出的聯絡人會被貼上該標籤。每次點擊都會發布 `link.clicked`，自動化規則可以訂閱這個事件。

## 報表

`analytics` 模組提供總覽、訊息趨勢、工單、客服績效、渠道、聯絡人、CSAT 與「我的績效」，並可以匯出 CSV。

每個報表端點都在查詢當下從原始資料表計算。`analytics.scheduler.ts` 每天把彙總寫入 `DailyStat`，但沒有任何端點讀這張表，見 `../../system/AUDIT.md` 的 DB-03。

整個模組要求 `analytics.view` 或 `analytics.view.self` 其一。「我的績效」（`GET /analytics/my`）只需要這個門檻，只有 `analytics.view.self` 的客服也能看自己的數字。其他報表另外要求 `analytics.view`，匯出要求 `analytics.export`。

## 方案／帳務

`/dashboard/plan` 顯示目前方案、用量與上限，並讓租戶提出升級或加購申請。

| 模組 | 負責什麼 |
| --- | --- |
| `platform` 的 `plan-change.routes.ts` | 租戶提出與查詢申請。路由在 `/api/v1/plan-change`，使用租戶的認證 |
| `platform/plan-limits.service.ts` | 解析有效上限。新增成員時由 `agent.service.ts` 呼叫，新增渠道時由 `channel.service.ts` 呼叫 |
| `trial/token-quota.service.ts` | AI 月額度的計數與告警 |

平台怎麼審核申請、上限怎麼算、加購是一次性還是每月，見平台後台的[方案與上限](../platform/PLANS.md)與[方案異動審核](../platform/PLAN-CHANGES.md)。

## 設定

設定頁的分頁定義在 `settings/page.tsx` 的 `SETTINGS_TABS`。每個分頁由不同模組負責：

| 分頁 | 模組 | 負責什麼 |
| --- | --- | --- |
| 一般設定 | `agent` | 顯示自己的個人資料，並修改自己的密碼（`PATCH /agents/me/password`）。這個分頁放在設定頁，內容卻是個人設定，不是租戶設定 |
| 渠道管理 | `channel` | 渠道的新增、編輯、停用、驗證憑證、設定 webhook、取得 WebChat 嵌入碼。新增時檢查方案的渠道數上限 |
| 人員管理 | `agent` | 成員的新增、改角色、重設密碼、停用與清除，以及成員可見的渠道。新增時檢查方案的成員數上限 |
| 角色與權限 | `role` | 自訂角色，並設定每個角色的權限碼 |
| 標籤管理 | `tag` | 見[聯絡人與標籤](#聯絡人與標籤) |
| SLA 政策 | `sla` | 見[服務水準協議](../SLA.md) |
| 營業時間 | `settings` 的 `office-hours.service.ts` | 營業時段與時段外的自動回覆訊息 |
| 追蹤設定 | `settings` | GA 與 Meta Pixel 的 ID，供短連結轉址使用 |
| API 金鑰 | `settings` 與 `auth` 的 `partner-api-key.service.ts` | 知識庫外部匯入用的長效金鑰 |
| CLI 連線 | `settings` 與 `auth` 的 `cli-session.service.ts` | 列出與建立 CLI token |
| Passkey 登入 | `auth` 的 `passkey.service.ts` | 註冊、改名與刪除自己的 Passkey |
| 整合 → A2A | `settings` 的 `a2a-status.service.ts` | 顯示 A2A 橋接的連線狀態 |

`settings` 模組的所有路由都需要 `settings.manage`。

**渠道可見範圍。** 成員不一定看得到租戶的所有渠道。`services/channel-visibility.ts` 依成員被指派的渠道決定可見範圍，並分成完整、僅回覆、唯讀三級。收件匣、工單與 socket 都依這個範圍過濾。工單的指派、結案、升級等操作要求完整權限；貼標與加註只要求僅回覆權限。

**角色的兩套欄位。** `Agent` 同時有 `role`（舊的 `ADMIN`／`SUPERVISOR`／`AGENT` 列舉）與 `roleId`（指向細粒度的 `Role`）。權限檢查看 `roleId`。指派自訂角色時，`role` 沿用成員原本的值，但工單自動指派與通知收件人仍看 `role`，見 RBAC-03。

**A2A 是整個部署共用的。** 橋接的開關與身分來自環境變數（`A2A_BRIDGE_ENABLED`、`A2A_AGENT_ID` 等），不是租戶設定。每個租戶的管理員看到的都是同一個橋接的狀態。橋接收到的外部任務以哪個租戶執行，見 `../../system/AUDIT.md` 的 A2A-01。

## 沒有頁面的功能

下列功能有 API，租戶後台沒有對應頁面。要使用只能透過 CLI、MCP，或直接呼叫 API。

| 功能 | 模組 | 負責什麼 |
| --- | --- | --- |
| 租戶稽核日誌 | `tenant-audit` | 查詢租戶內的操作紀錄 |
| 資料匯出 | `data-export` | 申請匯出租戶資料。由 workers 打包，過期的匯出檔由 workers 定期清除 |
| 資料刪除 | `data-erasure` | 申請刪除單一聯絡人的個人資料，由 workers 執行 |
| 對外 Webhook 訂閱 | `webhook-subscriptions` | 訂閱 eventBus 事件，事件發生時 POST 到指定 URL，可以送測試事件 |
| Canvas 流程 | `canvas` | 流程的 CRUD、啟用、手動觸發與執行紀錄，見[互動流程引擎](../CANVAS-FLOW-ENGINE.md) |
| 身分合併建議審核 | `canvas` 的 identity 部分 | 核准或駁回系統產生的合併建議 |
| 重抓 LINE 個人資料 | `line` 的 line-profile 部分 | `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` |
| 訊息模擬器 | `channels/simulator` | `POST /api/v1/simulator/send-message`，模擬一則進站訊息 |
| MCP | `mcp` | 讓 AI 工具以 MCP 協定操作租戶資料 |

訊息模擬器的前端面板 `SimulatorPanel.tsx` 只在 `development` 顯示，但 API 路由在所有環境都有註冊，見 `../../system/AUDIT.md` 的 APP-06。

## 側欄顯示與 API 權限

側欄與 API 各自判斷權限，兩邊的權限碼不一定相同：

- 側欄以 `NAV_TREE` 每一項的 `perm` 決定是否顯示。
- API 以路由上的 `requirePermission()` 決定是否放行。

兩邊不一致時會出現兩種情況：

| 情況 | 例子 |
| --- | --- |
| 側欄顯示，API 回 403 | 「設定」底下的「渠道管理」「人員管理」「SLA 政策」「營業時間」等分頁在側欄沒有 `perm`，所有成員都看得到；對應的 API 需要 `channel.view`、`agent.view`、`sla.manage` 或 `settings.manage` |
| 側欄隱藏，API 放行 | 「我的績效」掛在「報表」底下，側欄要求 `analytics.view`；`GET /analytics/my` 只要有 `analytics.view.self` 就放行，但只有這個權限碼的客服在側欄找不到入口。「短連結」在側欄要求 `shortlink.view`；`/api/v1/shortlinks` 只需要登入 |

收件匣、工單、聯絡人一帶的路由沒有權限碼，只驗登入，見 `../../system/AUDIT.md` 的 RBAC-01。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **部分自動化動作不會執行** | 前端可選、儲存與命中都正常，workers 執行時略過。詳見 `../../system/AUDIT.md` 的 AUTO-01 |
| **重抓 LINE 個人資料的端點不檢查租戶** | 以 `prismaAdmin` 查詢，`where` 沒有 `tenantId`。詳見 `../../system/AUDIT.md` 的 RLS-05 |
| **工單的狀態下拉選單繞過事件** | 不寫事件紀錄、不發布事件，選「已升級」也不通知主管。詳見 `../../system/AUDIT.md` 的 CASE-01 |
| **A2A 以最早建立的租戶執行外部任務** | 詳見 `../../system/AUDIT.md` 的 A2A-01 |
| 自動化的執行紀錄停止更新 | 詳見 `../../system/AUDIT.md` 的 AUTO-02 |
| 業務規則看舊的角色列舉 | 工單自動指派與通知收件人看 `role`，不看細粒度角色。詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| 收件匣一帶沒有權限碼 | 詳見 `../../system/AUDIT.md` 的 RBAC-01 與 PLAN-04 |
| 首次回應 SLA 必定逾時 | 詳見 `../../system/AUDIT.md` 的 SLA-01 |
| 對話的閒置時限無法調整 | 只能直接改資料庫。詳見 `../../system/AUDIT.md` 的 CONV-01 |
| 訊息模擬器在正式環境可用 | 詳見 `../../system/AUDIT.md` 的 APP-06 |
| 寫了沒有人讀的資料 | `DailyStat` 與 `ContactTag.expiresAt`。詳見 `../../system/AUDIT.md` 的 DB-03 與 DB-02 |
