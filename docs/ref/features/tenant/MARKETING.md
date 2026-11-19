# 行銷

行銷是租戶主動對客人發訊息的地方。管理員先在素材庫準備內容，用分群或標籤挑出對象，建立一筆群發立即送出或排程送出；多筆群發可以歸在同一個行銷活動下一起看成效。優惠券可以附在群發裡，也可以用領券連結、對話、關鍵字與加好友禮發給客人，客人在券夾裡開啟並核銷。

- **資料來源**：`apps/api/src/modules/marketing/*`、`apps/api/src/modules/coupon/*`、`apps/api/src/modules/store/*`、`apps/web/src/app/dashboard/marketing/*`、`apps/web/src/app/coupon/*`、`apps/web/src/app/redeem/*`
- **核對日期**：2026-11-19

## 負責的程式

這些概念都在 `marketing` 模組：`marketing.routes.ts` 管行銷活動、群發與分群，`material.routes.ts` 管素材。

| 概念 | 服務 | 負責什麼 |
| --- | --- | --- |
| 行銷活動（`Campaign`） | `campaign.service.ts` | 把多筆群發歸在一起，彙總成效 |
| 群發（`Broadcast`） | `marketing.service.ts` | 建立、立即發送、取消，以及執行發送 |
| 受眾分群（`Segment`） | `segment.service.ts` | 以條件定義一群聯絡人，預覽人數 |
| 素材（`Material`） | `material.service.ts` | 訊息內容的範本，含分類、標籤、版本、預覽與成效 |
| 排程 | `broadcast.scheduler.ts` | API 行程定期找出到期的排程群發並執行 |
| 歸因 | `broadcast.tracking.ts` | 把客人的回覆與之後開的工單歸因到群發 |

四者的關係：

```text
行銷活動（Campaign）
  └─ 群發（Broadcast）── 發送內容：一個素材（Material）
                      ── 發送對象：全部 / 分群（Segment）/ 標籤 / 指定聯絡人
                      ── 發送渠道：一個渠道
```

## 程式的入口

路由前綴登記在 `apps/api/src/index.ts`：

| 前綴 | 路由檔 | 負責什麼 |
| --- | --- | --- |
| `/api/v1/marketing` | `marketing/marketing.routes.ts`、`marketing/material.routes.ts` | 行銷活動、群發、分群；素材與分類 |
| `/api/v1/coupons` | `coupon/coupon.routes.ts`、`coupon-instance.routes.ts`、`coupon-claim-link.routes.ts` | 券的 CRUD 與狀態、批次發送、序號；成效、序號明細與匯出；領券連結 |
| `/api/v1/coupon-issue` | `coupon/coupon-inbox.routes.ts` | 收件匣的對話發券 |
| `/api/v1/coupon-claim` | `coupon/coupon-claim-public.routes.ts` | 公開的領券頁資料 |
| `/api/v1/fan/coupons` | `coupon/coupon-fan.routes.ts` | 顧客端的開票券、券夾與核銷 |
| `/api/v1/store-console` | `store/store-console.routes.ts` | 門市核銷台 |

| 操作 | flow 或 service 函式 |
| --- | --- |
| 行銷活動 | `campaign.service.ts` 的 `createCampaign()` 等 |
| 建立群發 | `marketing.service.ts` 的 `createBroadcast()` |
| 發送群發 | `runQueuedBroadcast()` 分派到 `runCouponBroadcast()`（附券）或 `runPlainBroadcast()` → `executeBroadcast()`（一般） |
| 分群 | `segment.service.ts` 的 `calculateSegmentContacts()` |
| 素材 | `material.service.ts` |
| 券的狀態 | `coupon-lifecycle.service.ts` 的 `changeStatus()` |
| 傳訊領券 | `apps/api/src/modules/webhook/inbound-coupon-claim.ts` → `claimFromInbound()` |
| 關鍵字領券、加好友禮 | 自動化動作 `issue_coupon` → `apps/workers/src/lib/rule-coupon-issue.ts` |

## 素材

素材是可以重複使用的訊息內容。每個素材綁一個渠道類型（`channelType`）與一種內容類型（`contentType`）：

- `line_` 開頭的內容類型只能用在 LINE 素材，`fb_` 開頭的只能用在 Facebook 素材。
- LINE Flex Message 可以匯入 JSON、先驗證格式，也可以用 AI 從描述產生（`POST /materials/line-flex/ai-generate`，會使用租戶的 AI 額度）。

存檔時會檢查內容，不符合時回 400 並指出欄位：

