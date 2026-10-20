# 行銷

行銷是租戶主動對客人發訊息的地方。管理員先在素材庫準備內容，用分群或標籤挑出對象，建立一筆群發立即送出或排程送出；多筆群發可以歸在同一個行銷活動下一起看成效。

- **資料來源**：`apps/api/src/modules/marketing/*`、`apps/web/src/app/dashboard/marketing/*`
- **核對日期**：2026-10-13

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

## 素材

素材是可以重複使用的訊息內容。每個素材綁一個渠道類型（`channelType`）與一種內容類型（`contentType`）：

- `line_` 開頭的內容類型只能用在 LINE 素材，`fb_` 開頭的只能用在 Facebook 素材。
- LINE Flex Message 可以匯入 JSON、先驗證格式，也可以用 AI 從描述產生（`POST /materials/line-flex/ai-generate`，會使用租戶的 AI 額度）。

存檔時會檢查內容，不符合時回 400 並指出欄位：

- **LINE**：呼叫 LINE 的 `validate/push` API 檢查（沒有啟用中的 LINE 渠道時略過）。LINE 的錯誤由 `line-validate-error.ts` 整理：表單版型（純文字、圖片、影片、卡片、圖文）換成編輯器的欄位名稱與中文說明，對應不到的保留原文；Flex 版型是直接編輯 JSON，保留 LINE 的屬性路徑與原文。LINE 的原始回應放在錯誤的 `details.line`。卡片訊息的頁數加結尾頁超過 12 時，不呼叫 LINE 直接回 400（LINE 上限 12 個 bubble，發送時會截掉多的）。純文字的內容不是字串（例如 API 送數字）時也不呼叫 LINE 直接回 400，LINE 的檢核會接受數字。
- **FB**：FB 沒有檢核 API，由 `fb-material-validation.ts` 依版型檢查必填與長度、卡片與按鈕數量、按鈕類型、網址（只接受有網域的 `http(s)://` 與站內路徑 `/...`，擋下 `javascript:` 等）、金額與幣別、問卷類型與有效天數（1～7）、優惠券折扣碼（有填時不可含空白，與編輯器一致）。建立、修改內容與還原版本時都會檢查；只改名稱、分類或標籤時不檢查。

LINE 圖片的縮圖選填，沒填或空白時發送用主圖。

LINE 卡片訊息、圖文訊息與 Flex 的預覽文字（`altText`）顯示在聊天列表、手機通知與引用訊息。卡片訊息與圖文訊息沒填或空白時，分別用「多頁訊息」與「圖文訊息」；Flex 沒填時用「Flex Message」。

影片可以貼網址或直接上傳，上限依渠道：LINE 200 MB（LINE 影片訊息的上限），FB 25 MB（Messenger 附件的上限）。LINE 影片走直傳（`apps/web/src/lib/direct-upload.ts`），檔案從瀏覽器直接上傳到 MinIO/S3，不經過 API，上傳時顯示進度；FB 影片走一般上傳 `/files/upload`。超過上限的檔案在選檔時就擋下。

編輯器預設的示範圖是站內路徑 `/material-samples/...`，存檔不會被擋，但發送前要換成公開網址，否則客人看不到圖。

素材的其他功能：

