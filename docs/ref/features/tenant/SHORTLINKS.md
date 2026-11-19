# 短連結

短連結把一個長網址包成 `/s/<代碼>`，在點擊時記錄是誰點的、從哪裡點的，再轉到目標網址。在 LINE 裡點擊時，系統能辨識出是哪個聯絡人，並依設定幫他貼標。群發素材裡的連結也會自動換成短連結，點擊因此能歸因到素材。

- **資料來源**：`apps/api/src/modules/shortlink/*`、`apps/api/src/modules/tag/tagging.service.ts`、`apps/web/src/app/dashboard/shortlinks/*`、`apps/web/src/components/shortlink/*`、`apps/web/src/hooks/useShortLinks.ts`、`apps/web/src/app/liff/redirect/page.tsx`
- **核對日期**：2026-11-19

## 負責的程式

| 部分 | 路由檔 | 前綴 | 使用者 |
| --- | --- | --- | --- |
| 後台 | `shortlink.routes.ts` | `/api/v1/shortlinks` | 客服與管理員 |
| 轉址與記錄點擊 | `shortlink-redirect.routes.ts` | `/s` | 任何點擊連結的人，不需登入 |

| 程式 | 負責什麼 |
| --- | --- |
| `shortlink.flow.ts` | 開交易，在 commit 之後推播、抓 OG 快照；點擊的事件與資料一起寫進 outbox |
| `shortlink.service.ts` | 短連結的 CRUD、組出帶 UTM 的目標網址、記錄點擊、統計 |
| `source-detector.ts` | 依 User-Agent 判斷點擊來源：爬蟲、LINE 內建瀏覽器、Facebook 內建瀏覽器、一般瀏覽器 |
| `strategies/` | 依來源決定回應什麼頁面 |
| `og-scraper.ts` | 抓目標網頁的 OG 標題、描述與圖片。會擋下指向內網位址的網址 |
| `og-snapshot.ts` | 建立短連結的交易 commit 之後，在背景呼叫 `og-scraper.ts`，再另開交易寫回短連結。寫回時，目標網址已經改成別的網址就不寫 |
| `qrcode.service.ts` | 產生短連結的 QR code |

兩個路由檔都在 `apps/api/src/index.ts` 註冊。

## 程式的入口

| 操作 | 路由 | flow 或 service 函式 |
| --- | --- | --- |
| 列表 | `GET /shortlinks?page&limit&q&isActive` | `listShortLinksFlow()` → `listShortLinks()` |
| 單筆 | `GET /shortlinks/:id` | `getShortLinkFlow()` |
| 建立 | `POST /shortlinks` | `createShortLinkFlow()` → `createShortLink()`；commit 之後 `og-snapshot.ts` 的 `snapshotOgInBackground()` |
| 修改 | `PATCH /shortlinks/:id` | `updateShortLinkFlow()` → `updateShortLink()` |
| 刪除 | `DELETE /shortlinks/:id` | `deleteShortLinkFlow()` → `deleteShortLink()` |
| 統計 | `GET /shortlinks/:id/stats` | `getClickStatsFlow()` → `getClickStats()` |
| 點擊明細 | `GET /shortlinks/:id/clicks` | `getClickLogsFlow()` → `getClickLogs()` |
| QR code | `GET /shortlinks/:id/qrcode` | `qrcode.service.ts` 的 `generateQrCode()` |
| 轉址 | `GET /s/:slug` | `getLinkForRedirect(app.prismaAdmin)` → `source-detector.ts` 的 `detectSource()` → `strategies/` 的 `getStrategy()` |
| 記錄點擊 | `POST /s/track` | `getLinkForRedirect(app.prismaAdmin)` → `trackClickFlow()` → `recordClick()` |
| 群發的素材短連結 | 沒有路由，由行銷模組呼叫 | `findOrCreateMaterialShortLink()` |

`/s/:slug` 與 `/s/track` 沒有登入身分，也沒有租戶。這兩個路由以 `app.prismaAdmin` 用 slug 找短連結，租戶邊界由 slug 全域唯一保證。改用 `app.prisma` 時，RLS 擋下所有查詢，所有連結都顯示「連結已失效」，點擊也記不到。本機 API 以 superuser 連線、不套 RLS，所以本機測不出這個問題，要跑 feature 測試或在 UAT 驗證。

## 建立短連結

