# 租戶後台（dashboard）

租戶後台是租戶的客服與管理員每天使用的介面。客服在這裡回覆客人、處理工單。管理員在這裡設定渠道、自動回覆、人員與權限，也在這裡發送行銷訊息。

本目錄依功能區拆成多份文件，每份說明該區由哪些模組負責、每個模組做什麼、有哪些規則與已知問題。本檔只放跨功能區的內容：模組怎麼分組、側欄對照、一則訊息怎麼流過各模組，以及事件怎麼在模組之間傳遞。

- **資料來源**：`apps/api/src/index.ts`、`apps/api/src/modules/*`、`apps/api/src/plugins/socket.plugin.ts`、`apps/workers/src/*`、`apps/web/src/app/dashboard/*`、`apps/web/src/components/layout/Sidebar.tsx`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-09-30

## 先讀這一段

租戶後台的模組分成五組，對應客服中心的五件事：

1. **接住訊息**：客人從 LINE、Facebook 等渠道傳訊息進來。系統找出或建立聯絡人與對話，再推到收件匣。
2. **先讓系統處理**：客服接手之前，機器人依關鍵字、知識庫或 AI 自動回覆。自動化規則依事件貼標、指派、發通知。
3. **追蹤處理結果**：需要追蹤的問題開成工單，由 SLA 計時。工單解決後系統發出滿意度調查，數字進入報表。
4. **主動觸及客人**：群發訊息、舉辦粉絲活動、發送短連結，並追蹤誰點了、誰回了。
5. **管理租戶**：渠道、人員、角色、營業時間、AI 設定與方案。

多數模組只屬於其中一組。自動化是例外：它訂閱第 1 組產生的事件，替第 2 組與第 3 組做事。

模組掛在哪個路由前綴、需要哪個權限碼，見[模組總覽](../../modules/OVERVIEW.md)。

## 本目錄的文件

| 文件 | 功能區 | 適合解答的問題 |
| --- | --- | --- |
| [收件匣與對話](./INBOX.md) | 收件匣 | 機器人什麼時候回覆？怎麼轉真人？客服回覆怎麼送出？誰看得到哪些對話？ |
| [工單](./CASES.md) | 工單 | 工單從哪裡來？狀態怎麼轉？怎麼自動指派？解決之後發生什麼？ |
| [聯絡人與標籤](./CONTACTS.md) | 聯絡人、標籤 | 同一個人從兩個渠道進來會怎樣？兩種合併有什麼差別？標籤的 scope 是什麼？ |
| [通知](./NOTIFICATIONS.md) | 通知 | 哪些事件通知誰？為什麼指派對話沒有通知？ |
| [自動化](./AUTOMATION.md) | 自動化、關鍵字回覆 | 規則在哪個行程執行？哪些事件與動作真的會生效？關鍵字怎麼比對？ |
| [知識庫與 AI](./KNOWLEDGE.md) | 知識庫、AI 設定 | 機器人怎麼用知識庫回答？向量什麼時候產生？AI 額度怎麼計？ |
| [行銷](./MARKETING.md) | 行銷 | 素材、分群、群發、活動是什麼關係？群發怎麼送出？回覆怎麼歸因？ |
| [LINE 工具](./LINE.md) | 渠道（LINE） | 圖文選單怎麼發布與分眾綁定？快速回覆存在哪裡？ |
| [粉絲活動](./PORTAL.md) | 粉絲活動 | 粉絲怎麼參加活動？積分怎麼累積？抽獎怎麼抽？ |
| [短連結](./SHORTLINKS.md) | 短連結 | 點擊怎麼記錄？怎麼辨識 LINE 使用者並貼標？ |
| [報表](./ANALYTICS.md) | 報表 | 每個報表算什麼？數字從哪來？為什麼首次回應時間是空的？ |
| [渠道管理](./CHANNELS.md) | 設定 → 渠道管理 | 支援哪些渠道？webhook 怎麼設定？刪除渠道會怎樣？ |
| [人員與角色](./MEMBERS.md) | 設定 → 人員、角色 | 有效權限怎麼算？兩套角色欄位有什麼差別？停用成員多久生效？ |
| [其他設定](./SETTINGS.md) | 設定的其他分頁 | 營業時間怎麼判斷？API 金鑰與 CLI token 怎麼管理？A2A 是什麼？ |
| [稽核、資料權利與對外整合](./GOVERNANCE.md) | 沒有頁面的功能 | 哪些操作有稽核？資料匯出與刪除涵蓋什麼？對外 Webhook 怎麼簽章？ |