| 功能 | 說明 |
| --- | --- |
| 分類 | 樹狀分類（`MaterialCategory`）。舊的字串分類 `Material.category` 過渡保留 |
| 標籤 | `MATERIAL` scope 的標籤，存成字串陣列，見[聯絡人與標籤](./CONTACTS.md#標籤) |
| 版本 | 每次修改保留一個版本（`MaterialVersion`），可以還原 |
| 變數 | 內容裡可以放變數，發送時代入聯絡人資料 |
| 成效 | `GET /materials/:id/stats`：使用次數與點擊 |
| 按鈕貼標 | 按鈕的 postback 為 `tag:<標籤 ID>` 時，客人點擊後被貼上該標籤 |

素材也用在自動化的「傳送素材」動作與關鍵字回覆，見[自動化](./AUTOMATION.md)。

`GET /marketing/templates` 是舊的訊息範本，保留給收件匣插入快速回覆用。範本管理介面已經下線。

## 分群

分群以條件組合挑出聯絡人，條件之間用 AND 或 OR 連接。支援的條件欄位在 `segment.service.ts` 的 `calculateSegmentContacts()`：

| 欄位 | 意思 |
| --- | --- |
| `tag` | 貼了指定標籤 |
| `channelType` | 在指定渠道類型有身分 |
| `createdAfter`、`createdBefore` | 聯絡人的建立時間 |

沒有任何條件時，分群等於租戶的全部聯絡人。已封存（包含被合併）的聯絡人一律排除。

`Segment.contactCount` 是建立或修改當下算出的人數，之後不會自動更新。實際發送時會重新計算。

## 群發

### 建立與發送

建立群發時要選一個渠道、一個素材與一種發送對象。帶了 `scheduledAt` 就建立為 `scheduled`，否則為 `draft`。`scheduledAt` 必須是晚於現在的時間，排到過去回 400：排程器取「時間已到」的群發執行，排到過去等於立即發送。表單的排程欄位也只能選一分鐘後以後的時間。這個檢查在 `createBroadcast()`，MCP 建立群發也會套用。

| 動作 | 端點 | 權限 |
| --- | --- | --- |
| 建立 | `POST /marketing/broadcasts` | `marketing.manage` |
| 立即發送 | `POST /marketing/broadcasts/:id/send` | `marketing.broadcast` |
| 取消 | `POST /marketing/broadcasts/:id/cancel` | `marketing.broadcast` |
| 預估人數 | `POST /marketing/broadcasts/audience-preview` | `marketing.view` |

預估人數用和發送相同的受眾解析與訊息視窗，回傳 `{ matched, reachable, messagingWindowHours }`，不建立群發。建立群發的表單選好渠道與受眾後顯示這兩個數字。排程群發在執行時重新計算，人數可能和建立時不同。

排程的群發由 `broadcast.scheduler.ts` 在 API 行程定期檢查，時間到了就執行。`apps/workers` 啟動時會清掉 `broadcast` queue 裡的舊重複工作，避免兩個行程重複發送。

### 發送時做什麼

`executeBroadcast()` 依序執行：

1. 把狀態改成 `sending`。
2. 取出素材內容。素材內的外部連結換成帶素材 ID 的短連結，讓點擊能歸因到素材；轉換失敗就用原內容。
3. 解析發送對象，見下表。
4. 對象是零人時，把群發標為 `failed` 並回傳錯誤，不會顯示為完成。
   渠道有訊息視窗時，略過視窗外的人，見下方「訊息視窗」。
5. 送出，並逐一寫入收件紀錄（`BroadcastRecipient`）。
6. 更新成功與失敗數。全部失敗時狀態為 `failed`；至少一人成功時為 `completed`，包含部分失敗。

| 發送對象 | 怎麼找人 |
| --- | --- |
| `all` | 在這個渠道有身分的所有聯絡人 |
| `segment` | 分群條件算出的聯絡人，且在這個渠道有身分 |
| `tags` | 貼了任一指定標籤的聯絡人，且在這個渠道有身分 |
| `contacts` | 手動挑選的聯絡人，且在這個渠道有身分 |

所有發送對象都排除已封存的聯絡人。聯絡人的 `isBlocked` 不影響發送，見 `../../system/AUDIT.md` 的 DB-04。

**兩種送法。** LINE 渠道而且素材沒有變數時，用 LINE 的 multicast 一次送給一批人，每批上限在 `executeBroadcast()` 的 `MULTICAST_CHUNK`。一批失敗只影響那一批。其他情況（Facebook，或素材含變數需要逐人代入）逐人送出。

**訊息視窗。** 渠道 plugin 宣告 `messagingWindowHours` 時，群發只送給發送當下往前這段時間內，在這個渠道傳過訊息給我們的人（顧客傳入的訊息，含按鈕回應）。FB 與 IG（`THREADS`）是 24 小時，因為 Meta 只允許對 24 小時內互動過的人發一般訊息，送給其他人會被擋下，大量被擋可能讓粉專被限制發訊。略過的人不送出、不寫收件紀錄，人數記在 `skippedCount`，列表顯示「略過 N」；`totalCount` 仍是符合條件的人數。全部被略過時群發標為 `failed`（`BROADCAST_OUTSIDE_MESSAGING_WINDOW`）。FB 與 IG 群發的受眾只有「24 小時內傳過訊息的人」一個選項，表單不提供分群與標籤（API 仍接受）。建立群發的表單在有視窗的渠道顯示發送注意事項，FB 群發按「立即發送」時確認視窗也會提醒。要發給視窗外的人只能用 Meta 付費的 Marketing Messages（按送達則數計費），本系統沒有支援。只按表情回應、或點 m.me 連結但沒有傳訊息的人沒有存成訊息，會被略過。LINE 沒有訊息視窗。

**在請求內同步執行。** 立即發送的 API 會等整筆群發送完才回應。

**同一筆群發只執行一次。** `executeBroadcast()` 以條件更新把狀態從 `draft`、`scheduled` 或 `failed` 改成 `sending`，只有搶到的請求會發送。狀態已經是 `sending` 時，再送出回 409 `BROADCAST_ALREADY_SENDING`。因此連按兩次，或請求與排程器同時執行，都只會送一次。狀態是 `failed` 的群發可以重試，行銷頁的失敗群發有「重新發送」按鈕。逐人送出的群發重試時會對全部對象重新發送，送出途中失敗的群發會讓已送達的人再收到一次，見 `../../system/AUDIT.md` 的 MKT-01。

## 成效與歸因

群發本身記錄總數、成功數、失敗數與略過數。回覆與開工單的歸因由 `broadcast.tracking.ts` 處理：

- **回覆**：客人傳訊息進來時，進站管線呼叫 `trackBroadcastReply()`，把該聯絡人最近一筆、還沒標記回覆的收件紀錄標成已回覆。
- **開工單**：建立工單時呼叫 `trackBroadcastCase()`，把工單歸因到該聯絡人最近一筆收件紀錄。

兩者都只看群發送出後的一段時間內，時間窗是 `broadcast.tracking.ts` 的 `TRACKING_WINDOW_HOURS`。

行銷活動的成效由 `campaign.service.ts` 在讀取時彙總底下所有群發與收件紀錄，不另外儲存。活動的狀態與起訖日期由使用者手動設定，系統不會依日期自動切換狀態。建立與修改時，結束日不可早於開始日（同一天可以），修改只改其中一個時以另一個既有值比對；不符時回 400 並指出 `endDate`。只改狀態或名稱時不檢查，修正前建立的起訖相反活動仍能啟動、完成或取消。

點擊成效來自短連結，見[短連結](./SHORTLINKS.md)。

## 權限

`marketing.routes.ts` 與 `material.routes.ts` 都在整個 plugin 掛了 `marketing.view`。其餘權限：

| 動作 | 權限 |
| --- | --- |
| 讀取活動、群發、分群、素材 | `marketing.view` |
| 建立、修改、刪除活動、分群、素材與分類；建立群發 | `marketing.manage` |
| 送出與取消群發 | `marketing.broadcast` |

`GET /marketing/templates` 在同一個 plugin 內，因此收件匣插入範本也需要 `marketing.view`。沒有這個權限的客服在收件匣載入不到範本。

群發選擇渠道時不套用渠道可見範圍，有 `marketing.broadcast` 的成員可以用租戶內任何渠道發送。這是刻意的設計：主規格 `channel-scoped-visibility` 的「存取層級」規定群發不受渠道存取層級限制（issue #217）。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **群發失敗後重試，逐人送出的群發會重送給已送達的人** | 詳見 `../../system/AUDIT.md` 的 MKT-01 |
| 群發在 API 請求內同步執行 | 逐人送出的大量群發可能讓請求逾時。行程在送出途中結束時，狀態停在 `sending`，這筆群發只能取消，不能重送 |
| 分群的人數不會自動更新 | `contactCount` 只在建立與修改時計算 |
| `isBlocked` 不影響發送 | 詳見 `../../system/AUDIT.md` 的 DB-04 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