- **LINE**：呼叫 LINE 的 `validate/push` API 檢查（沒有啟用中的 LINE 渠道時略過）。LINE 的錯誤由 `line-validate-error.ts` 整理：表單版型（純文字、圖片、影片、卡片、圖文）換成編輯器的欄位名稱與中文說明，對應不到的保留原文；Flex 版型是直接編輯 JSON，保留 LINE 的屬性路徑與原文。LINE 的原始回應放在錯誤的 `details.line`。卡片訊息的頁數加結尾頁超過 12 時，不呼叫 LINE 直接回 400（LINE 上限 12 個 bubble，發送時會截掉多的）。純文字的內容不是字串（例如 API 送數字）時也不呼叫 LINE 直接回 400，LINE 的檢核會接受數字。
- **FB**：FB 沒有檢核 API，由 `fb-material-validation.ts` 依版型檢查必填與長度、卡片與按鈕數量、按鈕類型、網址（只接受有網域的 `http(s)://` 與站內路徑 `/...`，擋下 `javascript:` 等）、金額與幣別、問卷類型與有效天數（1～7）、優惠券折扣碼（有填時不可含空白，與編輯器一致）。建立、修改內容與還原版本時都會檢查；只改名稱、分類或標籤時不檢查。

LINE 圖片的縮圖選填，沒填或空白時發送用主圖。

租戶啟用「個資遮罩」後，建立或編輯素材會在儲存前遮罩正文內的文字，並把遮罩版一起存進素材版本。編輯器預設選「個資遮罩」，此時遮罩版會作為實際發送內容；選「保留原文」只適用於本次儲存，素材仍會另存遮罩版。既有素材要重新儲存正文後才會產生遮罩版。

LINE 卡片訊息、圖文訊息與 Flex 的預覽文字（`altText`）顯示在聊天列表、手機通知與引用訊息。卡片訊息與圖文訊息沒填或空白時，分別用「多頁訊息」與「圖文訊息」；Flex 沒填時用「Flex Message」。

影片可以貼網址或直接上傳，上限依渠道：LINE 200 MB（LINE 影片訊息的上限），FB 25 MB（Messenger 附件的上限）。LINE 影片走直傳（`apps/web/src/lib/direct-upload.ts`），檔案從瀏覽器直接上傳到 MinIO/S3，不經過 API，上傳時顯示進度；FB 影片走一般上傳 `/files/upload`。超過上限的檔案在選檔時就擋下。

編輯器預設的示範圖是站內路徑 `/material-samples/...`。存檔時系統換成公開網址（`material-sample-urls.ts`）：LINE 只換示範圖，換成 `{WEB_BASE_URL}/material-samples/...`；FB 換網址欄位裡所有站內路徑（`/` 開頭、不是 `//`），因為 Facebook 只收完整網址。更早存成站內路徑的 FB 素材，由 FB plugin 在發送時換成 `{WEB_BASE_URL}{路徑}`；API 與 workers 都要設定 `WEB_BASE_URL`，沒有設定時這則訊息不送出，錯誤訊息指出是哪個網址。

素材的其他功能：