SLA 另有專文：[服務水準協議](../SLA.md)。Canvas 屬於單一模組的內部機制，放在模組文件：[互動流程引擎](../../modules/CANVAS-FLOW-ENGINE.md)。方案與帳務由平台後台決定，見[方案與上限](../platform/PLANS.md)與[方案異動審核](../platform/PLAN-CHANGES.md)。

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
| 設定 | `/dashboard/settings/*` | 依分頁而不同 | 見[其他設定](./SETTINGS.md#分頁與模組) |

側欄的定義在 `Sidebar.tsx` 的 `NAV_TREE`。側欄的「渠道」只放 LINE 專用的工具；新增與管理渠道本身在「設定 → 渠道管理」。

## 一則訊息進來之後

這條路徑是租戶後台大部分功能的起點，因此先講。

渠道平台呼叫 `/api/v1/webhooks/<渠道>/:channelId`。`webhook` 模組驗證簽章之後，`webhook.service.ts` 的 `processInboundMessage()` 依序執行下表的步驟。

收到 webhook 時還不知道是哪個租戶，因此整條管線使用 `prismaAdmin`（BYPASSRLS），租戶隔離完全靠每個查詢自己帶的條件。管線裡的 CSAT 攔截器沒有帶，見 `../../system/AUDIT.md` 的 RLS-06。

| 步驟 | 函式 | 做什麼 | 涉及的模組 |
| --- | --- | --- | --- |
| 1 | `resolveInboundContact()` | 依渠道身分（`ChannelIdentity`）找出聯絡人；找不到再查 `IdentityMap`；都沒有就建立 | `contact` |
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
| `automation.worker.ts` 的 `setupAutomationWorker()` | 機器人回覆、情緒分析與規則評估，細節見[收件匣與對話](./INBOX.md#機器人什麼時候回覆)與[自動化](./AUTOMATION.md) |
| `notification.worker.ts` 的 `setupNotificationWorker()` | 發出「收到新訊息」通知。對話已指派時只通知負責人；未指派時通知所有 `ADMIN` 與 `SUPERVISOR` |
| `webhook-dispatcher.ts` 的 `setupWebhookDispatcher()` | 轉發給租戶訂閱了這個事件的外部 URL |


## 事件怎麼在模組之間傳遞

模組之間不直接呼叫的地方，靠下列機制傳遞：

| 機制 | 範圍 | 用途 | 例子 |
| --- | --- | --- | --- |
| eventBus | API 行程內 | 業務事件。`events/event-bus.ts` 的 `EventEmitter`，不經過 Redis | `message.received`、`case.created`、`contact.tagged` |
| BullMQ queue | API 行程 → workers | 需要查資料或會拖慢回應的工作 | `automation`、`notification`、`rich-menu-bind`、`data-export`、`data-erasure` |
| Redis `socket:emit` | workers → API 行程 → 前端 | workers 沒有 socket 連線，由 API 行程代為推送 | 自動化執行結果、通知 |
| Redis `domain:event` | workers → API 行程的 eventBus | workers 產生、API 端要接著處理的業務事件 | workers 貼標後的 `contact.tagged` |

要知道的事：

- **eventBus 只存在於單一 API 行程。** 同時跑多個 API 行程時，每個行程各自有一份。`domain:event` 由每個 API 行程各自訂閱，同一個事件會在每個行程各轉發一次。
- **事件沒有持久化。** API 行程在事件處理完之前重新啟動，事件就遺失；對外 Webhook 的重試也是。
- **沒有發布端的事件。** 有些事件有訂閱者或出現在介面上，卻沒有任何程式發布，例如 `conversation.assigned`、`sla.warning`。各文件在相關段落標出，彙整見 `../../system/AUDIT.md` 的 CONV-02、APP-05 與 AUTO-05。
- **socket 的租戶房間收得到全部。** 每條 socket 連線建立時自動加入 `tenant:<租戶 ID>` 房間，而新訊息事件會帶著內容發到這個房間。渠道可見範圍因此在即時事件上不生效，見 `../../system/AUDIT.md` 的 RBAC-04。

背景工作跑在哪個行程，見[模組總覽](../../modules/OVERVIEW.md#背景工作的歸屬)。

## 側欄顯示與 API 權限

側欄與 API 各自判斷權限，兩邊的權限碼不一定相同：

- 側欄以 `NAV_TREE` 每一項的 `perm` 決定是否顯示。
- API 以路由上的 `requirePermission()` 決定是否放行。

兩邊不一致時會出現兩種情況：

| 情況 | 例子 |
| --- | --- |
| 側欄顯示，API 回 403 | 「設定」底下的「渠道管理」「人員管理」「SLA 政策」「營業時間」等分頁在側欄沒有 `perm`，所有成員都看得到；對應的 API 需要 `channel.view`、`agent.view`、`sla.manage` 或 `settings.manage` |
| 側欄隱藏，API 放行 | 「我的績效」掛在「報表」底下，側欄要求 `analytics.view`；`GET /analytics/my` 只要有 `analytics.view.self` 就放行，但只有這個權限碼的客服在側欄找不到入口。「短連結」在側欄要求 `shortlink.view`；`/api/v1/shortlinks` 只需要登入 |

收件匣、工單、聯絡人一帶的路由沒有權限碼，只驗登入，見 `../../system/AUDIT.md` 的 RBAC-01。各功能區的權限細節見各文件的「權限」一節。

## 最需要注意的問題

各文件的「目前的限制」列出該功能區的所有已知問題。下表只挑出跨功能區、或影響最大的幾項：

| 問題 | 影響 | 文件 | AUDIT |
| --- | --- | --- | --- |
| 粉絲 token 與 refresh token 都能通過客服認證 | 知道一組聯絡人 ID 與租戶 ID，就能讀取收件匣並收到即時訊息 | [人員與角色](./MEMBERS.md#登入)、[粉絲活動](./PORTAL.md) | AUTH-05 |
| 密碼登入沒有速率限制 | 可以無限次嘗試密碼 | [人員與角色](./MEMBERS.md#登入) | SEC-05 |
| CSAT 攔截器與重抓 LINE 個人資料的端點不檢查租戶 | 可以改寫或讀取其他租戶的資料 | [工單](./CASES.md#解決之後)、[聯絡人與標籤](./CONTACTS.md) | RLS-06、RLS-05 |
| 部分自動化動作與觸發事件不會生效 | 規則可以儲存、看起來正常，實際什麼都不做 | [自動化](./AUTOMATION.md) | AUTO-01、AUTO-05 |
| 渠道可見範圍有多處沒有套用 | 分店客服看得到其他分店的訊息 | [收件匣與對話](./INBOX.md#誰看得到哪些對話) | RBAC-04 |
| 收件匣一帶的路由沒有權限碼 | 角色與方案限制不到這些功能 | 各文件的「權限」一節 | RBAC-01、PLAN-04 |
| 客服回覆送不出去時沒有標示 | 客服以為客人收到了 | [收件匣與對話](./INBOX.md#客服回覆怎麼送出) | CONV-03 |
| 群發可以重複執行 | 客人重複收到同一則群發 | [行銷](./MARKETING.md#群發) | MKT-01 |

模組屬於哪個後台、掛哪個路由前綴，見[模組總覽](../../modules/OVERVIEW.md)。平台後台見[平台後台](../platform/README.md)。