| 欄位 | 作用 |
| --- | --- |
| `slug` | 短連結的代碼。不填就自動產生；自訂時全系統唯一 |
| `targetUrl` | 目標網址 |
| `utmSource` 等五個 UTM 欄位 | 轉址時附加到目標網址 |
| `lineChannelId` | 綁定的 LINE 渠道。綁定後，在 LINE 內點擊才能辨識聯絡人 |
| `tagOnClick` | 辨識出聯絡人時要貼的標籤 |
| `expiresAt`、`isActive` | 過期或停用的連結：`GET /s/:slug` 回 404 與失效頁，點擊紀錄 `POST /s/track` 回 410 |
| `materialId` | 這個短連結屬於哪個素材。群發時自動建立的短連結會填 |

後端的檢查（`shortlink.routes.ts`）：

- `targetUrl` 必填，只允許 http 或 https，最多 2048 字。轉址頁把它放進 `window.location.replace()` 與 `<noscript><a>`，所以不允許其他 scheme。
- `slug` 1～64 字，只能用英數字、`_` 與 `-`。
- 每個 UTM 欄位最多 100 字。`ogImage` 只允許 http 或 https。
- `lineChannelId` 必須是本租戶的 LINE 渠道。
- `tagOnClick` 只檢查最多 100 字，不檢查是不是 UUID、標籤存不存在、標籤的範圍（HC-SHORTLINKS-02）。
- `expiresAt` 用 `z.coerce.date()`，接受 `datetime-local` 送出的 `2026-12-31T23:59`。不帶時區的字串依伺服器時區解讀。

建立成功回 200，不是 201。

**建立時的錯誤一律回 400 與原始訊息。** `POST /shortlinks` 把所有例外包成 400 `BAD_REQUEST`，`message` 是例外的原文（HC-SHORTLINKS-03）。例如 `tagOnClick` 不是 UUID 時，畫面顯示一大段英文的 `Invalid prisma.shortLink.create() invocation`。

**代碼的唯一性跨租戶。** 自訂代碼時，系統只在自己租戶內檢查是否重複（查詢受 RLS 限制）。代碼被自己租戶用掉時，回 400「這個自訂代碼已經被使用了，請換一個」。代碼被其他租戶用掉時，檢查看不到，寫入時才撞到資料庫的唯一限制，同樣回 400 與 Prisma 的原始訊息（HC-SHORTLINKS-03）。

**OG 快照。** 建立短連結、或修改目標網址時，沒有手動填任何 OG 欄位，系統就在交易 commit 之後，於背景抓目標網頁的 OG 寫回短連結。回應不等待抓取。抓取或寫回失敗只記 warning，不重試；爬蟲的預覽頁改用短連結的標題。群發時自動建立的素材短連結也一樣。

**素材的短連結會重複使用。** 群發時，`findOrCreateMaterialShortLink()` 對同一個素材、同一個目標網址重複使用同一個短連結，所有收件人拿到的是同一條。改這段之前，先讀[行銷](./MARKETING.md)。

## 修改與刪除

`PATCH /shortlinks/:id` 的規則：

- 沒帶的欄位不動。選填文字欄位送空字串時清除。`expiresAt: null` 移除到期時間。
- `slug` 不能改。API 收到 `slug` 也忽略，照樣回 200（HC-SHORTLINKS-05）。
- 有帶 `targetUrl`、而且三個 OG 欄位都沒填時，commit 之後重抓 OG。
- `isActive: false` 停用連結。

`DELETE /shortlinks/:id` 是硬刪除。這個短連結的 `ClickLog` 一起刪除（外鍵 `onDelete: Cascade`）。刪除素材短連結之後，已經發出的訊息點開是失效頁。

## 點擊時發生什麼

轉址分成兩步：`GET /s/:slug` 只回應頁面，不記錄點擊；頁面上的程式再呼叫 `POST /s/track` 記錄點擊。`POST /s/track` 是唯一記錄點擊的地方。`POST /s/track` 的 body 是 `{ slug, cid?, lineUid? }`：`slug` 必須是字串；`cid` 與 `lineUid` 是字串、`null` 或省略；字串的長度上限都是 64。其他欄位忽略。格式錯誤時回 400，不記錄點擊。

`GET /s/:slug` 依點擊來源回應：

| 來源 | 回應 |
| --- | --- |
| 爬蟲 | OG 預覽頁，讓分享卡片顯示標題與圖片。不記錄點擊 |
| LINE 內建瀏覽器，且綁定的渠道設有 `liffId` | 一個小頁面：載入 GA 與 Meta Pixel 追蹤碼，然後立刻導向 LIFF 頁面。LIFF 取得點擊者的 LINE uid 後呼叫 `/s/track` |
| LINE 內建瀏覽器，但沒有 `liffId` | 與一般瀏覽器相同 |
| Facebook 內建瀏覽器、一般瀏覽器 | 一個小頁面：載入 GA 與 Meta Pixel 追蹤碼、送出 `/s/track`，然後立刻轉到目標網址 |

