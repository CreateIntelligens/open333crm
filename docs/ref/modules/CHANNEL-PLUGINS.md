# 渠道外掛

本文件說明各訊息渠道（LINE、Facebook、Instagram 私訊、網站聊天室）的差異怎麼收在外掛裡：外掛的介面、各渠道的實作、訊息進站與送出時怎麼經過外掛，以及哪些渠道專屬的功能沒有走外掛。渠道怎麼建立、怎麼設定 webhook，見[渠道管理](../features/tenant/CHANNELS.md)；一則訊息進站後經過哪些模組，見[租戶後台](../features/tenant/README.md#一則訊息進來之後)。

- **資料來源**：`packages/channel-plugins/src/*`、`apps/api/src/index.ts`、`apps/api/src/modules/webhook/*`、`apps/api/src/modules/conversation/conversation.service.ts`、`apps/api/src/modules/channel/*`、`apps/workers/src/index.ts`、`apps/workers/src/lib/channel-delivery.ts`、`apps/workers/src/lib/credentials.ts`、`apps/web/src/hooks/useKeywordReplies.ts`
- **核對日期**：2026-09-30

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 外掛要實作哪些方法？哪些是選用的？ | [外掛介面](#外掛介面) |
| 每種渠道有沒有外掛？在哪個行程註冊？ | [各渠道的實作](#各渠道的實作) |
| 進站的 webhook 怎麼經過外掛？ | [進站](#進站) |
| 客服回覆與自動化發送怎麼經過外掛？ | [送出](#送出) |
| 渠道的憑證存在哪裡、怎麼解密？ | [憑證](#憑證) |
| 哪些渠道專屬的功能沒有走外掛？ | [外掛之外的渠道專屬程式](#外掛之外的渠道專屬程式) |
| 新增一種渠道要做哪些事？ | [新增一種渠道](#新增一種渠道) |
| 目前有哪些已知問題？ | [目前的限制](#目前的限制) |

## 先讀這一段

每種渠道有一個外掛，實作 `packages/channel-plugins/src/index.ts` 的 `ChannelPlugin` 介面：驗證 webhook 簽章、解析進站內容、取得聯絡人資料、送出訊息。呼叫端以 `getChannelPlugin(channelType)` 取得外掛，不必知道是哪一種渠道。這是 `AGENTS.md` 模組規則 5 的用意：新增渠道只要註冊外掛，不必在各處加分支。

實際上外掛只涵蓋收發訊息的主幹。下列兩件事要先知道：

1. **註冊表是每個行程各自一份。** API 行程以 `registerChannelPlugin()` 註冊所有外掛；workers 行程不用這個註冊表，自己建一個 `Map`，只放 LINE 與 Facebook。所以 workers 送不出 Instagram 私訊與網站聊天室的訊息，見 `../system/AUDIT.md` 的 CHAN-02。
2. **很多渠道專屬的功能不在外掛裡。** 設定 webhook、驗證憑證、圖文選單、群發的 multicast、滿意度調查的版型等，都在各模組內以 `channelType` 分支，直接呼叫渠道平台的 API。見[外掛之外的渠道專屬程式](#外掛之外的渠道專屬程式)。

## 外掛介面

| 方法 | 必要 | 呼叫端 | 作用 |
| --- | --- | --- | --- |
| `verifySignature()` | 是 | `webhook.service.ts` 的 `processWebhookEvent()` | 以渠道的秘密驗證 webhook 原始內容的簽章 |
| `parseWebhook()` | 是 | 同上 | 把渠道的原始內容轉成 `ParsedWebhookMessage` 陣列。一個 webhook 可以帶多則訊息 |
| `getProfile()` | 是 | `inbound-contact-resolver.ts`（建立聯絡人時）、`line-profile.service.ts` | 取得聯絡人的名稱與頭像 |
| `sendMessage()` | 是 | `conversation.service.ts`、workers 的 `channel-delivery.ts`、`canvas.worker.ts`、`csat.service.ts`、行銷群發等 | 送出一則訊息，回傳渠道的訊息 ID |
| `setWebhook()` | 否 | 沒有呼叫端 | 在渠道平台設定 webhook 網址。LINE 的自動設定改由 `line-webhook-setup.service.ts` 直接呼叫 LINE API |
| `resolveInboundMedia()` | 否 | `inbound-side-effects.ts` 的 `resolveInboundMediaAsync()` | 訊息寫入後，非同步下載渠道上的媒體並存到自己的儲存空間 |
| `extensions.ui` | 否 | workers 的 `rich-menu-bind.handler.ts` | 圖文選單的綁定與解除 |
| `extensions.analytics` | 否 | `mcp.server.ts` | 查詢 LINE 的訊息額度 |
| `extensions.audience` | 否 | 沒有呼叫端 | 分眾名單 |

`ParsedWebhookMessage` 的 `contactUid` 是聯絡人在這個渠道的 ID，寫入 `ChannelIdentity.uid`。`OutboundPayload.delivery` 目前只有 LINE 使用，用來選擇 reply 或 push，見[送出](#送出)。

## 各渠道的實作

| `channelType` | 外掛 | API 註冊 | workers 註冊 | 進站路由 | 簽章 |
| --- | --- | --- | --- | --- | --- |
| `LINE` | `line/index.ts` 的 `linePlugin` | 有 | 有 | `/api/v1/webhooks/line/:channelId` | `x-line-signature`，以 `channelSecret` 計算 |
| `FB` | `facebook/index.ts` 的 `fbPlugin` | 有 | 有 | `/api/v1/webhooks/fb/:channelId` | `x-hub-signature-256`，以 `appSecret` 計算 |
| `THREADS` | `threads.ts` 的 `threadsPlugin` | 有 | **沒有** | `/api/v1/webhooks/threads/:channelId` | 同 FB |
| `WEBCHAT` | `webchat/index.ts` 的 `webchatPlugin` | 有 | **沒有** | 不走 webhook，由 `chatbox`、`webchat` 模組直接寫入 | 不驗證，一律回傳 `true` |
| `TELEGRAM` | `TelegramPlugin` 類別，有兩份 | 沒有 | 沒有 | 沒有 | — |
| `WHATSAPP` | 沒有 | 沒有 | 沒有 | 沒有 | — |

各渠道要注意的地方：

- **`THREADS` 其實是 Instagram 私訊。** 外掛呼叫的是 `graph.instagram.com`，憑證格式與 Facebook 相同。名稱沿用早期的規劃。
- **`WEBCHAT` 的外掛幾乎是空殼。** 訪客的訊息由 `chatbox`、`webchat` 模組直接建立，不經過 `parseWebhook()`；`sendMessage()` 只寫 log 並回傳成功，真正推給訪客的是 `conversation.service.ts` 對 `visitor:<channelId>:<uid>` 房間的 socket 推送。
- **`TELEGRAM` 有 `telegram.ts` 與 `telegram/index.ts` 兩份類別**，沒有匯出實例，也沒有註冊，見 APP-02。
- **`WHATSAPP` 可以建立渠道**，但沒有外掛也沒有路由，見 APP-02。

## 進站

LINE、Facebook、Instagram 私訊的 webhook 由 `webhook.routes.ts` 接收。路由立刻回 200，再以非同步呼叫 `processWebhookEvent()`：

1. 以 `channelId` 找出啟用中的渠道。租戶停用時直接丟棄。
2. 以**路由決定的** `channelType` 取得外掛，並解密渠道的憑證。
3. 選擇驗簽用的秘密：`FB`、`THREADS` 用 `appSecret`，其他用 `channelSecret`。這是一處以 `channelType` 分支的程式。
4. 呼叫外掛的 `verifySignature()`。失敗時拋出錯誤，只寫 log。
5. 渠道設定了下游轉發時，把原始內容轉發出去，見[渠道管理](../features/tenant/CHANNELS.md#webhook)。
6. 呼叫外掛的 `parseWebhook()`，對每一則訊息執行 `processInboundMessage()`。建立新聯絡人時呼叫 `getProfile()`；訊息寫入後，若外掛有 `resolveInboundMedia()`，就在背景下載媒體。

取得外掛時使用路由的 `channelType`，不與渠道本身的 `channelType` 比對。把 LINE 渠道的 ID 送到 Facebook 的路由，會以 Facebook 外掛、LINE 渠道的憑證處理；目前因為兩者的憑證欄位不同，驗簽會失敗，見 CHAN-03。

## 送出

| 送出路徑 | 行程 | 外掛來源 | 渠道專屬的分支 |
| --- | --- | --- | --- |
| 客服回覆（`conversation.service.ts` 的 `sendMessage()`、送媒體） | API | `getChannelPlugin()` | LINE 選擇 reply 或 push；WEBCHAT 另外推送到訪客的 socket 房間 |
| 自動化與關鍵字回覆的 `send_message`、`send_material` | workers | workers 自己的 `Map` | LINE 選擇 reply 或 push |
| Canvas 的 `MESSAGE` 節點 | API（`canvas.worker.ts`） | `getChannelPlugin()` | `email` 改走寄信 |
| 滿意度調查 | API（`csat.service.ts`） | `getChannelPlugin()` | LINE 送附評分按鈕的 Flex 訊息，其他渠道送文字 |
| 行銷群發 | API（`marketing.service.ts`） | `getChannelPlugin()` | LINE 在訊息不含個人化變數時改用 multicast，一次送給多人 |

**LINE 的 reply 與 push。** LINE 的 reply 不計入訊息額度，但 reply token 只在收到訊息後短時間內有效。`packages/shared/src/safe-reply.ts` 的 `selectSafeLineStrategy()` 決定用哪一種：帶著 reply token、而且收到訊息未滿 `LINE_REPLY_SAFE_WINDOW_MS` 時用 reply，否則用 push。API 與 workers 共用這個函式，但 reply 失敗後改用 push 的處理各寫一份。

**送出失敗時。** workers 的 `deliverToChannelFromWorker()` 找不到渠道身分、外掛或無法解密憑證時，以 `recordDeliveryFailure()` 寫入一則標示失敗的訊息。API 端的客服回覆失敗時，介面沒有標示，見 CONV-03。

## 憑證

渠道的憑證以 AES-GCM 加密後存在 `Channel.credentialsEncrypted`，金鑰由 `CREDENTIAL_ENCRYPTION_KEY` 衍生。建立渠道時，`channel.routes.ts` 依 `channelType` 檢查欄位：

| `channelType` | 必要欄位 |
| --- | --- |
| `LINE` | `channelSecret`、`channelAccessToken` |
| `FB`、`THREADS` | `appSecret`、`pageAccessToken` |
| 其他 | 不檢查 |

解密函式有兩份：API 的 `channel.service.ts` 與 workers 的 `lib/credentials.ts`。兩者的演算法相同，但 workers 在缺少金鑰時退回原始碼裡的固定字串，見 `../system/AUDIT.md` 的 SEC-01。

## 外掛之外的渠道專屬程式

下列功能只支援特定渠道，程式直接寫在各模組，不經過外掛：

| 功能 | 位置 | 支援的渠道 |
| --- | --- | --- |
| 驗證憑證 | `channel.service.ts` 的渠道驗證 | LINE、FB、THREADS 各一段，直接呼叫渠道 API |
| 自動設定 webhook | `line-webhook-setup.service.ts` | LINE。外掛的 `setWebhook()` 沒有被使用 |
| 檢查 access token 是否過期 | `fb-token-monitor.service.ts` | FB |
| 圖文選單的建立與發布 | `line/rich-menu.service.ts`，直接呼叫 LINE API | LINE。綁定使用者則走外掛的 `extensions.ui` |
| 重抓個人資料 | `line/line-profile.service.ts` | LINE |
| 索取 email | `line-login`、`fb-login` 模組 | LINE、FB |
| MCP 的 LINE 工具 | `mcp.server.ts` | LINE |
| 素材的格式檢查 | `marketing/material.service.ts`，呼叫 LINE 的訊息驗證 API | LINE。素材以自己的小寫 `channelType`（`line`、`fb`）區分，與 `Channel.channelType` 不同 |

另有一些模組以 `channelType` 分支，對不同渠道做不同的事。這違反 `AGENTS.md` 的結構規則 5，但改成走外掛的成本高，因此只記錄位置，不要照抄。下表是 2026-10-01 以 `AGENTS.md` 規則 5 的檢查指令核對的結果：

| 位置 | 分支做什麼 |
| --- | --- |
| `conversation/conversation.service.ts` | LINE 先用 reply token 回覆，失敗才 push；WebChat 推送給訪客的 socket |
| `channel/channel.service.ts`、`channel.routes.ts` | 依渠道選擇憑證欄位與驗證方式；顯示 Facebook 權杖狀態 |
| `csat/csat.service.ts` | LINE 送 Flex 調查，其他渠道送快速回覆 |
| `webhook/webhook.service.ts` | 選擇驗簽用的秘密：`FB`、`THREADS` 用 `appSecret`，其他用 `channelSecret` |
| `marketing/marketing.service.ts` | LINE 且素材沒有變數時用 multicast |
| `identity-binding/binding-links.ts` | 依渠道產生導流連結（LINE 的加好友與預填文字、FB 的 `m.me`、IG 的 `ig.me`）與顧客看到的帳號稱呼 |
| `apps/workers/src/lib/channel-delivery.ts` | LINE 先用 reply token 回覆，失敗才 push |

檢查指令也會找到另外兩種程式，它們不算違規：

- 只擋不支援渠道的檢查。這些功能本來就只為一種渠道而做：`mcp`、`line` 的圖文選單、`line-login`、`fb-login`、`chatbox`。
- 比對設定值的條件，例如 `canvas.webhook.ts` 比對流程觸發條件裡的 `channelType`。

## 新增一種渠道

1. 在 `schema.prisma` 的 `ChannelType` 與 `packages/shared`、`packages/types` 的渠道型別加入新類型。兩個套件各有一份，見 PKG-01。
2. 在 `packages/channel-plugins/src/` 實作 `ChannelPlugin`，匯出一個實例，並在 `package.json` 的 `exports` 加上子路徑（確認路徑與實際輸出一致，見 PKG-02）。
3. 在 `apps/api/src/index.ts` 以 `registerChannelPlugin()` 註冊，並更新同檔的啟動 log（見 APP-03）。
4. 在 `apps/workers/src/index.ts` 的 `pluginRegistry` 加入同一個外掛，否則自動化與關鍵字回覆送不出去。
5. 在 `webhook.routes.ts` 加上進站路由；驗簽用的秘密不是 `appSecret` 或 `channelSecret` 時，修改 `processWebhookEvent()` 的選擇。
6. 在 `channel.routes.ts` 的 `createChannelSchema` 加入新類型，並定義憑證欄位的檢查。
7. 需要的話，在 `channel.service.ts` 加上驗證憑證的分支，並在前端的渠道管理頁加上表單。
8. 檢查[外掛之外的渠道專屬程式](#外掛之外的渠道專屬程式)列出的功能，決定新渠道是否支援。

## 目前的限制

| 限制 | 詳見 `../system/AUDIT.md` |
| --- | --- |
| workers 只註冊 LINE 與 FB 外掛；關鍵字回覆不限渠道，在 Instagram 私訊與網站聊天室命中時送不出去，機器人也不回覆 | CHAN-02 |
| 進站路由不比對渠道本身的類型；FB 與 Instagram 以一般字串比對簽章 | CHAN-03 |
| Telegram 沒有註冊；WhatsApp 可以建立但沒有外掛 | APP-02 |
| 啟動 log 少列 Threads | APP-03 |
| `./fb` 子路徑指向不存在的檔案 | PKG-02 |
| 渠道型別在兩個套件各有一份 | PKG-01 |
| workers 的解密函式有金鑰備援值 | SEC-01 |
| 外掛套件裡有沒有呼叫端的程式 | PKG-06 |
| 刪除渠道會因外鍵而失敗 | CHAN-01 |

## 自己驗證的方法

```bash
# 兩個行程各註冊了哪些外掛
grep -n "registerChannelPlugin" apps/api/src/index.ts
grep -n "pluginRegistry.set" apps/workers/src/index.ts

# 以 channelType 分支的程式
grep -rn "channelType *[!=]==\|[!=]== *CHANNEL_TYPE" apps/api/src apps/workers/src --include='*.ts'

# 外掛的選用方法有誰呼叫
grep -rn "setWebhook\|resolveInboundMedia\|extensions?\.\(ui\|audience\|analytics\)" apps --include='*.ts'
```
