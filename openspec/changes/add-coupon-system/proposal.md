## Why

商家要在對話渠道發優惠券並追蹤成效，目前系統完全沒有券的概念（schema 無任何 coupon/voucher 表，`fb_coupon` 只是訊息版型）。

LINE 官方帳號內建的優惠券雖然能發，但**拿不回資料**。查證 LINE Messaging API 官方文件（`messaging-api/send-coupons-to-users`）確認現況：

| 端點 | 能做什麼 |
|---|---|
| `POST /v2/bot/coupon` | 建立券（含抽獎機率、折扣/現金回饋） |
| `PUT /v2/bot/coupon/{id}/close` | 停用券 |
| `GET /v2/bot/coupon` | 券清單 |
| `GET /v2/bot/coupon/{id}` | 券的**設定內容** |
| — | **沒有任何端點能取得領取者或核銷名單** |

官方文件明載成效「只能在 LINE 官方帳號管理後台查看」。因此無法歸戶到 CRM 會員、無法領券後自動貼標分眾、無法把核銷事件接進自動化。

此外 LINE 原生券**發布後不能修改**（只能停用重建），且**只有 LINE**，FB／IG 沒有對應物。

**差異化定位**：競品（漸強 MAAC、Omnichat、Super 8、BotBonnie）均未將「客服對話中發券」作為主打。這是 open333「會做生意的客服系統」定位下最有辨識度的切入點——座席在 1 對 1 對話中直接發補償券、挽留券，且券直接歸戶該聯絡人。

## What Changes

### 架構決策：LINE LIFF 為主場，FB／IG 導流回 LINE

券只活在 LINE：**券的內容全部呈現在票券頁**（券夾、券詳情、核銷；第二階段為 LIFF 頁），身分用 LIFF `id_token`（平台簽發，可信度最高）。對話中送出的只是一則帶 LIFF 連結的訊息，**不需要為券做專屬的 Flex 版型**。FB／IG 以卡片加 `web_url` 按鈕連到帶 `liff.state` 的網址，使用者點擊即跳轉 LINE 開券。

此決策的效果：
- **不需要**跨渠道歸戶（券只有一個渠道，沒有券夾要合併）
- **不需要**為 FB／IG 另做簽章連結換 token（那會有「連結被轉發＝身分被轉移」的安全取捨）
- LIFF 連結可設定為先引導加好友再進入，**把發券變成獲客誘因**

同專案的 aitago（大同）採相同架構，其 `LiffGatewayController`（統一 LIFF 入口、處理 `liff.state`）與票券模型（`Coupon`／`CouponCode`／`UserCouponCode`）可作為實作參照。

⚠️ **LIFF 分兩階段落地**（見 design D11）：LIFF app 須建立在 **LINE Login channel** 之下，客戶告知短期內無法取得。因此**第一階段票券頁是一般網頁**，身分改用 **Account Link**（僅需 Messaging API channel，LINE 平台親自驗證開啟連結者身分，且既有程式已有 `issueAccountLinkToken()` 與 `accountLink` webhook 解析）；待 Login channel 到位再切換 LIFF。**票券頁與資料結構兩階段共用，僅認證入口不同**，非打掉重做。

### 功能範圍

- **券主檔**：券型（元折抵／%折／贈品／兌換）、用途分類（行銷／客服補償）、效期三模式（固定起訖／領取後 N 天／開啟後 N 分鐘）、序號三式（共用碼／一人一碼／序號包），券碼可由**系統產生**或**管理者自行輸入／上傳**、發行控制（總量、每人上限）
- **發券**：客服對話中發券（`push`）、關鍵字與加好友觸發（`reply`，免費）、分眾群發（`multicast`）
- **券夾**：券夾、券詳情、核銷確認，含未生效不露碼
- **使用條款**：支援有限的 HTML 標記（斷行、連結、粗體、清單），於顧客端安全呈現
- **核銷**：核銷方式由商家於券層級選擇（店員驗證碼／店員掃碼／顧客自助），DB transaction 搶狀態防重複
- **會員綁定**：綁定頁 + 設定驅動的對外 API 介面（對接客戶會員系統）
- **成效**：發送／領取／開封／核銷／核銷率五指標，領取名單可匯出

### 明確不做

- **跨渠道券夾統一**：LINE 主場架構下 Phase 1 不需要。系統雖有 `IdentityMap`／`MergeSuggestion` 表，但實查 UAT 為 0 筆、三個寫入歸戶函式無呼叫端——歸戶屬獨立議題，且影響整個 CRM 的會員識別，不應埋在本 change。
- **對接特定客戶的會員 API**：屬客製規格。本 change 只做設定驅動的介面。
- **一維條碼**（CODE_128／EAN）：僅在 POS 掃描有需求時才做；自家核銷台掃 QR 已足夠。
- **抽獎模式**（中獎機率／名額）：非本次需求範圍。LINE 原生 API 雖已內建，本系統暫不實作。
- **互動遊戲**（轉盤／刮刮樂）、MGM 推薦券、POS／Partner API 核銷、點數換券：後續 change。
- **FB／IG 原生 coupon template**：改走導流，不使用。
- **LINE Flex 券卡版型**：券的內容在票券頁呈現，對話中只需帶連結的訊息，不做專屬版型。

## Capabilities

### New Capabilities
- `coupon-management`: 券主檔的建立、發行控制、效期與序號模式、發券方式與狀態流轉。
- `coupon-redemption`: 顧客端的領取、券夾呈現、核銷流程與防重複保證。
- `member-binding`: 平台身分驗證後將聯絡人綁定至商家會員，含設定驅動的對外 API 介面。

### Modified Capabilities
<!-- 無：既有的發送層、貼標、短網址、關鍵字、圖文選單皆直接沿用，行為不變。 -->

## Impact

- **資料模型**（`packages/database`）：新增 `Coupon`／`CouponInstance`／`CouponCode` 三表，含正式 migration 與 **RLS policy migration**（比照 `rls_agentic_llm`）。會員編號對應沿用既有 `ContactAttribute`（`key`/`value` + 唯一約束），**不新建表**。
- **API**（`apps/api`）：新增 `modules/coupon/`；`/api/v1/fan` 前綴下新增券夾端點；`POST /api/v1/fan/auth` 改為驗證真實身分——**第一階段走 Account Link、第二階段走 LIFF `id_token`**（**現況只憑 contactId 即發 24h token，券帶金錢價值後屬上線阻斷；兩階段皆須移除此路徑**）。
- **前端**（`apps/web`）：新增票券頁（券夾／券詳情／核銷確認，一般網頁與 LIFF 共用）與 LIFF Gateway（第二階段）；後台券管理頁、建立券表單、核銷台（mobile-first）；Inbox 對話發券面板。
- **RBAC**：新增券相關權限點（現有 57 個）。**部署後必須執行 `scripts/reconcile-system-role-permissions.mjs` 並清除權限快取**，否則既有租戶會 403。
- **CI**：新 route 須通過 `check-tenant-scoping.mjs` 與 `check-prisma-admin-usage.mjs`。
- **不受影響**：發送層（`push`／`reply`／`multicast`／`broadcast`／`narrowcast` 與 SafeReply 降級）、`tagging.service`、短網址、關鍵字回覆、Rich Menu 均直接沿用。