來源由 `source-detector.ts` 依 User-Agent 判斷。爬蟲（`BOT_UA_PATTERNS`）必須在 LINE 之前判斷，因為 LINE 的預覽爬蟲與 LINE 內建瀏覽器都帶 LINE 字樣。回應標頭 `X-Shortlink-Source` 寫出判斷結果。網址參數 `?ua_simulator=` 可以指定來源，只在非 production 環境、或設定 `SHORTLINK_UA_SIMULATOR=1` 時生效。網址帶的 `?cid=` 由小頁面送給 `/s/track`。

小頁面嵌入的值一律經 `strategies/render-utils.ts` 的 `jsonForScript()` 或 `escapeHtmlAttr()` 處理。追蹤碼的 ID 輸出前，再經 `tracking-snippet.ts` 檢查格式。

LIFF 頁（`apps/web/src/app/liff/redirect/page.tsx`）呼叫 `liff.getProfile()` 取得 LINE uid。`getProfile()` 失敗或逾時時，頁面照樣轉址，但 `/s/track` 不帶 LINE uid。LIFF 要有 profile 權限。

GA 與 Meta Pixel 的 ID 在「設定 → 追蹤設定」填寫，見[其他設定](./SETTINGS.md)。小頁面不等追蹤事件送出就轉址，目標網站回應得快時，GA 與 Meta 可能收不到事件。`/s/track` 用 sendBeacon 送出（`text/plain`），轉址後仍會送達。LIFF 頁用 fetch 送 JSON。`/s/track` 是相對路徑，要和小頁面同源。

`/s/track` 以 slug 找到連結之後，立即回傳目標網址。點擊在背景以一個交易寫入，交易綁定連結所屬的租戶（`trackClickFlow()`）。寫入失敗時只記 log，這次點擊不計入。寫入的步驟：

1. 找出點擊者：有 LINE uid 而且連結綁了渠道時，以該渠道身分（`ChannelIdentity`）的聯絡人為準；否則用網址帶的 `cid`。`cid` 不是 UUID、或不是連結所屬租戶的聯絡人時，這次點擊當成匿名點擊。
2. 寫入一筆 `ClickLog`，記下聯絡人、LINE uid、IP、User-Agent 與來源網址。
3. 總點擊數加一。不重複點擊數在有 LINE uid 時依 uid 去重；沒有 LINE uid 時，每次點擊都算一次不重複點擊。同一個 LINE uid 的點擊以 advisory lock 排隊：後到的點擊等前一筆 commit 之後才寫入與計數，並行點擊不會重複算成不重複點擊。
4. 辨識出聯絡人、而且連結設了 `tagOnClick` 時，替該聯絡人貼標，並發布 `contact.tagged`。貼標在 savepoint 內執行。貼標失敗（標籤被刪、標籤是工單範圍、標籤 ID 不存在）時只回滾貼標，記 warning `[ShortLink] auto-tag failed`，點擊照樣記錄。
5. 發布 `link.clicked`，自動化規則可以訂閱。自動化規則沒有「哪一條連結」的條件欄位（HC-AUTOMATION-08）。

`trackClickFlow()` 在背景執行，路由不等待。寫入失敗時，API log 記 `[ShortLink] Click tracking error`。事件一律以 `publishEvent()` 寫進 outbox，不直接呼叫 `eventBus`。

兩個事件與點擊一起寫進 outbox，commit 之後送出，至少一次。commit 之後推播 `link.stats.updated`，讓後台即時更新數字。

**`/s/track` 採信呼叫端提供的身分。** 這個端點不需要登入，也不驗證 LINE 的登入憑證；`cid` 與 LINE uid 都直接取自請求內容，而且沒有速率限制。知道某個聯絡人的 ID 或 LINE uid，就能替他記一筆點擊，觸發貼標與自動化；統計數字也能被任意灌高。貼標前會檢查聯絡人屬於連結的租戶，因此影響限於同一個租戶。見 `../../system/AUDIT.md` 的 SHORT-01。

## 統計

`GET /shortlinks/:id/stats` 回傳下列資料：

