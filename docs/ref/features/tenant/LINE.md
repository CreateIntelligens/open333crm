# LINE 工具

側欄「渠道」底下是 LINE 官方帳號專用的工具：圖文選單（Rich Menu）、加好友禮與快速回覆，以及 LINE、Facebook、Instagram 共用的關鍵字回覆。本文件也說明 LINE 訊息怎麼進站、怎麼送出，以及 LIFF 與 LINE Login。渠道本身的新增與設定不在這裡，見[渠道管理](./CHANNELS.md)。

- **資料來源**：`apps/api/src/modules/line/*`、`apps/api/src/modules/webhook/*`、`packages/channel-plugins/src/line/index.ts`、`apps/workers/src/handlers/rich-menu-bind.handler.ts`、`apps/web/src/app/dashboard/line/*`、`apps/web/src/components/line/*`、`apps/web/src/components/inbox/MessageInput.tsx`
- **核對日期**：2026-11-19

## 負責的程式

| 頁面 | 程式 | 權限 |
| --- | --- | --- |
| LINE Rich Menu | `line` 的 `rich-menu.routes.ts`、`rich-menu.service.ts`；分眾綁定由 workers 的 `rich-menu-bind.handler.ts` 執行 | `richmenu.manage`（整個 plugin） |
| 關鍵字回覆（LINE、Facebook、Instagram） | `automation` 模組，見[自動化](./AUTOMATION.md#關鍵字回覆) | `automation.view`、`automation.manage` |
| LINE 快速回覆 | `line` 的 `quick-reply-preset.routes.ts`、`quick-reply-preset.flow.ts`、`quick-reply-preset.service.ts` | 讀取只驗登入；新增、修改、刪除需要 `quickreply.manage` |

側欄的「渠道」選單要求 `richmenu.manage` 才顯示。因此只有 `automation.manage` 或 `quickreply.manage`、沒有 `richmenu.manage` 的成員，在側欄找不到關鍵字回覆與快速回覆的入口。

## 程式的入口

| 端點 | 程式 | 要知道的事 |
| --- | --- | --- |
| `POST /api/v1/webhooks/line/:channelId` | `webhook.routes.ts` 驗簽 → 背景的 `webhook.service.ts` `processWebhookEvent()` → `LinePlugin.parseWebhook()` → `processInboundMessage()` | 公開端點，以 `channelSecret` 驗簽。見[收 LINE 訊息](#收-line-訊息) |
| `/api/v1/line/rich-menus` 底下的端點 | `rich-menu.routes.ts` → `rich-menu.flow.ts`、`rich-menu.service.ts`；呼叫 LINE 的程式在 `rich-menu.line-api.ts` | 列表、單筆、建立、修改、刪除、複製走 `flowOf()`；發布是 `publishRichMenuFlow()`，取消發布是 `unpublishRichMenuFlow()`，綁定與解除綁定是 `bindRichMenuAudienceFlow`、`unbindRichMenuAudienceFlow` |
| `/api/v1/line/quick-reply-presets` 底下的端點 | `quick-reply-preset.routes.ts` → `quick-reply-preset.flow.ts`、`quick-reply-preset.service.ts` | |
| `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` | `line-profile.routes.ts` → `line-profile.flow.ts` | 向 LINE 重抓聯絡人的名稱與頭像，需要 `contact.update` |
| `GET /line-imagemap/:tenantId/:imageId/:width` | `apps/api/src/modules/storage/line-imagemap.routes.ts` | 公開端點，不在 `/api` 底下。見[送 LINE 訊息](#送-line-訊息) |
| `rich-menu-bind` 佇列 | `apps/workers/src/handlers/rich-menu-bind.handler.ts` | 見[分眾綁定](#分眾綁定) |

優惠券的 LIFF 驗證 `/api/v1/fan/coupons/liff-session` 屬於[行銷](./MARKETING.md)。

## 圖文選單

圖文選單是 LINE 聊天室下方的選單。每個選單屬於一個 LINE 渠道，由一張背景圖與多個可點擊區域組成。

### 生命週期

| 狀態 | 意思 |
| --- | --- |
| `draft` | 只存在於本系統，LINE 上沒有 |
| `publishing` | 發布中：已認領，正在呼叫 LINE。停留超過 5 分鐘時畫面顯示「發布中斷」，可以重新發布 |
| `published` | 已在 LINE 建立，`lineRichMenuId` 記錄 LINE 給的 ID |
| `error` | 發布過程失敗，可以重新發布 |

選單有兩個互相獨立的選項，不要混用：

| 欄位 | 編輯頁的選項 | 意思 |
| --- | --- | --- |
| `isDefault` | 設為所有好友的預設選單 | 已發布：是否為這個渠道所有好友的預設選單；草稿：發布時是否設成預設 |
| `selected` | 聊天室打開時展開選單 | 送進 LINE 建立選單 API 的 `selected`，新建時預設勾選 |

**發布**（`POST /line/rich-menus/:id/publish`）拆成下列幾段，LINE 上最多建立一次選單：

發布的是已經存檔的內容。

1. 交易內認領：狀態從 `draft`、`error` 改成 `publishing`。同一個選單或同一個渠道的其他選單正在發布時，回 409 `PUBLISH_IN_PROGRESS`。停在 `publishing` 超過 5 分鐘（例如部署時中斷）視為中斷，可以重新發布。
2. 交易外呼叫 LINE（每次呼叫 30 秒逾時）：下載背景圖 → 建立選單 → 上傳背景圖。伺服器直接以 `fetch()` 下載 `imageUrl`，不擋內網位址（HC-LINE-04）。
3. 交易內寫入：狀態改成 `published`，先記成非預設。
4. `isDefault` 時，交易外設預設。設預設不先取消原本的預設，由 LINE 直接以新選單取代。成功後交易內把這張記成預設，同渠道其他已發布選單不再是預設。

失敗時：

- 下載背景圖失敗：還沒呼叫 LINE，狀態回到發布前。
- LINE 建好選單之後、寫入 `published` 之前失敗（上傳失敗、寫入失敗）：刪除剛建立的 LINE 選單，狀態改成 `error`。這時還沒設預設，LINE 的預設不變。刪除也失敗時，LINE 上留下孤兒選單，log 記下 LINE 端的 ID。
- LINE 回錯誤時，錯誤詳情在回應的 `details.upstream`。畫面只顯示「LINE 無法建立圖文選單，請確認版型與渠道設定後重試」（HC-LINE-14）。LINE 回 401 是 Access Token 錯，400 多半是圖片尺寸或區域動作。
- 設預設失敗：仍然發布，但這張選單不記成預設，LINE 回錯誤時原本的預設不變（逾時時 LINE 可能已經設好，見「目前的限制」），回應的 `warnings` 帶 `DEFAULT_NOT_SET`，畫面顯示提示。要再設成預設，管理員取消發布、重新勾選預設並儲存，再發布。

**下架**（`POST /line/rich-menus/:id/unpublish`）：預設選單先以 `GET /v2/bot/user/all/richmenu` 查 LINE 目前的預設，是這張才取消預設；接著從 LINE 刪除選單，狀態回到 `draft`。LINE 回 404 時視為已經不存在，照樣清掉本地狀態。`isDefault` 保留，重新發布時仍設成預設。

只有 `draft` 狀態的選單可以修改與刪除，刪除是硬刪除。「複製」連 `isDefault`、`selected` 一起複製。已發布的選單要改內容，先下架、修改、再發布，或用「複製」建立新的草稿。`error` 狀態的選單可以在列表卡片或編輯頁重新發布，但不能修改，也不能刪除；畫面只對 `published` 的選單顯示「取消發布」，所以 `error` 的選單也無法從畫面退回草稿（HC-LINE-09）。後端的 `unpublish` 可以把它退回草稿。

### 分眾綁定

預設選單對所有人生效。要讓特定一群人看到另一個選單，用分眾綁定：

| 動作 | 端點 | 對象 |
| --- | --- | --- |
| 綁定 | `POST /line/rich-menus/:id/bind-audience` | 一個分群，或一個標籤 |
| 解除綁定 | `POST /line/rich-menus/:id/unbind-audience` | 同上 |

API 把分群或標籤解析成這個渠道的 LINE uid 清單，在交易內寫進 outbox 就回應，commit 之後送進 `rich-menu-bind` queue，至少送出一次。Redis 暫時無法使用時，請求仍回成功，由 outbox-relay 補送。workers 每 500 人呼叫一次 LINE 的批次綁定 API，避免一次送太多撞到 LINE 的頻率限制。API 只回 `{ queued }`。背景工作失敗時（權杖失效、LINE 限流）不重試、不通知，只有平台的佇列監控看得到 `rich-menu-bind` 的失敗工作與 `failedReason`（HC-LINE-06）。

綁定工作可能晚於下架或重新發布才執行。佇列工作的內容帶 `richMenuId`。workers 綁定前先查選單：選單已不是 `published`，或 LINE 端的 ID 已經改變時跳過。解除綁定不檢查，客人回到全體預設選單。

綁定是當下的快照：只綁定操作當時符合條件的人。之後才加入分群或被貼標的人，不會自動綁定。系統也不記錄誰被綁到哪個選單，綁定的狀態只存在 LINE 端。

## 收 LINE 訊息

LINE 把事件送到 `POST /api/v1/webhooks/line/:channelId`。程式在 `apps/api/src/modules/webhook/`，解析在 `packages/channel-plugins/src/line/index.ts` 的 `parseWebhook()`。

1. **回應前先驗簽。** `verifyWebhookRequest()` 以渠道的 `channelSecret` 計算 HMAC，比對 `x-line-signature`；字串比較用固定時間的 `signaturesMatch()`。FB 與 IG 用 `appSecret` 驗簽。webhook 的 content-type parser 把原始 body 留在 `__rawBody`，驗簽用這份；改 body 的解析方式會讓驗簽全部失敗。簽章缺少或錯誤、路由與渠道的類型不同時回 403；渠道不存在或租戶停用時回 200 並丟棄事件；憑證解不開時回 500。網址的 `channelId` 不是 UUID 時也回 500（HC-LINE-12）。失敗時 API log 有 `[Webhook] Signature verification failed`、`Channel not found or inactive` 或 `Tenant is disabled`。
2. **回 200 之後在背景處理事件。** 每個事件存成一則進站訊息，再經過進站管線，見[租戶後台](./README.md#一則訊息進來之後)。租戶由 `channelId` 反查，所以 webhook 一律用 `prismaAdmin`（沒有 RLS），每個查詢都要自己帶 `tenantId` 或渠道條件。

各種事件怎麼存：

| 事件 | 存法 |
| --- | --- |
| `message`（文字、圖片、影片、音訊、檔案、位置、貼圖） | LINE 代管的媒體存 `contentId`，背景下載到物件儲存，上限 25 MB；下載失敗寫 `content.mediaError` |
| `postback` | 存成 `contentType: 'postback'`，`content.text` 是 `postback.data`，收件匣直接顯示原始資料，例如 `tag:<標籤 ID>`、`menu=main`。日期選擇器選的值（`postback.params`）不保存（HC-LINE-11） |
| `follow`、`unfollow`、`join`、`leave`、`memberJoined`、`memberLeft`、`unsend`、`videoPlayComplete`、`accountLink`、`beacon` | 存成一則進站訊息，收件匣顯示「[不支援的訊息類型]」並增加未讀數（HC-LINE-10）。`unsend` 不會隱藏原本的訊息（HC-LINE-03）。`unfollow` 在 `ChannelIdentity.blockedAt` 記下封鎖時間，`follow` 清除這個值；這個值只供顯示，發送時不排除封鎖的人 |

系統事件依 `contentType` 在 `apps/api/src/modules/webhook/inbound-system-events.ts` 分流：

- 系統事件不觸發非營業時間的自動回覆。
- Canvas 以自己的事件類型比對，`unfollow` 不觸發 Canvas。
- `unfollow` 的 uid 系統沒見過時，整筆略過，不建立聯絡人。
- 加好友的招呼語用 `follow` 事件的 reply token 送出，失敗時改用 push。

- **對話的對象**是 `source.userId`，沒有時用 `groupId`。群組裡的訊息掛在發話者的一對一對話上，客服回覆會私訊給這個人（HC-LINE-08）。`join` 事件以 `groupId` 建一個聯絡人。`roomId` 不處理。
- **去重**只看 LINE 的 `message.id`（`channelMsgId`）。postback、follow 這類沒有訊息 ID 的事件，LINE 重送（`deliveryContext.isRedelivery`）時會再處理一次（HC-LINE-02）。`webhookEventId` 只用在下游轉發的迴圈防護。
- **postback 攔截。** `processInboundMessage()` 依序檢查跨渠道綁定、傳訊領券、招呼語，再交給 `inbound-postback-interceptors.ts`，依序處理：
  1. `tag:<標籤 ID>` 貼標。貼標之後繼續往下處理，不中斷。
  2. `csat:<1-5>:<工單 ID>` 記錄滿意度。
  3. `kb_feedback:<good|bad>:<文章 ID 或 none>:<訊息 ID>` 記錄知識庫回報。
  4. `handoff_request` 轉真人。

  客人打出相同的文字也會命中。
- **下游轉發**（`settings.downstreamWebhook`，`{ enabled, url, mode }`，`downstream-forwarder.ts`）。`url` 必須是 https。`immediate` 只轉發、系統不處理；`after` 系統處理後再轉發。目標網址被 `isBlockedUrl()` 擋下或 DNS 解析失敗時只寫 log（`[DownstreamWebhook] Blocked SSRF target`）。`immediate` 模式下，這則訊息因此完全消失（HC-LINE-05）。轉發前以 `downstream-loop-guard.ts` 的 `claimForForward()` 防止迴圈。存設定時在渠道設定的 `DownstreamWebhookDialog`，需要 `channel.update`。

## 送 LINE 訊息

- **訊息格式。** `buildLineMessage()` 依訊息的 `contentType` 組成 LINE 的訊息物件：`text`、`quick_reply`、`flex`（滿意度問卷）、`image`、`video`、`file`、`audio`、`location`、`sticker`，以及素材的 `line_*` 版型。`flex` 需要 `altText` 與 `contents`；舊資料的 `{ text, flexJson }` 也接受。不認得的 `contentType`（例如 FB 素材的 `fb_*`）丟 `LineMessageBuildError`，`sendMessage()` 回 `{ success: false, error }`，不呼叫 LINE。
- **送出失敗不拋錯。** `LinePlugin.sendMessage()` 失敗時回 `{ success: false }`，不丟例外。呼叫端要檢查回傳值，否則失敗只剩 log。
- **imagemap 的圖。** `GET /line-imagemap/:tenantId/:imageId/:width` 依 LINE 要求的寬度提供 imagemap 素材的圖片。這個端點必須公開，因為 LINE 匿名抓圖。寬度只允許 240、300、460、700、1040，其他回 400。素材的 baseUrl 是 `{API_PUBLIC_URL}/line-imagemap/{tenantId}/{imageId}`，不含副檔名，LINE 自己接上 `/{寬度}`。前端預覽用 `apps/web/src/lib/imagemap-url.ts` 的 `imagemapPreviewSrc`。
- **reply 與 push。** `selectSafeLineStrategy()`（`packages/shared/src/safe-reply.ts`）只在收到訊息後 30 秒內用 reply token 回覆；超過 30 秒，或 reply 失敗時，改用 push。`message.received` 事件帶 `replyToken`，所以對外 Webhook 也收得到（HOOK-01）。
- **上限。** LINE 一次最多送 5 則訊息、快速回覆最多 13 個按鈕、按鈕標籤最多 20 字；multicast 每批最多 500 人，群發每批送 499 人。

## LIFF 與 LINE Login

渠道設定的 `liffConfig` 有兩個欄位，在渠道設定的 `BotConfigForm` 填寫，以 `PATCH /channels/:id` 寫入，需要 `channel.update`。見[渠道管理](./CHANNELS.md)的「渠道設定」：

| 欄位 | 用途 |
| --- | --- |
| `liffId` | 短連結在 LINE 裡開啟時走 LIFF 頁（`/liff/redirect`）取得點擊者的 LINE uid，見[短連結](./SHORTLINKS.md)。格式是 10 位數字、`-`、8 個英數字，例如 `1234567890-AbcdEfgh` |
| `loginChannelId` | 優惠券票券夾以 LINE ID token 驗證顧客（`apps/api/src/modules/coupon/line-id-token.ts`）。格式是 10 位數字 |

要讓同一個顧客在不同 LINE 官方帳號有相同的 uid，這些官方帳號與 LIFF 的 Login channel 必須在 LINE 的同一個 provider。

## 渠道憑證

LINE 的 `channelSecret`、`channelAccessToken` 以 AES-256-GCM 加密後存在 `Channel.credentialsEncrypted`，金鑰是 `CREDENTIAL_ENCRYPTION_KEY`（至少 32 字）。租戶自備的 AI 金鑰也用這把金鑰（AI-01）。API（`channel.service.ts`）與 workers（`apps/workers/src/lib/credentials.ts`）各有一份解密程式，修改時兩邊一起改。沒有金鑰輪替機制：更換金鑰後，所有渠道要重新填寫憑證。本機從 UAT 同步的渠道憑證是 UAT 的金鑰加密的，本機解不開，LINE 素材或渠道操作會回 500；到渠道設定重填 Secret 與 Token 即可。

## 快速回覆

快速回覆是訊息下方的一排按鈕，客人點了就送出按鈕上的文字。快速回覆組合（`QuickReplyPreset`）是預先存好的一組按鈕：

- 屬於租戶，不綁渠道，所有 LINE 渠道共用。
- 項目數、標籤與文字的長度上限依 LINE 規格，寫在 `quick-reply-preset.service.ts`：最多 13 個按鈕，標籤 20 字，文字 300 字。
- 客服在收件匣的輸入框（`MessageInput.tsx`）選一組，附在這次回覆的訊息上一起送出。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 分眾綁定只綁當下符合條件的人 | 之後加入的人不會自動綁定，系統也不記錄綁定狀態 |
| LINE 與資料庫沒有定期對帳 | 補償刪除失敗留下的孤兒選單、設預設逾時但 LINE 其實已設好的預設、設好預設之後沒寫進資料庫的預設、在 LINE 官方帳號後台手動改的預設，系統不會自動修正 |
| 綁定與解除綁定交錯 | 同一個已發布選單先綁定再解除綁定，綁定工作晚到時客人會被綁回；系統不記錄每個受眾的綁定狀態 |
| 側欄入口只看 `richmenu.manage` | 只有其他兩個權限的成員找不到關鍵字回覆與快速回覆 |

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| `/dashboard/line/rich-menus?channelId=` 的官方帳號切換（`OaSwitcher`） | `GET /channels`，需要 `channel.view` | 列出啟用中的 LINE 渠道。網址帶 `channelId` 時自動選中。沒有權限時，畫面顯示「尚未建立任何 Rich Menu」，看不出是 403（HC-LINE-15） |
| 「建立 Rich Menu」→ 選版型 → `RichMenuEditor` | 背景圖 `POST /files/upload`；`POST /line/rich-menus` | 前端檢查背景圖的比例、像素與 1 MB 上限。草稿只寫資料庫 |
| 卡片的「編輯」→ `rich-menus/[id]` | `PATCH /line/rich-menus/:id` | 只有 `draft` 能改 |
| 卡片的「發布」、編輯頁的「發布到 LINE」 | `POST /line/rich-menus/:id/publish` | 確認視窗依 `isDefault` 換文字（`apps/web/src/lib/rich-menu-confirm.ts`） |
| 已發布卡片的「取消發布」 | `POST /line/rich-menus/:id/unpublish` | |
| 已發布卡片的「綁定受眾」（`RichMenuBindDialog`） | `POST /line/rich-menus/:id/bind-audience`，body `{ segmentId }` | 只能選分群。分群清單要 `marketing.view` |
| 卡片的「⋯」：複製、刪除 | `POST /line/rich-menus/:id/duplicate`、`DELETE /line/rich-menus/:id` | |
| `/dashboard/line/quick-replies`（`PresetEditDialog`） | `GET`、`POST`、`PATCH`、`DELETE /line/quick-reply-presets` | 「建立預設組」不依 `quickreply.manage` 隱藏，送出才 403（HC-LINE-15）。範例按鈕用了 emoji（HC-LINE-16）。收件匣的輸入框套用之後，按鈕附在訊息的 `quickReplies` |

下列 API 或程式沒有畫面入口或呼叫端：

- `POST /line/rich-menus/:id/unbind-audience`，以及綁定時帶 `tagId`。
- `error` 狀態選單的取消發布。
- LINE 外掛的 `extensions.audience`、`extensions.analytics`、LIFF App 管理、`issueAccountLinkToken`、`createMenuAlias`（PKG-06）。
- `apps/api/src/modules/storage/line-media.service.ts`。進站媒體實際由外掛的 `resolveInboundMedia` 下載（HC-LINE-17）。

前端送出的值：

- 圖文選單的 `size` 只有 `2500×1686`、`2500×843`。
- 區域動作：`postback`、`message`、`uri`、`datetimepicker`、`richmenuswitch`。新草稿的每一區預設 `{ type: 'postback', data: '', label: '' }`，LINE 接受空的 `label`。
- `uri` 只允許 `http`、`https`、`line`、`tel`（`lineUriSchema`）。
- 區域動作切成日期選擇器時，下拉顯示「日期 + 時間」，但沒有寫入 `mode`。存檔回 400「日期選擇器必須指定模式」，要手動改一次下拉（HC-LINE-07）。

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
