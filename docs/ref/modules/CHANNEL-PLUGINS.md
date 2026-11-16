# 渠道外掛

本文件說明各訊息渠道（LINE、Facebook（內部代號 `FB`）、Instagram 私訊（內部代號 `THREADS`）、網站聊天室（內部代號 `WEBCHAT`））的差異怎麼收在外掛裡：外掛的介面、各渠道的實作、訊息進站與送出時怎麼經過外掛，以及哪些渠道專屬的功能沒有走外掛。渠道怎麼建立、怎麼設定 webhook，見[渠道管理](../features/tenant/CHANNELS.md)；一則訊息進站後經過哪些模組，見[租戶後台](../features/tenant/README.md#一則訊息進來之後)。

- **資料來源**：`packages/channel-plugins/src/*`、`apps/api/src/index.ts`、`apps/api/src/modules/webhook/*`、`apps/api/src/modules/conversation/conversation.service.ts`、`apps/api/src/modules/channel/*`、`apps/workers/src/index.ts`、`apps/workers/src/lib/channel-delivery.ts`、`apps/workers/src/lib/credentials.ts`、`apps/web/src/hooks/useKeywordReplies.ts`、`apps/api/src/modules/comment-reply/*`、`apps/api/src/modules/webhook/inbound-comment-origin.ts`
- **核對日期**：2026-09-30；留言擴充一節 2026-11-14

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 外掛要實作哪些方法？哪些是選用的？ | [外掛介面](#外掛介面) |
| 每種渠道有沒有外掛？在哪個行程註冊？ | [各渠道的實作](#各渠道的實作) |
| 進站的 webhook 怎麼經過外掛？ | [進站](#進站) |
| 客服回覆與自動化發送怎麼經過外掛？ | [送出](#送出) |
| 渠道的憑證存在哪裡、怎麼解密？ | [憑證](#憑證) |
| FB／IG 的貼文留言怎麼經過外掛？留言建立的聯絡人與入站建立的聯絡人怎麼保持一致？ | [留言擴充](#留言擴充) |
| 哪些渠道專屬的功能沒有走外掛？ | [外掛之外的渠道專屬程式](#外掛之外的渠道專屬程式) |
| 新增一種渠道要做哪些事？ | [新增一種渠道](#新增一種渠道) |
| 目前有哪些已知問題？ | [目前的限制](#目前的限制) |

## 先讀這一段

每種渠道有一個外掛，實作 `packages/channel-plugins/src/index.ts` 的 `ChannelPlugin` 介面：驗證 webhook 簽章、解析進站內容、取得聯絡人資料、送出訊息。呼叫端以 `getChannelPlugin(channelType)` 取得外掛，不必知道是哪一種渠道。這是 `AGENTS.md` 模組規則 5 的用意：新增渠道只要註冊外掛，不必在各處加分支。

實際上外掛只涵蓋收發訊息的主幹。下列兩件事要先知道：

1. **註冊表是每個行程各自一份。** API 行程以 `registerChannelPlugin()` 註冊所有外掛；workers 行程不用這個註冊表，自己建一個 `Map`，只放 LINE 與 Facebook。所以 workers 送不出 Instagram 私訊與網站聊天室的訊息，見 `../system/AUDIT.md` 的 CHAN-02。
2. **很多渠道專屬的功能不在外掛裡。** 設定 webhook、驗證憑證、圖文選單、群發的 multicast 等，都在各模組內以 `channelType` 分支，直接呼叫渠道平台的 API。見[外掛之外的渠道專屬程式](#外掛之外的渠道專屬程式)。

## 外掛介面

| 方法 | 必要 | 呼叫端 | 作用 |
| --- | --- | --- | --- |
| `verifySignature()` | 是 | `webhook.service.ts` 的 `processWebhookEvent()` | 以渠道的秘密驗證 webhook 原始內容的簽章 |
| `parseWebhook()` | 是 | 同上 | 把渠道的原始內容轉成 `ParsedWebhookMessage` 陣列。一個 webhook 可以帶多則訊息 |
| `getProfile()` | 是 | `inbound-contact-resolver.ts`（建立聯絡人時）、`line-profile.service.ts` | 取得聯絡人的名稱與頭像 |
| `sendMessage()` | 是 | `conversation.service.ts`、workers 的 `channel-delivery.ts`、`canvas.worker.ts`、`csat.service.ts`、行銷群發等 | 送出一則訊息，回傳渠道的訊息 ID |
| `setWebhook()` | 否 | 沒有呼叫端 | 在渠道平台設定 webhook 網址。LINE 的自動設定改由 `line-webhook-setup.service.ts` 直接呼叫 LINE API |
| `resolveInboundMedia()` | 否 | `inbound-side-effects.ts` 的 `resolveInboundMediaAsync()` | 訊息寫入後，非同步下載渠道上的媒體並存到自己的儲存空間，儲存後的網址寫入 `content.url` 與 `content.mediaUrl`。LINE 下載圖片、影片、語音與檔案：待下載以 `contentId` 表示；上限 25 MB；只保留圖片（不含 SVG）、影片、語音的 MIME，其他存成 `application/octet-stream`；檔案保留副檔名；`contentProvider` 為 `external` 時直接用對方的網址、不下載。失敗時外掛拋出中文原因，寫進 `content.mediaError` 並推送給收件匣 |
| `buildCsatSurvey()` | 否 | `csat.service.ts` 的 `sendCsatSurvey()`、`csatSurveyChannelTypes()` | 組滿意度問卷的訊息。只有客人能在渠道上直接點選分數的外掛實作，目前只有 LINE（Flex 訊息、五個 postback 按鈕）。沒有實作的渠道不寄問卷（#339）。LINE 外掛把它設成實例屬性，workers 的 registry 用同一個物件，能力相同 |
| `extensions.ui` | 否 | workers 的 `rich-menu-bind.handler.ts` | 圖文選單的綁定與解除 |
| `extensions.analytics` | 否 | `mcp.server.ts` | 查詢 LINE 的訊息額度 |
| `extensions.audience` | 否 | 沒有呼叫端 | 分眾名單 |
| `extensions.comments` | 否 | `webhook.service.ts`（留言收件）、`comment-reply` 模組（送出、規則、渠道端）、`meta-connect.service.ts`（訂閱）、`meta-token-health.ts`（訂閱檢查） | FB／IG 貼文留言：解析留言事件、私訊與公開回覆留言、最近貼文、訂閱欄位。見[留言擴充](#留言擴充) |

`ParsedWebhookMessage` 的 `contactUid` 是聯絡人在這個渠道的 ID，寫入 `ChannelIdentity.uid`。`OutboundPayload.delivery` 目前只有 LINE 使用，用來選擇 reply 或 push，見[送出](#送出)。

## 各渠道的實作

| `channelType` | 外掛 | API 註冊 | workers 註冊 | 進站路由 | 簽章 |
| --- | --- | --- | --- | --- | --- |
| `LINE` | `line/index.ts` 的 `linePlugin` | 有 | 有 | `/api/v1/webhooks/line/:channelId` | `x-line-signature`，以 `channelSecret` 計算 |
| `FB` | `facebook/index.ts` 的 `fbPlugin` | 有 | 有 | `/api/v1/webhooks/fb/:channelId` | `x-hub-signature-256`，以 `appSecret` 計算 |
| `THREADS` | `threads.ts` 的 `threadsPlugin` | 有 | **沒有** | `/api/v1/webhooks/threads/:channelId` | 同 FB |
| `WEBCHAT` | `webchat/index.ts` 的 `webchatPlugin` | 有 | **沒有** | 不走 webhook，由 `chatbox`、`webchat` 模組直接寫入 | 不驗證，一律回傳 `true` |
| `TELEGRAM` | `TelegramPlugin` 類別 | 沒有 | 沒有 | 沒有 | — |
| `WHATSAPP` | 沒有 | 沒有 | 沒有 | 沒有 | — |

各渠道要注意的地方：

- **`THREADS` 其實是 Instagram 私訊。** 外掛呼叫的是 `graph.instagram.com`，憑證格式與 Facebook 相同。名稱沿用早期的規劃。代號維持不改，但畫面、匯出檔與給使用者看的錯誤訊息不顯示代號：一律經 `@open333crm/shared` 的 `channelDisplayName()` 顯示 Instagram（`FB` 顯示 Facebook、`WEBCHAT` 顯示網站聊天室）。
- **`WEBCHAT` 的外掛幾乎是空殼。** 訪客的訊息由 `chatbox`、`webchat` 模組直接建立，不經過 `parseWebhook()`；`sendMessage()` 只寫 log 並回傳成功，真正推給訪客的是 `conversation.service.ts` 對 `visitor:<channelId>:<uid>` 房間的 socket 推送。群發與發券沒有這一步，所以群發、附券廣播與批次發券只接受 `@open333crm/shared` 的 `PROACTIVE_PUSH_CHANNEL_TYPES`（LINE、FB、THREADS），網站聊天室回 400 `CHANNEL_PUSH_NOT_SUPPORTED`（issue #415）。`sendMessage()` 沒有改成回失敗：收件匣回覆與 `deliverToChannel()` 呼叫它之後才推訪客房間，回失敗會讓這兩條路徑把已送達的訊息標為失敗或不推送。
- **`TELEGRAM` 只有 `telegram.ts` 的類別**，沒有匯出實例，也沒有註冊，見 APP-02。
- **`WHATSAPP` 可以建立渠道**，但沒有外掛也沒有路由，見 APP-02。

## 進站

LINE、Facebook、Instagram 私訊的 webhook 由 `webhook.routes.ts` 接收。步驟 1 到 4 由 `verifyWebhookRequest()` 執行，之後的事件處理在 `processWebhookEvent()`：

1. 以 `channelId` 找出啟用中的渠道。租戶停用時直接丟棄。
2. 路由的 `channelType` 必須與渠道本身的 `channelType` 相同，不同時丟棄，不以其他類型的外掛處理。接著取得外掛，並解密渠道的憑證。
3. 選擇驗簽用的秘密：`FB`、`THREADS` 用 `appSecret`，其他用 `channelSecret`。這是一處以 `channelType` 分支的程式。
4. 呼叫外掛的 `verifySignature()`。LINE、Facebook、Instagram 外掛都以 `packages/channel-plugins/src/signature.ts` 的 `signaturesMatch()` 做固定時間比較，簽章長度不同時回傳 `false`。

**回應碼。** LINE 路由在回應前執行步驟 1 到 4：簽章缺少或錯誤、或渠道類型不符時回 403；渠道不存在或租戶停用時回 200 並丟棄；憑證無法解密時回 500；外掛驗簽本身拋出錯誤時視為驗簽失敗。驗證通過才回 200，事件在背景處理。Facebook 與 Instagram 路由立刻回 200，再在背景驗證與處理；它們的主規格沒有規定回應碼。
5. 渠道設定了下游轉發時，把原始內容轉發出去，見[渠道管理](../features/tenant/CHANNELS.md#webhook)。
6. 呼叫外掛的 `parseWebhook()`，對每一則訊息執行 `processInboundMessage()`。建立新聯絡人時呼叫 `getProfile()`；訊息寫入後，若外掛有 `resolveInboundMedia()`，就在背景下載媒體。

`processInboundMessage()` 是所有渠道（含網站聊天室）共用的入口。它先查租戶是否啟用，停用（含試用到期）時丟棄事件、不建立任何資料（issue #410）。webhook 在步驟 1 已經提早丟棄，這裡另外擋住網站聊天室與其他直接呼叫的路徑。網站聊天室在更前面的入口就擋下：建立工作階段與驗證工作階段（送訊息、bootstrap、訪客 socket）在租戶停用時比照渠道停用回 404。

## 送出

| 送出路徑 | 行程 | 外掛來源 | 渠道專屬的分支 |
| --- | --- | --- | --- |
| 客服回覆（`conversation.service.ts` 的 `sendMessage()`、送媒體） | API | `getChannelPlugin()` | LINE 選擇 reply 或 push；WEBCHAT 另外推送到訪客的 socket 房間 |
| 自動化與關鍵字回覆的 `send_message`、`send_material` | workers | workers 自己的 `Map` | LINE 選擇 reply 或 push |
| Canvas 的 `MESSAGE` 節點 | API（`canvas.worker.ts`） | `getChannelPlugin()` | `email` 改走寄信 |
| 滿意度調查 | API（`csat.service.ts`） | `getChannelPlugin()` | 沒有分支：外掛的 `buildCsatSurvey()` 決定版型，沒有實作的渠道不寄（#339） |
| 行銷群發、附券廣播、批次發券 | API（`marketing.service.ts`、`broadcast-coupon.flow.ts`） | `getChannelPlugin()` | LINE 在訊息不含個人化變數時改用 multicast，一次送給多人；只接受能主動推送的渠道，網站聊天室回 400 |

**LINE 的 reply 與 push。** LINE 的 reply 不計入訊息額度，但 reply token 只在收到訊息後短時間內有效。`packages/shared/src/safe-reply.ts` 的 `selectSafeLineStrategy()` 決定用哪一種：帶著 reply token、而且收到訊息未滿 `LINE_REPLY_SAFE_WINDOW_MS` 時用 reply，否則用 push。API 與 workers 共用這個函式，但 reply 失敗後改用 push 的處理各寫一份。

**送出失敗時。** workers 的 `deliverToChannelFromWorker()` 找不到渠道身分、外掛或無法解密憑證時，以 `recordDeliveryFailure()` 寫入一則標示失敗的訊息。API 端的客服回覆送出失敗時，`sendMessage()` 在訊息的 `metadata` 寫入 `deliveryFailed` 與 `deliveryError`。這組欄位與 workers 相同，收件匣依此標示沒有送出的訊息。

## 憑證

渠道的憑證以 AES-GCM 加密後存在 `Channel.credentialsEncrypted`，金鑰由 `CREDENTIAL_ENCRYPTION_KEY` 衍生。建立渠道時，`channel.routes.ts` 依 `channelType` 檢查欄位：

| `channelType` | 必要欄位 |
| --- | --- |
| `LINE` | `channelSecret`、`channelAccessToken` |
| `FB`、`THREADS` | `appSecret`、`pageAccessToken` |
| 其他 | 不檢查 |

解密函式有兩份：API 的 `channel.service.ts` 與 workers 的 `lib/credentials.ts`。兩者的演算法相同，`CREDENTIAL_ENCRYPTION_KEY` 缺少或短於 32 個字元時都拋出錯誤（主規格 `credential-encryption`）。

## 留言擴充

留言關鍵字自動私訊（change `add-comment-keyword-private-reply`）的渠道差異都在 `extensions.comments`（`ChannelCommentExtension`，`packages/channel-plugins/src/index.ts`）。`comment-reply` 模組不比對 `channelType`，只問「這個外掛有沒有留言擴充」與 `capabilities`（`platform: 'fb' | 'ig'`、可用的私訊內容類型、是否支援公開回覆）。目前 `fbPlugin` 與 `threadsPlugin` 實作；LINE、WebChat 沒有，所以規則 API 選 LINE 渠道回 400 `CHANNEL_NOT_SUPPORTED`。

| 方法 | 呼叫端 | 作用 |
| --- | --- | --- |
| `parseCommentEvents()` | `webhook.service.ts` | 從同一份 webhook 原始內容解析留言事件。外掛已排除自己帳號的留言、非留言的 feed 變更、直播留言；FB `verb=remove` 回 `kind: 'remove'`。壞掉的內容回空陣列，不丟錯 |
| `parsePostReference()` | 規則 API（指定貼文） | 手動輸入的貼文 ID 或網址離線正規化（FB 為 `{pageId}_{postId}`），不發網路請求 |
| `sendPrivateReply()`、`replyToComment()` | 送出 flow（`comment-reply-delivery.flow.ts`） | 私訊留言者（FB 以 `recipient: { comment_id }`）與公開回覆。Meta 錯誤正規化成 `reason`（`TOKEN_EXPIRED`、`USER_UNAVAILABLE`、`ALREADY_REPLIED` 等），以回傳值表示，不丟錯 |
| `listRecentPosts()`、`resolvePostUrl()` | 渠道端路由（貼文挑選） | 只呼叫 Graph API；`resolvePostUrl()` 不 fetch 使用者給的網址 |
| `getSubscriptionStatus()`、`subscribeFields()` | readiness、開關留言接收、`meta-connect`、補訂閱腳本、`meta-token-health` | `POST subscribed_apps` 是整份取代，`fields` 必須是完整清單 |

**訂閱欄位只有一份定義。** FB 的完整欄位由 `meta-connect.service.ts` 的 `subscribedFieldsFor(channelSettings)` 算出：4 個私訊欄位（`BASE_SUBSCRIBED_FIELDS`），`settings.commentReply.receiving` 為 true 時加 `feed`。IG 用 `comment-reply-channel.service.ts` 的 `IG_BASE_SUBSCRIBED_FIELDS`（`messages`）加 `comments`。首次連結、重新連結、開關留言接收、補訂閱腳本（`apps/api/src/scripts/comment-reply-subscriptions.ts`）都經這兩處；少帶一個私訊欄位就是那個粉專的私訊全部中斷。

**進站的留言分支。** 平台 App（`/webhooks/meta`）與渠道網址（`/webhooks/fb|threads/:channelId`）驗簽後，先照舊處理私訊，再以 `parseCommentEvents()` 解析留言、以與私訊相同的帳號分派（`routePlatformMessages()`／`routeWebhookMessages()`，依 `entry.id`）分到各渠道，交給 `comment-reply-intake.flow.ts`。單一渠道的留言收件失敗只寫 `comment_intake_failed` 分派警示與 error log，不影響同一請求的私訊。

**兩個註冊表。** workers 的 `createWorkerPluginRegistry()` 放的是同一個 `fbPlugin`、`threadsPlugin` 物件，留言擴充自動帶過去；目前只有 API 行程使用留言擴充（收件、送出、排程都在 API 行程）。

### 兩處建立聯絡人的邏輯要同步

FB／IG 的聯絡人現在有兩個建立入口，規則必須一致，改一邊要一起改另一邊：

| 入口 | 程式 | 做什麼 |
| --- | --- | --- |
| 留言收件 | `comment-reply-intake.service.ts` 的 `resolveCommentAuthor()`、`comment-reply-contact.service.ts` 的 `linkRecipientIdentity()` | 命中規則的留言：依序找 `comment_authors`、同渠道 `uid` 相同的 `ChannelIdentity`、IdentityMap（`resolveUidToContact()`），都沒有才建聯絡人（`createdContact=true`），**不建 `ChannelIdentity`**、不發 `contact.created`。私訊成功後才以 `recipient_id` 建身分；該身分已屬於另一位聯絡人時，留言建立的聯絡人以合併引擎併入（`source='COMMENT_REPLY'`） |
| 私訊進站 | `inbound-contact-resolver.ts` 的 `resolveInboundContact()`，經 `webhook/inbound-comment-origin.ts` | 新 UID 建聯絡人前先查 `comment_authors`（`psid` 或留言者 ID 等於 UID）→ 把身分建在那位聯絡人。聯絡人是留言建立的：不送招呼語，第一次進站時以 `contactEventPublishedAt` 條件更新認領後補發一次 `contact.created`；訊息落地後 `attachInboundCommentOrigin()` 把留言私訊紀錄關聯到對話 |

聯絡人顯示名稱的後備（`<渠道名稱> User <ID 後 6 碼>`）兩邊相同。新增建立聯絡人的條件（例如新的身分來源）時，兩個入口都要處理，否則同一位顧客會被建成兩位聯絡人。

## 外掛之外的渠道專屬程式

下列功能只支援特定渠道，程式直接寫在各模組，不經過外掛：

| 功能 | 位置 | 支援的渠道 |
| --- | --- | --- |
| 驗證憑證 | `channel.service.ts` 的渠道驗證 | LINE、FB、THREADS 各一段，直接呼叫渠道 API |
| 自動設定 webhook | `line-webhook-setup.service.ts` | LINE。外掛的 `setWebhook()` 沒有被使用 |
| 檢查 access token 是否過期 | `fb-token-monitor.service.ts` | FB |
| 圖文選單的建立與發布 | `line/rich-menu.line-api.ts`，由 `rich-menu.flow.ts` 在交易外直接呼叫 LINE API | LINE。綁定使用者則走外掛的 `extensions.ui` |
| 重抓個人資料 | `line/line-profile.service.ts` | LINE |
| MCP 的 LINE 工具 | `mcp.server.ts` | LINE |
| 素材的格式檢查 | `marketing/material.service.ts`，呼叫 LINE 的訊息驗證 API | LINE。素材以自己的小寫 `channelType`（`line`、`fb`）區分，與 `Channel.channelType` 不同 |

另有一些模組以 `channelType` 分支，對不同渠道做不同的事。這違反 `AGENTS.md` 的結構規則 5，但改成走外掛的成本高，因此只記錄位置，不要照抄。下表是 2026-10-01 以 `AGENTS.md` 規則 5 的檢查指令核對的結果：

| 位置 | 分支做什麼 |
| --- | --- |
| `conversation/conversation.service.ts` | LINE 先用 reply token 回覆，失敗才 push；WebChat 推送給訪客的 socket |
| `channel/channel.service.ts`、`channel.routes.ts` | 依渠道選擇憑證欄位與驗證方式；顯示 Facebook 權杖狀態 |
| `webhook/webhook.service.ts` | 選擇驗簽用的秘密：`FB`、`THREADS` 用 `appSecret`，其他用 `channelSecret` |
| `marketing/marketing.service.ts` | LINE 且素材沒有變數時用 multicast |
| `identity-binding/binding-links.ts` | 依渠道產生導流連結（LINE 的加好友與預填文字、FB 的 `m.me`、IG 的 `ig.me`）與顧客看到的帳號稱呼 |
| `apps/workers/src/lib/channel-delivery.ts` | LINE 先用 reply token 回覆，失敗才 push |

檢查指令也會找到另外兩種程式，它們不算違規：

- 只擋不支援渠道的檢查。這些功能本來就只為一種渠道而做：`mcp`、`line` 的圖文選單、`chatbox`。
- 比對設定值的條件，例如 `canvas.webhook.ts` 比對流程觸發條件裡的 `channelType`。

## 新增一種渠道

1. 在 `schema.prisma` 的 `ChannelType` 與 `packages/shared`、`packages/types` 的渠道型別加入新類型。兩個套件各有一份，見 PKG-01。
2. 在 `packages/channel-plugins/src/` 實作 `ChannelPlugin`，匯出一個實例，並在 `package.json` 的 `exports` 加上子路徑（確認路徑與實際輸出一致，見 PKG-02）。
3. 在 `apps/api/src/index.ts` 以 `registerChannelPlugin()` 註冊，並更新同檔的啟動 log（見 APP-03）。
4. 在 `apps/workers/src/lib/plugin-registry.ts` 的 `createWorkerPluginRegistry()` 加入同一個外掛，否則自動化與關鍵字回覆送不出去。
5. 在 `webhook.routes.ts` 加上進站路由；驗簽用的秘密不是 `appSecret` 或 `channelSecret` 時，修改 `processWebhookEvent()` 的選擇。
6. 在 `channel.routes.ts` 的 `createChannelSchema` 加入新類型，並定義憑證欄位的檢查。
7. 需要的話，在 `channel.service.ts` 加上驗證憑證的分支，並在前端的渠道管理頁加上表單。
8. 檢查[外掛之外的渠道專屬程式](#外掛之外的渠道專屬程式)列出的功能，決定新渠道是否支援。

## 目前的限制

| 限制 | 詳見 `../system/AUDIT.md` |
| --- | --- |
| workers 沒有網站聊天室外掛；關鍵字回覆不限渠道，在網站聊天室命中時送不出去，機器人也不回覆 | CHAN-02 |
| Telegram 沒有註冊；WhatsApp 可以建立但沒有外掛 | APP-02 |
| 啟動 log 少列 Threads | APP-03 |
| `./fb` 子路徑指向不存在的檔案 | PKG-02 |
| 渠道型別在兩個套件各有一份 | PKG-01 |
| 外掛套件裡有沒有呼叫端的程式 | PKG-06 |
| 有對話的渠道刪除回 409，只能停用 | CHAN-01 |

## 自己驗證的方法

```bash
# 兩個行程各註冊了哪些外掛
grep -n "registerChannelPlugin" apps/api/src/index.ts
grep -nE "(line|fb|threads|webchat)Plugin" apps/workers/src/lib/plugin-registry.ts

# 以 channelType 分支的程式
grep -rn "channelType *[!=]==\|[!=]== *CHANNEL_TYPE" apps/api/src apps/workers/src --include='*.ts'

# 外掛的選用方法有誰呼叫
grep -rn "setWebhook\|resolveInboundMedia\|extensions?\.\(ui\|audience\|analytics\)" apps --include='*.ts'
```