- 總點擊、不重複點擊：短連結上的累計欄位，從建立起算。
- 識別率：有聯絡人或 LINE uid 的點擊佔多少百分比。只算最近 30 天。
- 每日點擊：最近 30 天，以 UTC 日期分組。台灣時間 08:00 以前的點擊算在前一天（HC-SHORTLINKS-07）。
- 來源網址分布：最近 30 天，取點擊數最多的 10 個。沒有來源網址時記成 `direct`。

`GET /shortlinks/:id/clicks` 列出點擊明細。素材的點擊成效由素材的 `materialId` 彙總，見[行銷](./MARKETING.md#素材)。

## 權限

後台路由讀取要 `shortlink.view`（含統計、點擊明細與 QR code），建立、修改與刪除要 `shortlink.manage`。側欄的「短連結」也要求 `shortlink.view` 才顯示。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 列表：側欄「短連結 → 連結管理」`/dashboard/shortlinks/links` | `GET /shortlinks`，以 `fetchAllPages` 逐頁取回全部 | `/dashboard/shortlinks/[section]` 與 `links` 共用 `page.tsx`。收到 socket `link.stats.updated` 時重新載入。沒有 `shortlink.view` 的人直接開網址時，403 顯示成「尚無短連結」（HC-SHORTLINKS-04）。廣播自動建立的連結標示「素材連結（廣播自動建立）」 |
| 「建立連結」→ `/dashboard/shortlinks/links/new`（`LinkForm`） | `POST /shortlinks` | 只有目標 URL 必填。按鈕不依 `shortlink.manage` 隱藏，送出後才顯示權限不足（HC-SHORTLINKS-04） |
| 列表的「編輯」→ `/dashboard/shortlinks/links/[id]/edit`（`LinkForm`） | `GET /shortlinks/:id`；`PATCH /shortlinks/:id` | 代碼欄位停用。表單把現有的 OG 值（含自動抓到的）一起送回，所以改目標網址不會重抓 OG（HC-SHORTLINKS-01） |
| 列表的「刪除」 | `DELETE /shortlinks/:id` | 先以 `confirm` 確認。素材短連結另外警告「客人點開會看到連結已失效」 |
| 列表的「複製短網址」 | 沒有 API | 網址是 `window.location.origin` 加 `/s/<slug>`。本機的 `http://localhost:3000` 換成 `http://localhost`，要有本機的 edge proxy |
| 列表的「QR Code」（`QrCodeDialog`） | `GET /shortlinks/:id/qrcode` | QR code 的網址是 `API_BASE_URL/s/<slug>`。本機是 `localhost:3001`，與複製的網址不同；UAT 兩者相同 |
| 側欄「統計分析」`/dashboard/shortlinks/stats`（`ClickStatsView`） | `GET /shortlinks/:id/stats` | 見[統計](#統計) |

`LinkForm` 送出的值：

- 建立：空白的選填欄位不送。`lineChannelId` 一律送，沒選時是 `null`。`slug` 只在建立而且有填時送。
- 編輯：所有選填欄位都送，空的送 `""`。`expiresAt` 空的送 `null`。
- 到期時間：`datetime-local` 的值由 `apps/web/src/lib/datetime-local.ts` 的 `toIsoForApi()` 轉成 ISO 字串。例如台灣時間 `2026-12-31T23:59` 送出 `2026-12-31T15:59:00.000Z`。
- 「點擊時自動貼標」：選單列出 `GET /tags` 的全部標籤，包含工單範圍的標籤。選了工單標籤時，點擊時貼標一定失敗（HC-SHORTLINKS-02）。
- 錯誤：表單以 `getApiErrorMessage` 顯示訊息。驗證錯誤只顯示「輸入內容有誤，請檢查後重新送出」，不說是哪一欄（HC-SHORTLINKS-08）。

下列 API 沒有畫面入口：

- 點擊明細 `GET /shortlinks/:id/clicks`（含 IP 與 User-Agent）。
- 列表的 `q` 與 `isActive` 篩選。
- 停用開關 `isActive`（HC-SHORTLINKS-05）。手冊教使用者把到期時間設成過去。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **記錄點擊的端點採信呼叫端的身分，沒有速率限制** | 詳見 `../../system/AUDIT.md` 的 SHORT-01 |
| 自訂代碼的唯一性跨租戶 | 同租戶內的檢查看不到其他租戶的代碼，撞到時回 400 與 Prisma 的原始訊息（HC-SHORTLINKS-03） |
| 沒有 LINE uid 的點擊都算不重複點擊 | 一般瀏覽器的不重複點擊數等於總點擊數 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