| 功能 | 說明 |
| --- | --- |
| 分類 | 樹狀分類（`MaterialCategory`）。舊的字串分類 `Material.category` 過渡保留 |
| 標籤 | `MATERIAL` scope 的標籤，存成字串陣列，見[聯絡人與標籤](./CONTACTS.md#標籤) |
| 版本 | 每次修改保留一個版本（`MaterialVersion`），可以還原 |
| 變數 | 內容裡可以放變數，發送時代入聯絡人資料 |
| 成效 | `GET /materials/:id/stats`：使用次數與點擊 |
| 按鈕貼標 | 按鈕的 postback 為 `tag:<標籤 ID>` 時，客人點擊後被貼上該標籤 |
| 券連結 | LINE、FB 純文字素材的編輯器有「插入顧客專屬券連結」（插入 `{{coupon.url}}`，只有附券廣播會發券並換成每位收件人的票券連結；預覽顯示成「顧客專屬券連結」標籤）與「插入領券連結」（從 `GET /coupons/claim-links?channelType=LINE|FB` 列出租戶內與素材同渠道、啟用、券進行中（固定效期已過到期日的不列）、沒有結束的領券連結，插入公開網址，需 `coupon.view` 或 `marketing.manage`） |

素材也用在自動化的「傳送素材」動作與關鍵字回覆，見[自動化](./AUTOMATION.md)。

`GET /marketing/templates` 是舊的訊息範本，保留給收件匣插入快速回覆用。範本管理介面已經下線。

## 分群

分群以條件組合挑出聯絡人，條件之間用 AND 或 OR 連接。支援的條件欄位在 `segment.service.ts` 的 `calculateSegmentContacts()`：

| 欄位 | 意思 |
| --- | --- |
| `tag` | 貼了指定標籤 |
| `channelType` | 在指定渠道類型有身分 |
| `createdAfter`、`createdBefore` | 聯絡人的建立時間 |

沒有任何有效條件時，分群是 0 人（fail-closed，`segment.service.ts`），避免群發誤發給全部聯絡人。已封存（包含被合併）的聯絡人一律排除。

建立日期的條件以 UTC 午夜切日，台灣時間 00:00～07:59 建立的聯絡人算在前一天（HC-MARKETING-09）。刪除分群是硬刪除，不檢查有沒有排程群發引用它；群發的 `segmentId` 因外鍵 `ON DELETE SET NULL` 變成 null，到期時群發標為失敗，原因寫「選擇『受眾分群』時必須指定一個分群」，看不出是分群被刪（HC-MARKETING-11）。

`Segment.contactCount` 是建立或修改當下算出的人數，之後不會自動更新。實際發送時會重新計算。

## 群發

### 建立與發送

建立群發時要選一個渠道、一個素材與一種發送對象。素材的渠道必須等於發送渠道；附上的券必須是進行中、用途 `MARKETING`、固定效期沒有過期。前端（`apps/web/src/lib/marketing/broadcast-form.ts`）與後端都檢查，改一邊要改另一邊。`scheduledAt` 以 `z.coerce.date()` 解析：前端把 `datetime-local` 轉成 ISO 送出；API 收到不帶時區的值（例如 `2026-12-31T23:59`）時，依伺服器時區解讀（HC-MARKETING-23）。帶了 `scheduledAt` 就建立為 `scheduled`，否則為 `draft`。`scheduledAt` 必須是晚於現在的時間，排到過去回 400：排程器取「時間已到」的群發執行，排到過去等於立即發送。表單的排程欄位也只能選一分鐘後以後的時間。這個檢查在 `createBroadcast()`，MCP 建立群發也會套用。沒有附券、而素材含 `{{coupon.url}}` 時也回 400（`MATERIAL_NEEDS_COUPON`）：一般廣播不會代入，顧客會看到原字。只在建立時檢查，已建立的群發發送時不擋。附上的券是固定效期且已過到期日時，建立回 400（`INVALID_COUPON`）；建立後才到期的附券廣播在發送時標為失敗（`failureCode` `COUPON_EXPIRED`），不建立券。固定效期到期後券的狀態仍是進行中，所有發券入口都以 `isCouponPastFixedEnd`（`@open333crm/core`）另外擋下。

**只能用能主動推送的渠道。** 群發、附券廣播與券詳情的批次發券只能用 LINE、Facebook（內部代號 `FB`）或 Instagram（內部代號 `THREADS`）渠道（`@open333crm/shared` 的 `PROACTIVE_PUSH_CHANNEL_TYPES`）。網站聊天室的外掛 `sendMessage()` 只寫 log 就回成功，訪客房間的推送只有收件匣回覆路徑會做，所以群發與發券送不到訪客。建立（含 MCP 與批次發券）與送出（`/send`）回 400 `CHANNEL_PUSH_NOT_SUPPORTED`。資料庫裡既有的網站聊天室群發，被排程或 `coupon-broadcast` job 執行時標為 `failed`，寫入 `failureReason`（附券廣播另寫 `failureCode`），不呼叫渠道、不發券。群發頁與券詳情「發送給…」的渠道選單只列這些渠道（`activePushChannels()`）。

| 動作 | 端點 | 權限 |
| --- | --- | --- |
| 建立 | `POST /marketing/broadcasts` | `marketing.manage`；帶 `scheduledAt` 另要 `marketing.broadcast`，帶 `couponId` 另要 `coupon.issue` |
| 立即發送 | `POST /marketing/broadcasts/:id/send` | `marketing.broadcast`；附券群發另要 `coupon.issue` |
| 取消 | `POST /marketing/broadcasts/:id/cancel` | `marketing.broadcast` |
| 預估人數 | `POST /marketing/broadcasts/audience-preview` | `marketing.view`；帶 `couponId` 另要 `coupon.view` |

缺少額外的權限時回 403，`error.details.requiredPermission` 是缺少的那個權限碼，訊息說明是排程或附券需要的權限。建立群發的表單在沒有 `marketing.broadcast` 時停用排程欄位、沒有 `coupon.issue` 時停用附券欄位，並說明原因。

預估人數用和發送相同的受眾解析與訊息視窗，回傳 `{ matched, reachable, messagingWindowHours }`，不建立群發。建立群發的表單選好渠道與受眾後顯示這兩個數字。排程群發在執行時重新計算，人數可能和建立時不同。

排程的群發由 `broadcast.scheduler.ts`（排程 id `broadcast-scheduled`）在 API 行程每 60 秒檢查一次，每次最多取 10 筆（`withoutOverlapping`，上一期沒結束時下一期不開始），時間到了就執行。排程器只以 `prismaAdmin` 跨租戶查到期清單（`id`、`tenantId`）與計算有效權限；每一則交給與 `coupon-broadcast` 佇列 job 相同的執行函式（`createBroadcastJobRunner()`），發送以 `app_tenant` 連線綁定廣播的租戶執行（附券廣播每一步一個 `inTenant()`，一般群發用 `tenantScopedClient()`，每個查詢各自 `withTenant()`）。送出前以「排定送出的成員」當下的有效權限（角色權限 ∩ 方案天花板）重新檢查：`broadcasts.scheduledById` 記錄這個人，建立排程時是建立者，「立即發送」（附券與一般群發）與券詳情批次發券是按下的人；舊資料為 null 時看建立者。一般群發要 `marketing.broadcast`，群發頁的附券群發要 `marketing.broadcast` 與 `coupon.issue`，批次發券只要 `coupon.issue`。成員已不存在、已停用，或少了需要的權限時不送出，群發標為 `failed`，`failureCode` 為 `SCHEDULED_SENDER_NOT_FOUND`、`SCHEDULED_SENDER_INACTIVE` 或 `SCHEDULED_SENDER_FORBIDDEN`，`failureReason` 寫明成員與缺少的權限，列表看得到；有權限的成員可以按「重新發送」。檢查在 `broadcast-send-authority.ts`。權限檢查之前先檢查租戶：租戶停用（含試用到期）時不送出，群發標為 `failed`，`failureCode` 為 `TENANT_DISABLED`，不保留 `scheduled`，避免重新啟用後突然送出過期內容；`coupon-broadcast` 佇列 job（附券與一般群發）也檢查（`broadcast-tenant-active.ts`）。`apps/workers` 啟動時會清掉 `broadcast` queue 裡的舊重複工作，避免兩個行程重複發送。

### 發送時做什麼

`executeBroadcast()` 依序執行：

1. 把狀態改成 `sending`（背景發送只搶 `scheduled` 且排程時間已到的群發，搶不到就不做事）。讀群發時同時比對 `id` 與 `tenantId`。
2. 取出素材內容。素材內的外部連結換成帶素材 ID 的短連結，讓點擊能歸因到素材；轉換失敗就用原內容。只處理 LINE 的 `uri`，FB 的 `web_url` 按鈕與圖片不轉換，所以 FB 素材沒有點擊歸因（HC-MARKETING-30）。
3. 解析發送對象，見下表。
4. 對象是零人時，把群發標為 `failed` 並回傳錯誤，不會顯示為完成。
   渠道有訊息視窗時，略過視窗外的人，見下方「訊息視窗」。
5. 查訊息額度只依外掛的能力，不依 `channelType` 分支：渠道外掛有 `extensions.analytics.getMessageQuota`（目前只有 LINE）時，剩餘額度小於要送的人數就整則不送，群發標為 `failed`、`failureCode` 為 `LINE_QUOTA_INSUFFICIENT`；查不到額度時為 `LINE_QUOTA_CHECK_FAILED`。與附券廣播共用 `broadcast-quota.ts`。
6. 送出，並逐一寫入收件紀錄（`BroadcastRecipient`）。送不出的人 `deliveryStatus = failed`、`skipReason = DELIVERY_FAILED`（multicast 整批失敗時整批共用）；重新發送時依這次的結果更新既有紀錄。
7. 更新成功與失敗數。全部失敗時狀態為 `failed`；至少一人成功時為 `completed`，包含部分失敗。失敗時 `failureCode` 為錯誤代碼（非預期錯誤為 `UNEXPECTED_ERROR`），`failureReason` 為中文原因。

行銷頁每一則已發送、發送中或失敗的群發都有結果按鈕（附券是「發券結果」，一般群發是「發送結果」），列出成功、失敗、略過人數與失敗、跳過的收件人和原因（`GET /marketing/broadcasts/:id/recipients`）。

| 發送對象 | 怎麼找人 |
| --- | --- |
| `all` | 在這個渠道有身分的所有聯絡人 |
| `segment` | 分群條件算出的聯絡人，且在這個渠道有身分 |
| `tags` | 貼了任一指定標籤的聯絡人，且在這個渠道有身分 |
| `contacts` | 手動挑選的聯絡人，且在這個渠道有身分 |

所有發送對象都排除已封存的聯絡人。聯絡人的 `isBlocked` 不影響發送，見 `../../system/AUDIT.md` 的 DB-04。

**兩種送法。** LINE 渠道而且素材沒有變數時，用 LINE 的 multicast 一次送給一批人，每批上限在 `executeBroadcast()` 的 `MULTICAST_CHUNK`（499）。一批失敗只影響那一批。其他情況（Facebook，或素材含變數需要逐人代入）逐人送出。

**訊息視窗。** Meta 的 message tag 與 OTN 已停用，不能用來繞過視窗。渠道 plugin 宣告 `messagingWindowHours` 時，群發只送給發送當下往前這段時間內，在這個渠道傳過訊息給我們的人（顧客傳入的訊息，含按鈕回應）。FB 與 IG（`THREADS`）是 24 小時，因為 Meta 只允許對 24 小時內互動過的人發一般訊息，送給其他人會被擋下，大量被擋可能讓粉專被限制發訊。略過的人不送出、不寫收件紀錄，人數記在 `skippedCount`，列表顯示「略過 N」；`totalCount` 仍是符合條件的人數。全部被略過時群發標為 `failed`（`BROADCAST_OUTSIDE_MESSAGING_WINDOW`）。FB 與 IG 群發的受眾只有「24 小時內傳過訊息的人」一個選項，表單不提供分群與標籤（API 仍接受）。建立群發的表單在有視窗的渠道顯示發送注意事項，FB 群發按「立即發送」時確認視窗也會提醒。要發給視窗外的人只能用 Meta 付費的 Marketing Messages（按送達則數計費），本系統沒有支援。只按表情回應、或點 m.me 連結但沒有傳訊息的人沒有存成訊息，會被略過。LINE 沒有訊息視窗。

**在背景執行。** 立即發送（附券與一般群發）與券詳情頁的批次發券：API 把群發設為 `scheduled`、排程時間為現在，回 202 `{ id, status: 'scheduled', scheduledAt }`，同一個交易在 outbox 寫一個 `coupon-broadcast` job，commit 後 API 行程馬上執行（`runQueuedBroadcast()` 依有沒有附券分派到 `runCouponBroadcast()` 或 `runPlainBroadcast()`）。發送的結果寫在群發的狀態、`failureCode`、`failureReason` 與收件紀錄，不在 HTTP 回應裡。每分鐘的排程是後備，job 沒有執行時，時間到的群發照樣發送。MCP 工具 `crm_line_broadcast_initiate` 例外，仍在請求內同步呼叫 `executeBroadcast()`。job 與排程以條件更新搶占，只有一個發送。廣播列表與券詳情的發放紀錄在有發送中、或排程時間已到的廣播時每 5 秒重新載入，完成或失敗後停止。

**同一筆群發只執行一次。** 立即發送只接受 `draft`、`scheduled` 或 `failed` 的群發；佇列 job 與排程器以條件更新把 `scheduled` 且時間已到的群發改成 `sending`，只有搶到的會發送，發送失敗後 job 重試搶不到，不會重送。狀態已經是 `sending` 時，再送出回 409 `BROADCAST_ALREADY_SENDING`。因此連按兩次，或 job 與排程器同時執行，都只會送一次。狀態是 `failed` 的群發可以重試，行銷頁的失敗群發有「重新發送」按鈕。逐人送出的群發重試時會對全部對象重新發送，送出途中失敗的群發會讓已送達的人再收到一次，見 `../../system/AUDIT.md` 的 MKT-01。附券群發與批次發券則是「保留 → 送出 → 確認或作廢」，保留與佇列工作（`enqueueJob`）在同一個交易寫入，所以不會超發。

## 成效與歸因

群發本身記錄總數、成功數、失敗數與略過數。回覆與開工單的歸因由 `broadcast.tracking.ts` 處理：

- **回覆**：客人傳訊息進來時，進站管線呼叫 `trackBroadcastReply()`，把該聯絡人最近一筆、還沒標記回覆的收件紀錄標成已回覆。
- **開工單**：建立工單時呼叫 `trackBroadcastCase()`，把工單歸因到該聯絡人最近一筆收件紀錄。

兩者都只看群發送出後的一段時間內，時間窗是 `broadcast.tracking.ts` 的 `TRACKING_WINDOW_HOURS`。

行銷活動的成效由 `campaign.service.ts` 在讀取時彙總底下所有群發與收件紀錄，不另外儲存。活動的狀態與起訖日期由使用者手動設定，系統不會依日期自動切換狀態。建立與修改時，結束日不可早於開始日（同一天可以），修改只改其中一個時以另一個既有值比對；不符時回 400 並指出 `endDate`。只改狀態或名稱時不檢查，所以資料庫裡既有的起訖相反活動仍能啟動、完成或取消。

點擊成效來自短連結，見[短連結](./SHORTLINKS.md)。

## 權限

`marketing.routes.ts` 與 `material.routes.ts` 都在整個 plugin 掛了 `marketing.view`。其餘權限：

| 動作 | 權限 |
| --- | --- |
| 讀取活動、群發、分群、素材 | `marketing.view` |
| 建立、修改、刪除活動、分群、素材與分類；建立群發 | `marketing.manage` |
| 送出與取消群發；建立帶排程時間的群發 | `marketing.broadcast` |
| 建立或立即發送附券群發（另外要） | `coupon.issue` |
| 預估附券群發的人數（另外要） | `coupon.view` |

`GET /marketing/templates` 在同一個 plugin 內，因此收件匣插入範本也需要 `marketing.view`。沒有這個權限的客服在收件匣載入不到範本。

新增權限碼之後，既有租戶的系統角色不會自動拿到；部署時要執行 `scripts/grant-new-role-permissions.mjs`。

行銷與優惠券的操作都不寫租戶稽核（HC-MARKETING-14）。

群發的渠道必須在成員的可見範圍內：群發列表只列可見渠道的群發；以 ID 讀取、查看收件人、送出或取消不可見渠道的群發回 404；建立群發與預估受眾時指定不可見的渠道也回 404。分群的人數（預覽、列表、單筆、建立與修改的回應）只算成員看得到的聯絡人；以渠道類型為條件時只比對可見渠道的身分。送出分群群發（立即、排程、附券廣播）時，分群條件依群發**建立者**的可見範圍判斷：總店建立的以所有渠道判斷，分店建立的只以建立者看得到的渠道判斷，不依按下送出的人；預估人數與券詳情頁的批次發放依操作的人。行銷活動：非總店成員看得到自己建立的活動、還沒有任何群發的活動（例如總店規劃、讓各分店加入群發的活動），以及至少有一則可見渠道群發的活動，其他活動不列出，以 ID 讀取、修改、刪除回 404；群發數、群發清單與成效只計可見渠道的群發。修改、刪除活動，或建立群發時指定活動，活動還有其他分店渠道的群發時回 403 `CAMPAIGN_HAS_OTHER_CHANNELS`，由總店處理。修改與刪除把這個條件寫在 `updateMany`／`deleteMany` 的 where，檢查與寫入在同一個語句；建立群發時的檢查與新增仍是兩個查詢。MCP 的群發工具用同一個判斷。群發不檢查渠道存取層級：唯讀渠道的成員只要有 `marketing.broadcast` 就能送出（#217）。主規格 `channel-scoped-visibility` 的「群發只能使用可見渠道」。

資料庫裡分群的 `contactCount` 仍是儲存當下的全租戶人數；非總店成員讀取時依可見範圍重新計算（每個分群一次 count 查詢，逐筆執行）。舊資料 `rules` 為空的分群算 0 人。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **群發失敗後重試，逐人送出的群發會重送給已送達的人** | 詳見 `../../system/AUDIT.md` 的 MKT-01 |
| 一般群發停在 `sending` 不能重送 | 群發在背景執行，請求不會逾時；但行程在送出途中結束時，一般群發的狀態停在 `sending`（沒有逐人進度，不能判斷誰已送達），這筆群發只能用 API 取消，不能重送 |
| 分群的人數不會自動更新 | `contactCount` 只在建立與修改時計算 |
| `isBlocked` 不影響發送 | 詳見 `../../system/AUDIT.md` 的 DB-04 |

## 優惠券

優惠券（`Coupon`）是券的設定；發給一位顧客的一張券是 `CouponInstance`。

**券的欄位值**（`schema.prisma` 的列舉）：

| 欄位 | 值 |
| --- | --- |
| `couponType` | `DISCOUNT_AMOUNT`、`DISCOUNT_PERCENT`、`GIFT`、`EXCHANGE` |
| `purpose` | `MARKETING`（行銷發放）、`SERVICE`（客服補償） |
| `validityMode` | `FIXED`（固定期間，`startAt`、`endAt` 是 `YYYY-MM-DD`）、`AFTER_CLAIM`、`AFTER_OPEN` |
| `codeMode` | `SHARED_CODE`、`UNIQUE_CODE`、`IMPORTED_CODES` |
| `redeemMode` | `STAFF_CODE`（店員輸入 4～6 位數字的驗證碼）、`STAFF_SCAN`（店員掃碼）、`SELF`（顧客自助） |
| 券的狀態 | `DRAFT`、`ACTIVE`、`PAUSED`、`ENDED` |
| 單張券的狀態 | `ISSUED` → `CLAIMED` → `OPENED` → `REDEEMED`，另有 `EXPIRED`、`REVOKED` |

**狀態操作。** `POST /coupons/:id/{publish,pause,resume,end}` 經 `coupon-lifecycle.service.ts` 的 `changeStatus()`。只有草稿可以刪除（`DELETE /coupons/:id`）。發布之後，前端只送 `EDITABLE_AFTER_PUBLISH`（`apps/web/src/components/coupons/form/form-model.ts`）裡有改的欄位；改到鎖定的欄位回 409 `COUPON_LOCKED`。已發布的序號包券沒有追加序號的畫面；序號用完之後一旦暫停，恢復時重跑發布檢查，被「須先匯入可用序號」擋下（HC-MARKETING-28）。

**到期。** 系統不把券寫成 `EXPIRED`：序號明細的「已過期」篩選永遠 0 筆，過期的券顯示「已領取」，成效的過期數永遠 0（HC-MARKETING-27）。發券入口以 `isCouponPastFixedEnd`（`@open333crm/core`）另外擋下固定效期已過的券。

**發券的入口：**

| 入口 | 程式 | 要知道的事 |
| --- | --- | --- |
| 附券群發 | 見[群發](#群發) | |
| 券詳情的批次發送 | `POST /coupons/:id/batch-issue/preview`、`POST /coupons/:id/batch-issue`（回 202，寫 `coupon-broadcast` 佇列） | 對象是聯絡人、標籤或分群。需要 `coupon.issue`，渠道層級至少 `reply_only`。網站聊天室回 400 `CHANNEL_PUSH_NOT_SUPPORTED`，不建立廣播 |
| 領券連結 | `POST /coupons/:id/claim-links`（回應帶 QR 的 data URI）、`/enable`、`/disable`、`/qrcode` | 渠道是 LINE、FB 或 Instagram。顧客開 `/coupon/claim/[code]`（`GET /coupon-claim/:code`），再在渠道傳送代碼 |
| 傳訊領券 | `inbound-coupon-claim.ts` | 在 AI、關鍵字與自動化之前執行。訊息含本租戶的領券代碼時發券並回覆，這則訊息不再觸發 AI 與關鍵字規則。失敗原因 `LINK_UNAVAILABLE`、`ALREADY_CLAIMED`、`SOLD_OUT`、`WRONG_CHANNEL`、`ISSUE_FAILED`、`DELIVERY_FAILED` 都會回覆顧客。連結還沒開始時只寫「這個領券活動目前無法領取」，不說何時開始（HC-MARKETING-25） |
| 對話發券 | `POST /coupon-issue/conversations/:conversationId`，body `{ couponId, requestKey, expectedAssigneeId }` | 收件匣 `ChatWindow` 的「發券」。網路逾時之後以 `GET /coupon-issue/requests/:requestKey` 查結果 |
| 關鍵字領券、加好友禮 | 自動化動作 `issue_coupon` → workers 的 `rule-coupon-issue.ts` | 在 `/dashboard/line/keyword-replies`、`/dashboard/line/follow-gift` 設定，依渠道分別設定。程式在發送中途結束時，券停在發送中，由 API 的 `coupon-stale-pending-issue` 排程在 5 分鐘後作廢 |
| `POST /coupons/:id/issue` | `coupon.routes.ts` | 只給 CLI 與整合呼叫，刻意沒有畫面 |

**序號明細與匯出。** `GET /coupons/:id/instances` 的「已領取」篩選（`CLAIMED`）同時包含 `OPENED`，所以沒有獨立的「已開啟」選項。`GET /coupons/:id/instances/export` 在筆數超過 `EXPORT_SYNC_LIMIT` 時回 202，在背景產生檔案，完成後通知。匯出不套用畫面的篩選，一律匯出全部；狀態與發放來源是英文代碼，時間是 UTC（HC-MARKETING-16）。CSV 的每一欄經過 `@open333crm/shared` 的 `csvRow()` 跳脫。

**顧客端。**

- 開票券：`/coupon/open/[token]`。LINE 裡走 `/liff/redirect`，以 `POST /fan/coupons/liff-session` 驗 LINE ID token；其他情況以 `POST /fan/coupons/session` 開啟。顧客還沒驗證身分時，回 `verification_required` 與登記頁網址 `/bind/{email 或 phone}/{登記 token}?next=/coupon/open/{token}`，顧客在登記頁完成 email 或手機登記與歸戶後回到票券連結（見[聯絡人與標籤](./CONTACTS.md#email-登記)）。已歸戶、但裝置沒驗證過時，要 email 驗證碼（`/session/code`、`/session/code/verify`）。同一個票券連結 10 分鐘內最多寄 3 次驗證碼。
- 券夾與核銷：`/coupon/wallet`、`/coupon/wallet/[id]`，呼叫 `/fan/coupons/:id/{open,redeem,start,redeem-code,qrcode}`。店員驗證碼的核銷時段是 5 分鐘，一個時段最多輸入錯 5 次；同一張券 24 小時內最多錯 10 次（`coupon-staff-code-session.ts`）。券夾的「剩幾天」以毫秒差無條件進位，2 天後到期會顯示「餘 3 天」（HC-MARKETING-29）。
- 門市核銷台：`/redeem?store=`，門市帳號登入後呼叫 `/store-console/{login,lookup,redeem,today}`。只能核銷 `STAFF_SCAN` 的券；`STAFF_CODE` 與 `SELF` 的券查詢結果是 `WRONG_MODE`「需在顧客手機上核銷」。本機以 http 開啟時沒有相機，改用「手動核銷」分頁輸入序號。

**聯絡人合併。** 合併聯絡人時，`BroadcastRecipient` 與 `CouponInstance` 搬到主聯絡人（聯絡人領域的 `mergeContacts`）。新增掛在 Contact 上的行銷資料表時，要一起加進合併的清單。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| `/dashboard/marketing/campaigns` 的「新增活動」 | `POST /marketing/campaigns` | 日期欄位是 `type=date`，送 `YYYY-MM-DD` |
| 活動詳情 `campaigns/[campaignId]` 的狀態 | `PATCH /marketing/campaigns/:id`，body `{ status }` | 只允許 `draft` → `active`、`cancelled`，`active` → `completed`、`cancelled`。錯誤訊息是英文（HC-MARKETING-20）。詳情頁另外輪詢群發清單，但畫面不使用結果（HC-MARKETING-19） |
| `/dashboard/marketing/segments` 的新增分群 | `POST /marketing/segments/preview`、`POST /marketing/segments` | 條件有渠道類型、標籤與建立日期，以 AND 或 OR 連接。渠道選項有 WhatsApp（沒有外掛）、沒有 Instagram（HC-MARKETING-21） |
| `/dashboard/marketing/broadcasts` 的「建立廣播」 | 即時預估 `POST /marketing/broadcasts/audience-preview`；建立 `POST /marketing/broadcasts` | 受眾是全部、分群或標籤；FB 與 IG 只有「24 小時內傳過訊息的人」。排程欄位是 `datetime-local`，轉成 ISO 送出。素材選單請求 200 筆，後端上限 100；分群下拉只拿第一頁 50 筆（HC-MARKETING-10）。分群下拉顯示建立當下的全租戶人數，不是所選渠道的人數（HC-MARKETING-24） |
| 群發列的圖示按鈕：立即發送、重新發送、取消、查看結果 | `POST /marketing/broadcasts/:id/send`、`POST /marketing/broadcasts/:id/cancel`；`GET /marketing/broadcasts/:id`、`GET /marketing/broadcasts/:id/recipients?status=failed` 或 `skipped` | 一般群發停在 `sending` 時，畫面沒有取消或重送的按鈕；API 的 `/cancel` 可以取消（HC-MARKETING-08） |
| `/dashboard/marketing/materials` 的列表、複製、刪除 | `GET /marketing/materials`（limit 50，沒有分頁）、`POST /marketing/materials/:id/duplicate`、`DELETE /marketing/materials/:id` | 刪除是軟刪除（`isActive: false`）。複製、刪除失敗時畫面沒有提示（HC-MARKETING-07）。LINE 素材建立或修改時，租戶最新的啟用中 LINE 渠道憑證解不開會回 500（HC-MARKETING-12） |
| 素材庫左側的分類樹 | `POST`、`PATCH`、`DELETE /marketing/materials/categories` | 刪除分類時，素材的 `categoryId` 設成 null |
| `/materials/new` 選版型 → `MaterialEditor`；`/materials/[id]` 編輯 | `POST /marketing/materials`、`PATCH /marketing/materials/:id` | 每次儲存寫一個 `MaterialVersion`，並登記 `MATERIAL` 標籤。素材的 uri 動作沒有協定檢查（HC-MARKETING-26） |
| 按鈕動作編輯器的點擊貼標 | postback `data='tag:<標籤 ID>'`；uri 的 `action.tagOnClick` | 發送之後才生效：postback 由 `inbound-postback-interceptors.ts` 處理，uri 由短連結處理 |
| Flex 編輯器 | `POST /marketing/materials/line-flex/ai-generate`、`POST /marketing/materials/line-flex/validate` | 兩種 Flex 版型在版型選擇器隱藏，畫面建不出新的 Flex 素材（HC-MARKETING-15） |
| `/materials/[id]` 的成效與版本 | `GET /marketing/materials/:id/stats`、`GET /marketing/materials/:id/versions`、`POST /marketing/materials/:id/versions/:versionNo/restore` | 還原產生一個新版本。`versionNo` 不合法時回 400，但回應缺 `success: false`（HC-MARKETING-17） |
| `/dashboard/marketing/coupons`（`?q&status&page`）與「⋯」選單 | `GET /coupons`；`POST /coupons/:id/{pause,resume,end,duplicate}`、`DELETE /coupons/:id` | 沒有 `coupon.manage` 時，操作停用並提示「需主管權限」 |
| `/coupons/new`、`/coupons/[id]/edit` | `POST /coupons`、`PATCH /coupons/:id`、`POST /coupons/:id/publish`；`GET /coupons/shared-code/check`；`POST /coupons/:id/codes/preview`、`POST /coupons/:id/codes` | |
| `/coupons/[id]`（`?tab=codes`、`settings`、`claim-links`） | `GET /coupons/:id/stats`、`GET /coupons/:id/instances`、`GET /coupons/:id/instances/export` | 見[優惠券](#優惠券) |
| 券詳情的「發送給…」 | `POST /coupons/:id/batch-issue/preview`、`POST /coupons/:id/batch-issue` | 渠道只列 LINE、FB、Instagram（`activePushChannels()`） |
| 「領券連結」分頁 | `POST /coupons/:id/claim-links` 等 | 期間欄位是 `datetime-local` |
| 收件匣 `ChatWindow` 的「發券」 | `POST /coupon-issue/conversations/:conversationId` | |

行銷活動、分群、群發與素材頁：

- 建立、發送與刪除按鈕不依權限隱藏，按下才 403（HC-MARKETING-05）。群發表單例外：沒有 `marketing.broadcast` 時停用排程欄位，沒有 `coupon.issue` 時停用附券欄位。
- 讀取失敗（含 403）時，頁面顯示成「尚無…」（HC-MARKETING-06）。

下列 API 沒有畫面入口：

- 分群的編輯與詳情。
- 修改活動的名稱與日期。
- 取消 `sending` 中的群發。
- 素材的復原（`isActive: true`）、`line-flex/import`、`/:id/preview`。
- 修改領券連結（`PATCH /coupons/:id/claim-links/:linkId`）、移除序號（`DELETE /coupons/:id/codes/:code`）。
- 會員綁定（`/member-binding`、`/fan/member-binding`），web 完全沒有呼叫（HC-MARKETING-13）。
- 後台核銷 `POST /coupons/redeem`，所以 `coupon.redeem` 在畫面上沒有作用（HC-MARKETING-18）。
- `POST /coupons/:id/issue`，刻意只給 CLI 與整合。

素材的版型：

- LINE：`line_text`、`line_image`、`line_video`、`line_carousel`、`line_imagemap`。
- FB：`fb_text`、`fb_image`、`fb_video`、`fb_generic`、`fb_button`、`fb_coupon`、`fb_receipt`、`fb_feedback`。
- 在選擇器隱藏：`line_flex_showcase`、`line_flex_template`、`fb_media`。

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
