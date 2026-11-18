# LINE 工具

側欄「渠道」底下是 LINE 官方帳號專用的工具：圖文選單（Rich Menu）、加好友禮與快速回覆，以及 LINE、Facebook、Instagram 共用的關鍵字回覆。本文件也說明 LINE 訊息怎麼進站、怎麼送出，以及 LIFF 與 LINE Login。渠道本身的新增與設定不在這裡，見[渠道管理](./CHANNELS.md)。

- **資料來源**：`apps/api/src/modules/line/*`、`apps/workers/src/handlers/rich-menu-bind.handler.ts`、`apps/web/src/app/dashboard/line/*`、`apps/web/src/components/inbox/MessageInput.tsx`
- **核對日期**：2026-09-30

## 負責的程式

| 頁面 | 程式 | 權限 |
| --- | --- | --- |
| LINE Rich Menu | `line` 的 `rich-menu.routes.ts`、`rich-menu.service.ts`；分眾綁定由 workers 的 `rich-menu-bind.handler.ts` 執行 | `richmenu.manage`（整個 plugin） |
| 關鍵字回覆（LINE、Facebook、Instagram；2026-10-27 之前名為「LINE 關鍵字回覆」） | `automation` 模組，見[自動化](./AUTOMATION.md#關鍵字回覆) | `automation.view`、`automation.manage` |
| LINE 快速回覆 | `line` 的 `quick-reply-preset.routes.ts`、`quick-reply-preset.flow.ts`、`quick-reply-preset.service.ts` | 讀取只驗登入；新增、修改、刪除需要 `quickreply.manage` |

側欄的「渠道」選單要求 `richmenu.manage` 才顯示。因此只有 `automation.manage` 或 `quickreply.manage`、沒有 `richmenu.manage` 的成員，在側欄找不到關鍵字回覆與快速回覆的入口。

## 圖文選單

圖文選單是 LINE 聊天室下方的選單。每個選單屬於一個 LINE 渠道，由一張背景圖與多個可點擊區域組成。

### 生命週期

| 狀態 | 意思 |
| --- | --- |
| `draft` | 只存在於本系統，LINE 上沒有 |
| `publishing` | 發布中：已認領，正在呼叫 LINE。停留超過 5 分鐘時畫面顯示「發布中斷」，可以重新發布 |
| `published` | 已在 LINE 建立，`lineRichMenuId` 記錄 LINE 給的 ID |
| `error` | 發布過程失敗，可以重新發布 |

選單有兩個互相獨立的選項（change `migrate-line-tenant-ctx` 之前兩者是同一個 `selected` 欄位）：

| 欄位 | 編輯頁的選項 | 意思 |
| --- | --- | --- |
| `isDefault` | 設為所有好友的預設選單 | 已發布：是否為這個渠道所有好友的預設選單；草稿：發布時是否設成預設 |
| `selected` | 聊天室打開時展開選單 | 送進 LINE 建立選單 API 的 `selected`，新建時預設勾選 |

**發布**（`POST /line/rich-menus/:id/publish`）拆成下列幾段，LINE 上最多建立一次選單：

1. 交易內認領：狀態從 `draft`、`error` 改成 `publishing`。同一個選單或同一個渠道的其他選單正在發布時，回 409 `PUBLISH_IN_PROGRESS`。停在 `publishing` 超過 5 分鐘（例如部署時中斷）視為中斷，可以重新發布。
2. 交易外呼叫 LINE（每次呼叫 30 秒逾時）：下載背景圖 → 建立選單 → 上傳背景圖。
3. 交易內寫入：狀態改成 `published`，先記成非預設。
4. `isDefault` 時，交易外設預設。設預設不先取消原本的預設，由 LINE 直接以新選單取代。成功後交易內把這張記成預設，同渠道其他已發布選單不再是預設。

失敗時：

- 下載背景圖失敗：還沒呼叫 LINE，狀態回到發布前。
- LINE 建好選單之後、寫入 `published` 之前失敗（上傳失敗、寫入失敗）：刪除剛建立的 LINE 選單，狀態改成 `error`。這時還沒設預設，LINE 的預設不變。刪除也失敗時，LINE 上留下孤兒選單，log 記下 LINE 端的 ID。
- 設預設失敗：仍然發布，但這張選單不記成預設，LINE 回錯誤時原本的預設不變（逾時時 LINE 可能已經設好，見「目前的限制」），回應的 `warnings` 帶 `DEFAULT_NOT_SET`，畫面顯示提示。要再設成預設，管理員取消發布、重新勾選預設並儲存，再發布。

**下架**（`POST /line/rich-menus/:id/unpublish`）：預設選單先查 LINE 目前的預設，是這張才取消預設；接著從 LINE 刪除選單，狀態回到 `draft`。LINE 回 404 時視為已經不存在，照樣清掉本地狀態。`isDefault` 保留，重新發布時仍設成預設。

只有 `draft` 狀態的選單可以修改與刪除。已發布的選單要改內容，先下架、修改、再發布，或用「複製」建立新的草稿。`error` 狀態的選單可以在列表卡片或編輯頁重新發布，但不能修改，也不能刪除；畫面只對 `published` 的選單顯示「取消發布」，所以 `error` 的選單也無法從畫面退回草稿。

### 分眾綁定

預設選單對所有人生效。要讓特定一群人看到另一個選單，用分眾綁定：

| 動作 | 端點 | 對象 |
| --- | --- | --- |
| 綁定 | `POST /line/rich-menus/:id/bind-audience` | 一個分群，或一個標籤 |
| 解除綁定 | `POST /line/rich-menus/:id/unbind-audience` | 同上 |

API 把分群或標籤解析成這個渠道的 LINE uid 清單，在交易內寫進 outbox 就回應，commit 之後送進 `rich-menu-bind` queue，至少送出一次。Redis 暫時無法使用時，請求仍回成功，由 outbox-relay 補送。workers 分批呼叫 LINE 的批次綁定 API，避免一次送太多撞到 LINE 的頻率限制。

綁定工作可能晚於下架或重新發布才執行。workers 綁定前先查選單：選單已不是 `published`，或 LINE 端的 ID 已經改變時跳過。解除綁定不檢查，客人回到全體預設選單。

綁定是當下的快照：只綁定操作當時符合條件的人。之後才加入分群或被貼標的人，不會自動綁定。系統也不記錄誰被綁到哪個選單，綁定的狀態只存在 LINE 端。

## 收 LINE 訊息

LINE 把事件送到 `POST /api/v1/webhooks/line/:channelId`。程式在 `apps/api/src/modules/webhook/`，解析在 `packages/channel-plugins/src/line/index.ts` 的 `parseWebhook()`。

1. **回應前先驗簽。** 以渠道的 `channelSecret` 計算 HMAC，比對 `x-line-signature`。簽章缺少或錯誤、路由與渠道的類型不同時回 403；渠道不存在或租戶停用時回 200 並丟棄事件；憑證解不開時回 500。
2. **回 200 之後在背景處理事件。** 每個事件存成一則進站訊息，再經過進站管線，見[租戶後台](./README.md#一則訊息進來之後)。

各種事件怎麼存：

| 事件 | 存法 |
| --- | --- |
| `message`（文字、圖片、影片、音訊、檔案、位置、貼圖） | LINE 代管的媒體存 `contentId`，背景下載到物件儲存，上限 25 MB；下載失敗寫 `content.mediaError` |
| `postback` | 存成 `contentType: 'postback'`，`content.text` 是 `postback.data`。日期選擇器選的值（`postback.params`）不保存 |
| `follow`、`unfollow`、`unsend` 與其他系統事件 | 存成一則進站訊息，收件匣顯示「[不支援的訊息類型]」並增加未讀數。`unsend` 不會隱藏原本的訊息。`unfollow` 在 `ChannelIdentity.blockedAt` 記下封鎖時間，`follow` 清除這個值。分流在 `inbound-system-events.ts` |

- **對話的對象**是 `source.userId`，沒有時用 `groupId`。群組裡的訊息掛在發話者的一對一對話上；`roomId` 不處理。
- **去重**只看 LINE 的 `message.id`。postback、follow 這類沒有訊息 ID 的事件，LINE 重送時會再處理一次。
- **postback 攔截。** 進站管線依序檢查跨渠道綁定、傳訊領券、招呼語，再交給 `inbound-postback-interceptors.ts`：`tag:<標籤 ID>` 貼標、`csat:<分數>:<工單 ID>` 記錄滿意度、`kb_feedback:...` 記錄知識庫回報、`handoff_request` 轉真人。客人打出相同的文字也會命中。
- **下游轉發**（`settings.downstreamWebhook`，`downstream-forwarder.ts`）。`immediate` 只轉發、系統不處理；`after` 系統處理後再轉發。目標網址被 SSRF 檢查擋下或 DNS 解析失敗時只寫 log。

## 送 LINE 訊息

- **訊息格式。** `buildLineMessage()` 依訊息的 `contentType` 組成 LINE 的訊息物件：文字、快速回覆、Flex（滿意度問卷）、圖片、影片、檔案、音訊、位置、貼圖，以及素材的 `line_*` 版型。不認得的 `contentType` 不送出，回傳失敗。imagemap 素材的圖片由 `GET /line-imagemap/...`（`apps/api/src/modules/storage/line-imagemap.routes.ts`）依 LINE 要求的寬度提供。
- **reply 與 push。** 系統在收到訊息後 30 秒內用 reply token 回覆；超過 30 秒，或 reply 失敗時，改用 push。
- **上限。** LINE 一次最多送 5 則訊息、快速回覆最多 13 個按鈕；multicast 每批最多 500 人。

## LIFF 與 LINE Login

渠道設定的 `liffConfig` 有兩個欄位，見[渠道管理](./CHANNELS.md)的「渠道設定」：

| 欄位 | 用途 |
| --- | --- |
| `liffId` | 短連結在 LINE 裡開啟時走 LIFF 頁取得點擊者的 LINE uid，見[短連結](./SHORTLINKS.md) |
| `loginChannelId` | 優惠券票券夾以 LINE ID token 驗證顧客（`apps/api/src/modules/coupon/line-id-token.ts`） |

要讓同一個顧客在不同 LINE 官方帳號有相同的 uid，這些官方帳號與 LIFF 的 Login channel 必須在 LINE 的同一個 provider。

## 渠道憑證

LINE 的 `channelSecret`、`channelAccessToken` 以 AES-256-GCM 加密後存在 `Channel.credentialsEncrypted`，金鑰是 `CREDENTIAL_ENCRYPTION_KEY`。API（`channel.service.ts`）與 workers（`apps/workers/src/lib/credentials.ts`）各有一份解密程式，修改時兩邊一起改。沒有金鑰輪替機制：更換金鑰後，所有渠道要重新填寫憑證。

## 快速回覆

快速回覆是訊息下方的一排按鈕，客人點了就送出按鈕上的文字。快速回覆組合（`QuickReplyPreset`）是預先存好的一組按鈕：

- 屬於租戶，不綁渠道，所有 LINE 渠道共用。
- 項目數、標籤與文字的長度上限依 LINE 規格，寫在 `quick-reply-preset.service.ts`。
- 客服在收件匣的輸入框（`MessageInput.tsx`）選一組，附在這次回覆的訊息上一起送出。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 分眾綁定只綁當下符合條件的人 | 之後加入的人不會自動綁定，系統也不記錄綁定狀態 |
| LINE 與資料庫沒有定期對帳（#457） | 補償刪除失敗留下的孤兒選單、設預設逾時但 LINE 其實已設好的預設、設好預設之後沒寫進資料庫的預設、在 LINE 官方帳號後台手動改的預設，系統不會自動修正 |
| 綁定與解除綁定交錯 | 同一個已發布選單先綁定再解除綁定，綁定工作晚到時客人會被綁回；系統不記錄每個受眾的綁定狀態 |
| 側欄入口只看 `richmenu.manage` | 只有其他兩個權限的成員找不到關鍵字回覆與快速回覆 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
