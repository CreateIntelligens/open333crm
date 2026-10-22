> **建議順序**：A1 → A2 → A3 → A4a → A7 → B1 → B2 打通「建券 → 對話發券 → 顧客點連結
> → 看券 → 核銷」完整閉環。券的內容都在票券頁（不在訊息裡），所以 A3（票券頁）與
> A4a（fan auth 驗證）是必要前置，不能延後。A5 會員綁定可與之並行。
>
> ⚠️ **票券頁的載體分兩階段**（design D11）：客戶短期內無法取得 LINE Login channel，
> 故 LIFF 不可用。**第一階段票券頁是一般網頁**，身分走 Account Link（A4a）；
> 待 Login channel 到位再改走 LIFF（A4b）。A3 的頁面本身兩階段共用，
> 僅認證入口與開啟環境不同。

## A1. 資料模型

- [x] 1.1 `Coupon` model：名稱、說明、**使用條款（支援有限 HTML）**、券面圖、券型（`discount_amount`/`discount_percent`/`gift`/`exchange`）、用途分類（`marketing`/`service`）
- [x] 1.2 `Coupon` 效期欄位：`validityMode`（`fixed`/`after_claim`/`after_open`）+ `startAt`/`endAt`/`afterClaimDays`/`afterOpenMinutes`
- [x] 1.3 `Coupon` 序號欄位：`codeMode`（`shared_code`/`unique_code`/`imported_codes`）+ `sharedCode`
- [x] 1.4 `Coupon` 發行控制：`totalLimit`、`perContactLimit`、`claimTagId`、`status`（`draft`/`active`/`paused`/`ended`）
- [x] 1.4a `Coupon` 核銷方式：`redeemMode`（`staff_code`/`staff_scan`/`self`，預設 `staff_code`）+ `staffCode`
- [x] 1.5 `CouponInstance` model：`couponId`/`contactId`/`code`/`status`/各時間戳/`issuedVia`/`issuedRefId`/`redeemedBy`/`redeemChannel`
- [x] 1.5a `CouponInstance` 領取憑證欄位：`claimToken`（唯一、可為 null）+ `claimTokenExpiresAt`（供 FB／IG 與公開領券的「待領取」券歸戶，見 design D10）
- [x] 1.6 `CouponCode` model（序號包庫存）：`couponId`/`code`/`status`/`instanceId`
- [x] 1.7 唯一約束：券碼在租戶內唯一；`CouponInstance` 依 `(couponId, contactId)` 配合每人上限查核
- [x] 1.8 產出正式 migration（**不可只用 db push**）
- [x] 1.9 **RLS policy migration**（三張新表，比照 `20260828091000_rls_agentic_llm`）
- [x] 1.10 `prisma generate` 並確認 `@open333crm/database` build 通過

## A2. 券 API 模組

- [x] 2.1 建立 `apps/api/src/modules/coupon/`（routes + service，比照既有 module 結構）
- [x] 2.2 券 CRUD：建立／更新／發布／暫停／結束；發布前驗證（序號包模式須有庫存、效期欄位齊備）
- [x] 2.2a **使用條款 HTML 消毒**：選定並引入成熟 sanitizer（**不可自行以正則實作**）；白名單允許斷行／段落／連結／粗體／清單；禁 script／style／iframe／event handler 屬性／`javascript:` 連結；**儲存時消毒一次**
- [x] 2.3 發券 API：檢查發行總量與每人上限 → 配發券碼（依三種 codeMode）→ 建立 `CouponInstance`
- [x] 2.3a 券碼產生器（`unique_code`）：可設前綴、避開易混淆字元（0/O、1/I/l）、租戶內唯一
- [x] 2.3b 序號匯入：支援**貼上文字**與**上傳檔案**兩種輸入；逐筆檢查格式、清單內重複、與既有券碼衝突
- [x] 2.3c 匯入結果回報：成功筆數、因重複略過、因衝突拒絕，各自列出
- [x] 2.3d 序號庫存追加：已發布的券可補充序號，不影響已配發者
- [x] 2.4 領取 API：狀態轉 `claimed`，依效期模式計算 `expiresAt` 落地
- [x] 2.4a **憑證換券 API**（`POST /api/v1/fan/coupons/claim`）：交易內條件式更新（`WHERE claimToken=? AND status='issued' AND claimTokenExpiresAt > now()`）→ `contactId` 改為已驗證身分、狀態轉 `claimed`、憑證清空；受影響列數 0 即回報
- [x] 2.4b 換券失敗分類回報：憑證已被領取／已過期／不存在，不可只回泛稱失敗
- [x] 2.4c 發券時依渠道決定初始狀態：LINE 直接建 `claimed`；FB／IG 與公開連結建 `issued` + 憑證
- [x] 2.5 核銷 API：**DB transaction 內條件式更新搶狀態**（`WHERE status='claimed'`），受影響列數 0 即回報已使用
- [x] 2.5a 失敗分類回報：已使用／已過期／尚未生效／查無此券，不可只回泛稱失敗
- [x] 2.5b 粉絲端自助核銷端點：**僅當該券 `redeemMode='self'` 時開放**，其他模式回 403
- [x] 2.6 券成效查詢：發送／領取／開封／核銷／核銷率五指標
- [x] 2.7 領取名單匯出（CSV，沿用 analytics 既有做法）
- [x] 2.8 所有 route 使用租戶綁定連線（`TenantDb`），不得用 `prismaAdmin`

## A3. 票券頁（第一階段為一般網頁，LIFF 為第二階段）

> 頁面與元件兩階段共用；差別僅在認證入口（A4a／A4b）與是否在 LINE webview 內開啟。
> **勿把版面寫死在 LIFF 假設上**（如必為 LINE 內開、必有 `liff.state`）。

- [x] 3.1 路由與導流：第一階段以一般網址進入；**LIFF Gateway（`liff.state` 導流，參照 aitago `LiffGatewayController`）屬 A4b 階段**（2026-10-21 以既有 /liff/redirect 處理 ct 參數，見 A13 13.3）
- [ ] 3.2 券夾頁：三分頁（可使用／已使用／已失效）、券卡列表、空狀態
- [ ] 3.3 券詳情頁：券面、券號（含未生效遮蔽）、**使用條款（呈現消毒後的 HTML）**、狀態相應的動作按鈕
- [ ] 3.4 核銷確認頁（店員模式）：倒數計時、店員驗證碼輸入、確認按鈕在輸入完整前停用
- [ ] 3.4a 核銷確認頁（自助模式）：**滑動確認**而非按鈕（少了店員這道關卡，需以持續動作提高誤觸成本）
- [ ] 3.5 核銷完成頁：金額、時間、店員碼（店員需在一個手臂距離外可辨識）
- [ ] 3.5a 領取頁（`/coupon/claim/{claimToken}`）：身分驗證後自動換券，成功導向券詳情；失敗依原因顯示對應說明
- [ ] 3.6 券夾 API 掛於既有 `/api/v1/fan` 前綴
- [x] 3.7 顧客票券頁一律淺色，不跟隨系統深色設定（2026-10-21 使用者決定；原規劃為跟隨系統並兩套主題可讀）

## A4a. fan auth 過渡：Account Link 驗證（不需 LINE Login channel）

> 2026-10-20 已由 design D12（One ID 歸戶驗證）取代，Account Link 程式已移除。下列未完成項目不再進行。

> **為何拆**：LIFF 須建於 LINE Login channel 之下，客戶短期內無法取得（design D11）。
> 現況 fan auth 零驗證，不可作為過渡。本組先以 Account Link 補上身分驗證，**A4b 到位前這是唯一合法入口**。

- [x] 4a.1 nonce 產生：CSPRNG、≥128 bit、Base64（**不可用 Math.random 或時間戳**）
- [x] 4a.2 nonce → contactId 對應存放，含 TTL 與**一次性消費**（比照 `line-login.service.ts` 的 stateStore，但需考量多實例部署 → 用 Redis 而非行程內 Map）
- [x] 4a.3 發起綁定端點：呼叫既有 `issueAccountLinkToken()`（`channel-plugins/src/line/index.ts:613`），組 `https://access.line.me/dialog/bot/accountLink?linkToken=&nonce=` 連結並以 `reply`／`push` 送出
- [x] 4a.4 webhook 接 `accountLink` 事件：**事件已解析完成**（同檔 `:282`，帶 `result`／`nonce`），本項只補業務邏輯
- [x] 4a.5 `result === 'ok'` → 以 nonce 反查 contactId，寫入 `ContactAttribute`（沿用 D4 機制，**不新建表**），簽發 fan token
- [x] 4a.6 `result === 'failed'` → 不簽發、不寫入，記錄事件供稽核；顧客端提示重新操作
- [x] 4a.7 nonce 失效／查無 → 與驗證失敗**分別回報**，不可只回泛稱失敗
- [x] 4a.8 **不寫死 linkToken 10 分鐘效期**（官方註明可能變動）；過期以「請重新點選領取」引導重試
- [x] 4a.9 **移除「僅憑 contactId 即發 token」的舊路徑**（此項為上線阻斷，A4a／A4b 皆適用）
- [ ] 4a.10 券夾頁在**一般瀏覽器**可用（非 LIFF webview），以 fan token 認身分
- [x] 4a.11 確認既有粉絲活動／點數功能不因此中斷（回歸測試）

## A4b. fan auth 正式：LIFF id_token 驗證（待 LINE Login channel 到位）

> **前置**：客戶取得 LINE Login channel 並建立 LIFF app。
> 到位後與 A4a 並存一段時間再收斂；`CouponInstance` 結構不變，僅替換認證入口。

- [x] 4b.1 `POST /api/v1/fan/auth` 支援 LIFF `id_token`，以 `line-login` 的 `verifyIdToken` 驗證（改為 POST /fan/coupons/liff-session，見 design D20）
- [x] 4b.2 驗證通過後以 LINE userId 對應聯絡人，再簽發 fan token（驗證 sub 等於收券的 LINE userId 後記錄歸戶驗證，之後走一般 /session）
- [x] 4b.3 **Login channel 憑證改 per-tenant**：現況 `LINE_LOGIN_CHANNEL_ID`／`SECRET` 是全域 env（`config/env.ts:31`），多租戶下壞掉（Login Channel ID 存在各 LINE 渠道的 liffConfig；不需 Secret，全域 env 不再使用）
- [x] 4b.4 **驗證 id_token 的 `aud` 對應該租戶的 Login channel ID** —— 不驗 `aud` 等同容許跨租戶身分偽造（租戶隔離守門）（以該渠道 Login Channel ID 為 client_id 向 LINE 驗證，LINE 檢查 aud）
- [x] 4b.5 LIFF endpoint 為固定 URL，**租戶識別一律自 `aud` 反解，不得信任 URL 參數**（租戶取自伺服器發的票券權杖，不信任網址參數）
- [x] 4b.6 LIFF ID 沿用既有 `Channel.settings.liffConfig.liffId`（後台已有輸入欄位，**不新增設定處**）（沿用 liffConfig.liffId 與既有 Endpoint /liff/redirect）
- [x] 4b.7 前端沿用既有 `apps/web/src/lib/liff.ts`（含 `liff.state` 解析與 sessionStorage 參數保存）（resolveLiffParams 加上 ct）
- [x] 4b.8 A4a 的 Account Link 路徑保留或下線，依屆時客戶渠道狀況決定（保留 One ID 登記：沒設定 LIFF 的渠道與 FB／IG／網站客服仍需要）

## A5. 會員綁定（產品層）

- [x] 5.1 LIFF 綁定頁：引導使用者完成平台身分驗證（LIFF 開啟即自動驗證，不需另做綁定頁）
- [x] 5.2 綁定成功寫入 `ContactAttribute`（key 為會員編號欄位名，**不新建表**）
- [x] 5.3 綁定成功自動貼標（沿用 `addTagToTarget`）
- [x] 5.4 **設定驅動的對外 API 介面**：後台可填端點、認證方式、請求／回應格式、欄位對應
- [x] 5.5 以 `executeApiFetchNode` 執行外部呼叫
- [x] 5.6 錯誤處理：外部無回應／回傳錯誤／查無會員 三種情況分別回報，且不建立不完整綁定
- [~] 5.7 ~~蒐集 2–3 個真實客戶的 API 規格驗證涵蓋度~~ —— **決議不做**：每個客戶格式
      不同，改為把基礎通道做穩（佔位符編碼／SSRF 防護／逾時重試／回應大小上限／
      憑證加密／連線測試），特殊格式一律走客製層。

## A6. 後台券管理頁

- [ ] 6.1 券列表頁（沿用素材庫列表樣式）：搜尋、狀態篩選、核銷率呈現
- [ ] 6.2 建立／編輯券表單：**券型四選一、效期三模式、序號三式的欄位連動顯示隱藏**
- [ ] 6.2a 序號區依模式切換：一人一碼→前綴設定；共用碼→單一輸入框；序號包→貼上文字框 + 檔案上傳
- [ ] 6.2b 共用碼模式須提示「無法追蹤個別顧客、無法防轉發」
- [ ] 6.2c 核銷方式三選一，選 `self` 時提示代價（顧客可自行核銷、無法歸因店員），並建議於條款揭露「誤按即失效」
- [ ] 6.2d 使用條款輸入框支援格式輸入，並說明可用的標記
- [ ] 6.3 核銷台頁（**mobile-first**，店員用手機開）：掃碼取景框、手動輸入券號、明確的成功／失敗狀態
- [x] 6.4 券成效報表頁（掛進既有 analytics，見 12.16）
- [ ] 6.5 UI 不放 emoji、成功訊息不加勾勾（依專案慣例）

## A7. 發券訊息（帶 LIFF 連結）

> 券的內容（券夾／券詳情／核銷）全部呈現在 LIFF 頁，**不做專屬的 Flex 券卡版型**。
> 對話中送出的只是一則帶連結的訊息，讓顧客點進 LIFF 看券。

- [x] 7.1 組出發券訊息：使用既有訊息型別（文字或既有 Flex 版型），內容含券名、面額與 LIFF 連結（文字訊息含券名與票券連結）
- [x] 7.2 連結帶 `liff.state` 參數指向該張券的詳情頁（LIFF 網址為 liff.line.me/{liffId}?ct=&lid=，不用 liff.state 路徑）
- [x] 7.3 連結沿用短網址以取得點擊歸因（2026-10-21 改為在券上記錄開啟次數，不另建短網址，見 design D21 與 13.4、13.5）

## B1. Inbox 對話發券

- [x] B1.1 對話視窗新增「發送優惠券」入口（改為 A11 的置中 Dialog）
- [x] B1.2 挑券後呼叫發券 API，`issuedVia` 記為 `inbox`、`issuedRefId` 記座席 id
- [x] B1.3 僅列出用途分類為「客服補償」且狀態為 active 的券

## B2. 發送策略接線

- [x] B2.1 客服發券用 `push`
- [x] B2.2 關鍵字與加好友觸發用 `reply`（免費；`replyToken` 有效期短，須立即送出）
- [x] B2.3 分眾群發用 `multicast`（service 層已處理 500/批切分）
- [x] B2.4 確認 SafeReply 降級在發券路徑生效（reply 失敗自動改 push）
- [x] B2.5 **FB／IG 發券訊息**：帶 `liff.state=/coupon/claim/{claimToken}` 的連結（FB 用 web_url 按鈕、IG 用連結），文案明示「此連結專屬於您，請勿轉發」
- [x] B2.6 後台發券介面對高價值券標示 FB／IG 的轉發風險，讓商家自行決定是否開放該渠道（2026-10-21 使用者決定不做：各渠道一律以 One ID 歸戶驗證，不區分 LINE）

## B3. 觸發入口

> **實查結果**：B3.1／B3.3／B3.4 皆為**既有能力，無需開發** —— Rich Menu 已支援
> `uri` action（`line/rich-menu.service.ts:36`）、短網址已有 `tagOnClick` 接到
> `addTagToTarget`（`shortlink.service.ts:12`）。券頁就是一個網址，設定即可指向。
> 這幾項屬**設定作業**，列在此供上線時檢核，不是開發項目。

- [x] B3.1 圖文選單按鈕可指向領券／綁定頁（既有 `uri` action，設定即可）
- [x] B3.2 關鍵字回覆可觸發發券（新增 `issue_coupon` automation action）
- [x] B3.3 卡片訊息按鈕可指向券頁（既有 uri 按鈕，設定即可）
- [x] B3.4 短網址帶歸因（既有 `tagOnClick`；券連結改走短網址即可）

## B4. 領券自動貼標

- [x] B4.1 領取時呼叫 `addTagToTarget`，`addedBy` 標記為 `system`
- [x] B4.2 支援時效標籤（`ContactTag.expiresAt`）

## B5. FB／IG 導流

- [x] B5.1 FB／IG 卡片使用 `web_url` 按鈕連至帶 `liff.state` 的網址（2026-10-21 使用者決定不做：FB／IG 維持 One ID 登記）
- [x] B5.2 驗證由 FB／IG 點擊後能正確跳轉 LINE 並開啟對應券（同 B5.1，不做）

## C1. RBAC

- [ ] C1.1 於 `packages/core/src/rbac/permissions.ts` 新增券相關權限點（現有 57 個）
- [ ] C1.2 掛 `requirePermission` 至各 route
- [ ] C1.3 **部署後執行 `scripts/reconcile-system-role-permissions.mjs` 並清除權限快取**（否則既有租戶 403）

## C2. CI 與租戶隔離

- [ ] C2.1 新 route 通過 `scripts/check-tenant-scoping.mjs`
- [ ] C2.2 通過 `scripts/check-prisma-admin-usage.mjs`（不得於非白名單檔案使用 `prismaAdmin`）

## C3. 測試

- [ ] C3.1 核銷防重複：併發兩請求僅一個成功
- [ ] C3.2 券碼唯一性：一人一碼模式大量發券不重複
- [ ] C3.3 效期三模式的到期判定邊界
- [ ] C3.4 發行總量與每人上限的拒絕行為
- [ ] C3.5 未生效券不露碼
- [ ] C3.7 使用條款消毒：危險標記被移除、允許的格式保留、`javascript:` 連結被擋
- [ ] C3.8 自助核銷：非 `self` 模式的券呼叫粉絲端核銷端點應回 403
- [ ] C3.6 跨租戶隔離：A 租戶無法存取 B 租戶的券

## C4. 收尾

- [ ] C4.1 `pnpm build` 與相關套件 typecheck 全綠
- [ ] C4.2 本機驗證（LINE／FB 本機收不到 webhook，見專案既有限制；可用 WEBCHAT 或 UAT）
- [ ] C4.3 更新 `CHANGELOG.md`（date-only heading）
- [ ] C4.4 UAT 驗收：建券 → 對話發券 → 顧客收到 → 領取 → 核銷 全流程

## D. 客製（不在本 change 範圍）

- 對接特定客戶會員 API：端點、認證、請求／回應格式、欄位 mapping、錯誤處理
- 提案前須向客戶確認：認證方式、端點規格、用什麼當 Key、是否雙向同步、測試環境

## A8. 後台第一階段（依 CM-196 設計與《優惠券後台 UX 規則》）

設計來源：Jira CM-196 附件（後台原型、UX 邏輯.pdf）。原型與 UX 規則不一致之處以 UX 規則為準。

### 資料模型

- [x] 8.1 migration：券型、用途、效期模式、序號模式、核銷方式改為可留空（草稿用）；新增 displayCode、minSpend、percentCap、giftName、giftQty、exchangeItem、exchangeValueCap、maskCodeBeforeStart、claimTagTtlDays；CouponInstance 新增 issuedSourceName、issuedSourceMethod、issuedByName

### 測試先行（feature：`apps/api/tests/feature/modules/coupon/coupon-admin.test.ts`；unit：`apps/api/tests/unit/modules/coupon/coupon-rules.test.ts`）

- [x] 8.2 測試「草稿只填券名即可儲存」「發布時檢查全部必填」
- [x] 8.3 測試「元折抵的折抵金額須小於門檻」「百分比超出範圍」「贈品券缺少贈品名稱」「兌換券缺少兌換品項」
- [x] 8.4 測試「驗證碼位數或字元不符」「驗證碼為連續或重複數字」（unit）、「開頭為 0 的驗證碼完整保留」
- [x] 8.5 測試「修改已發布券的鎖定欄位」「修改已發布券的可改欄位」「草稿可修改所有欄位」
- [x] 8.6 測試「調低發行總量不可低於已發放張數」「每人上限不可大於發行總量」
- [x] 8.7 測試「共用碼與其他券重複」「其他租戶使用相同共用碼」「共用碼格式不符」
- [x] 8.8 測試「建立券時產生券號」
- [x] 8.9 測試「依券名或券號搜尋」「狀態計數不受狀態篩選影響」「每列帶出發放與核銷張數」「列表不含其他租戶的券」
- [x] 8.10 測試「停用券使已發出的券失效」「暫停發放不影響已領取的券」「已結束的券不可恢復」
- [x] 8.11 測試「複製進行中的券」「刪除草稿」「刪除已發布的券」
- [x] 8.12 測試「序號搜尋忽略連字號與大小寫」「依狀態篩選」「每頁 50 筆」
- [x] 8.12a 測試「序號包顯示庫存總數」，並在成效 API 回傳 poolSize
- [x] 8.13 測試「對話發券記錄座席名稱」
- [x] 8.14 測試「標籤依時效自動移除」「商家關閉生效前遮蔽」

### 實作

- [x] 8.15 service：草稿／發布驗證分離、券型面額欄位、驗證碼規則、鎖定欄位、總量下限、共用碼唯一、券號產生
- [x] 8.16 service：列表搜尋與計數、複製、只刪草稿、提前結束作廢未使用的券、序號明細篩選、發放來源快照、標籤時效、生效前遮蔽開關
- [x] 8.17 route：Zod 驗證新欄位；新增 `POST /:id/duplicate`、`GET /shared-code/check`
- [x] 8.18 前端：列表頁 `/dashboard/marketing/coupons`（搜尋、狀態分段、操作選單、確認框、系統狀態）
- [x] 8.19 前端：建立／編輯頁（七區塊、設定進度、發布確認框與最壞成本、離開提醒、鎖定欄位唯讀）
- [x] 8.20 前端：詳情頁（五指標卡、序號明細與歷程側欄、設定分頁、驗證碼遮蔽）
- [x] 8.21 前端元件測試：發布確認框列出鎖定設定、驗證碼前端格式檢查、離開提醒
- [x] 8.22 匯出序號明細超過 5,000 筆改背景產生並通知下載（見 design D22 與 13.6）

### 完成定義

- [x] 8.23 `pnpm test`、`pnpm test:feature` 通過
- [x] 8.24 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 8.25 `node scripts/validate-openspec.mjs add-coupon-system` 通過
- [x] 8.26 CHANGELOG.md 新增條目

## A9. 顧客票券夾第一階段（依 CM-197 與 design D12）

設計來源：Figma「優惠券系統 (New)」顧客端、Jira CM-197 附件「顧客票券夾.html」。

### 資料模型

- [x] 9.1 migration：Contact 新增 identityVerifiedAt、identityVerifiedVia

### 測試先行（feature：`apps/api/tests/feature/modules/coupon/coupon-wallet.test.ts`、`apps/api/tests/feature/modules/identity-binding/identity-verified.test.ts`）

- [x] 9.2 測試「登記手機後記錄」「登記觸發合併」
- [x] 9.3 測試「已歸戶的顧客開啟票券連結」「未歸戶的顧客開啟票券連結」「客服手動填寫的手機不算歸戶」「租戶沒有啟用任何登記方式」「未經驗證的存取請求」
- [x] 9.4 測試「開啟有效連結」「連結過期」「聯絡人已合併」「只能存取自己的券」
- [x] 9.5 測試「FB 或 IG 對話中發出的券」
- [x] 9.6 測試「即將到期的券主動提示」「已過到期時間的券列為已失效」「活動提前結束的券註明原因」「分頁數量」（unit 測狀態判定）
- [x] 9.7 測試「時段內輸入正確驗證碼」「驗證碼錯誤」「錯誤達 5 次」「時段結束」「沒有開始就送出驗證碼」
- [x] 9.8 測試「店員掃碼後查詢」
- [x] 9.8b 測試「只有可使用的店員掃碼券能取得 QR Code」「驗證碼輸入格數」，實作 GET /fan/coupons/:id/qrcode 與 staffCodeLength
- [x] 9.8a 測試「合併後券在保留方的券夾」「合併時帶入歸戶驗證」「解除合併時券回到原聯絡人」（`coupon-merge.test.ts`），並修改合併引擎

### 實作

- [x] 9.9 One ID 登記成功時寫入歸戶驗證時間；合併時保留
- [x] 9.10 票券連結權杖（core，API 與 workers 共用）、發券訊息改用票券連結
- [x] 9.11 `POST /fan/coupons/session`：權杖換顧客憑證或回傳驗證要求；登記頁支援送出後返回
- [x] 9.12 對話發券與自動化發券不再依渠道產生領取憑證；移除 Account Link（fan-auth、ticket 交換、webhook 分流）
- [x] 9.13 券夾狀態判定與分頁數量、券詳情欄位（面額、條件、效期、核銷方式說明）
- [x] 9.14 店員驗證碼核銷時段：`POST /:id/start`、`POST /:id/redeem-code`
- [x] 9.15 前端：`/coupon/open/[token]` 入口與驗證引導、`/coupon/wallet` 券夾、`/coupon/wallet/[id]` 詳情與三種核銷、核銷結果與例外狀態
- [x] 9.16 前端元件測試：驗證引導、倒數與驗證碼輸入、滑動核銷門檻、狀態頁

### 完成定義

- [x] 9.17 `pnpm test`、`pnpm test:feature` 通過；兩個租戶隔離檢查 `--strict` 無新增違規
- [x] 9.18 `node scripts/validate-openspec.mjs add-coupon-system` 通過；CHANGELOG 新增條目

## A10. 門市與店員核銷台（依 CM-197 與 design D13）

設計來源：Figma「優惠券系統 (New)」店員端、Jira CM-197 附件「店員核銷台 v3.html」。

### 資料模型與權限

- [x] 10.1 migration：stores、store_accounts（RLS）；coupon_instances 新增 redeemedStoreId、redeemedStoreName、redeemedByAccount
- [x] 10.2 新增權限點 `store.view`、`store.manage`（部署後要跑 reconcile）

### 測試先行（feature：`apps/api/tests/feature/modules/store/store-redemption.test.ts`、`store-admin.test.ts`）

- [x] 10.3 測試「建立門市帳號」（「缺少權限」在 `store-routes.test.ts`，突變驗證：把建立帳號的權限改成 store.view 時測試失敗）「帳號名稱重複」「帳號名稱格式不符」「缺少權限」「列表不含其他租戶的門市」
- [x] 10.4 測試「登入成功」「帳號或密碼錯誤」「密碼錯誤 5 次後鎖定」「門市憑證不能用於後台」
- [x] 10.5 測試「帳號被停用」「密碼被重設」「強制登出」「沒有核銷權限」「門市停業」
- [x] 10.6 測試「查詢可核銷的券」「查詢無法核銷的券」「需在顧客手機上核銷」「查無此券」
- [x] 10.7 測試「確認核銷」「網路重試不重複核銷」「兩台手機同時核銷」
- [x] 10.8 測試「只顯示本門市今天的紀錄」

### 實作

- [x] 10.9 門市與門市帳號管理 service 與後台 API（`/api/v1/stores`）
- [x] 10.10 門市帳號登入、門市憑證、帳號狀態檢查（`/api/v1/store-console/*`）
- [x] 10.11 查券、核銷（重試鍵）、今日紀錄；顧客端券詳情帶核銷門市
- [x] 10.12 前端：後台「門市與核銷帳號」設定頁與櫃檯海報
- [x] 10.13 前端：核銷台 `/redeem`（登入、掃描與手動、確認、結果、今日紀錄、帳號錯誤、相機權限）
- [x] 10.14 前端元件測試

### 完成定義

- [x] 10.15 `pnpm test`、`pnpm test:feature` 通過；兩個租戶隔離檢查 `--strict` 無新增違規
- [x] 10.16 `node scripts/validate-openspec.mjs add-coupon-system` 通過；CHANGELOG 新增條目

## A11. 對話發券第一階段（依 CM-196「對話發券 UX 規格」與 design D14）

範圍只有 UX 規格的第一階段 11 項；補償原因、每月額度、主管核准等後續提案不做。

### 資料模型

- [x] 11.1 migration：coupon_instances 新增 viewedAt

### 測試先行（feature：`apps/api/tests/feature/modules/coupon/coupon-inbox.test.ts`）

- [x] 11.2 測試「座席在對話中發送補償券」「發券訊息送不出時券不發出」「只能發客服補償券」「看不到該渠道的座席不能發券」
- [x] 11.3 測試「對話已關閉」「發送途中對話被轉派」「Facebook 對話超過 24 小時」「LINE 對話沒有回覆期限」
- [x] 11.4 測試「網路重試不重複發券」「查詢發送結果」「發送鍵屬於其他租戶」「兩位座席同時發給同一位顧客」
- [x] 11.5 測試「只列出發布中的客服補償券」「有消費門檻的券排在前面」「已達每人上限的券」「即將到期的券」「沒有可發的補償券」
- [x] 11.6 測試「有補償紀錄」「沒有補償紀錄」「顧客開啟票券連結後狀態變為已領取」
- [x] 11.7 測試「已使用的券計入每人上限」「已過期或已撤回的券不計入每人上限」
- [x] 11.7a 預設角色測試「座席與主管預設可以發券」；路由測試「缺少發券權限」「看不到該渠道的座席不能發券」「只能看的座席不能發券」「發券訊息送不出時券不發出」（真實 deliverToChannel）
- [x] 11.7b 寫好就通過的測試以突變驗證：發送鍵不含租戶 id →「發送鍵屬於其他租戶」失敗；每人上限計入 EXPIRED →「已過期或已撤回的券不計入每人上限」失敗；移除 advisory lock →「兩位座席同時發給同一位顧客」失敗（3 次皆失敗）；發券路由移除渠道可見性檢查 → 兩個可見性測試失敗；發券權限改為 coupon.view →「缺少發券權限」失敗；預設送出永遠成功 →「發券訊息送不出時券不發出」失敗；ChatWindow 不看權限 →「沒有發券權限時不顯示按鈕」失敗

### 實作

- [x] 11.8 core `issueInstances`：每人上限計入已使用；以 advisory lock 鎖住券
- [x] 11.9 `withTenant` 可傳交易選項（逾時）
- [x] 11.10 對話發券服務：面板資料、發券（同一交易送出訊息並寫入對話）、發送鍵與結果查詢、聯絡人已發券
- [x] 11.11 路由 `/api/v1/coupon-issue/*`，移除舊的 `POST /coupons/:id/issue-to-conversation`
- [x] 11.12 票券連結開啟時寫入 viewedAt
- [x] 11.13 前端：輸入區「發券」按鈕、發券 Dialog（補償紀錄、選券、確認、發送中、五種失敗、確認結果中、回覆期限）、放棄詢問、焦點返回
- [x] 11.14 前端：對話中的券訊息卡、右側「已發優惠券」、發送成功提示
- [x] 11.15 前端元件測試

### 完成定義

- [x] 11.16 `pnpm test`、`pnpm test:feature` 通過；兩個租戶隔離檢查 `--strict` 無新增違規
- [x] 11.17 `node scripts/validate-openspec.mjs add-coupon-system` 通過；CHANGELOG 新增條目

## A12. 2026-10-21 決策後續（issue #344；design D15～D19）

### email 驗證碼（D15）

- [x] 12.1 測試「送出 email 後寄出驗證碼」「驗證碼正確才寫入」「驗證碼錯誤」「錯 5 次後驗證碼作廢」「驗證碼過期」「同一個連結最多寄 3 次」「寄信失敗」「驗證碼不能換成別的 email」
- [x] 12.2 實作：登記流程新增驗證碼步驟（Redis 存雜湊）、`POST /public/email-registration/:token/verify`、驗證信模板
- [x] 12.3 前端：登記頁輸入驗證碼步驟、重寄、錯誤訊息
- [x] 12.4 票券頁需要登記時改為 email 優先

### 登記連結重用

- [x] 12.5 測試「未驗證顧客重複開啟票券連結不會被限流」
- [x] 12.6 實作：同一個渠道身分在有效期內重用同一個登記連結

### 對話發券改為先保留再發送（D16）

- [x] 12.7 migration：coupon_instances 新增 deliveryPendingAt
- [x] 12.8 測試「發送時不佔住券的鎖」「發券訊息送不出時券作廢並歸還名額」「發送中的券顧客看不到」「發送中的券計入每人上限」「卡在發送中的券由排程作廢」
- [x] 12.9 實作：發券服務拆成保留、發送、確認／作廢三步；排程清理
- [x] 12.9a 寫好就通過的測試以突變驗證：作廢時不放回序號 →「發券訊息送不出時序號包的序號放回」失敗；作廢時不刪除券 →「發券訊息送不出時券作廢並歸還名額」「卡在發送中的券由排程作廢」失敗

### 其他決策（D17～D19 與門市、渠道文字、序號包）

- [x] 12.10 測試與實作：固定效期與報表日界改用台灣時間（D17）
- [x] 12.11 測試：暫停中的券依效期核銷（D18；行為原本就成立，以突變驗證：核銷時擋下暫停的券 → 測試失敗）。「提前結束」維持作廢未使用的券
- [x] 12.12 測試與實作：機器人處理中的對話不能發券（D19）
- [x] 12.13 測試：停用的門市帳號可以重新啟用（API 與設定頁原本就支援，以突變驗證：只接受停用 →「停用的帳號重新啟用後可以登入」失敗；設定頁不送出啟用 → 元件測試失敗）
- [x] 12.14 測試與實作：票券頁「回到 LINE」依渠道顯示文字
- [x] 12.15 測試與實作：序號包支援 Excel（.xlsx）上傳與直接貼上文字

### 全域分析報表（6.4）

- [x] 12.16 測試與實作：analytics 總表加入優惠券成效（發放、領取、核銷、核銷率，依券排行）；突變驗證：趨勢不排除發送中 →「發送中的券不計入」失敗；路由拿掉 analytics.view →「只能看自己數據的座席不能查看」失敗

### 完成定義

- [x] 12.17 `pnpm test`、`pnpm test:feature` 通過；兩個租戶隔離檢查 `--strict` 無新增違規
- [x] 12.18 `node scripts/validate-openspec.mjs add-coupon-system` 通過；CHANGELOG 新增條目

## A13. LINE Login 驗證與小功能（issue #344；design D20～D23）

### LINE Login 驗證（D20）

- [x] 13.1 測試「LINE 顧客從 LIFF 開啟票券連結」「ID token 驗證失敗」「用其他 LINE 帳號開啟轉傳的連結」「渠道沒設定 Login Channel ID」「設定後發券連結改為 LIFF 網址」「Login Channel ID 格式不對」
- [x] 13.2 實作：渠道設定驗證 `liffConfig.loginChannelId`、ID token 驗證、`POST /fan/coupons/liff-session`、發券連結依渠道設定切換（API 與 workers）
- [x] 13.3 前端：LINE 渠道設定新增 Login Channel ID 欄位與設定說明；`/liff/redirect` 處理票券連結

### 點擊歸因（D21）

- [x] 13.4 migration：coupon_instances 新增 linkOpenedAt、linkOpenCount
- [x] 13.5 測試與實作：開啟票券連結時記錄；單張券成效與數據報表顯示「開啟連結」

### 背景匯出（D22）

- [x] 13.6 測試與實作：超過 5,000 筆回 202、背景產生、通知與下載端點、失敗通知；前端提示

### 即時更新（D23）

- [x] 13.7 測試與實作：發券、開啟、核銷時推送 `coupon.instance.updated`；右側區塊收到後重新載入

### 完成定義

- [x] 13.8 `pnpm test`、`pnpm test:feature` 通過；兩個租戶隔離檢查 `--strict` 無新增違規
- [x] 13.9 `node scripts/validate-openspec.mjs add-coupon-system` 通過；CHANGELOG 新增條目

## A14. 票券連結確認本人（design D24，2026-10-22 UAT 發現）

- [x] 14.1 測試「已驗證的裝置開啟票券連結」「新裝置或轉傳的連結開啟已歸戶顧客的票券」「其他聯絡人或其他租戶的裝置憑證不算」「合併前取得的裝置憑證仍有效」「沒有 email 的已歸戶顧客走登記」（`coupon-wallet-device.test.ts`、`coupon-wallet-device-routes.test.ts`）
- [x] 14.2 測試「以原 email 驗證碼確認身分」「驗證碼錯誤與上限」「票券連結失效時不寄驗證碼」；驗證信用途為票券時請顧客回到優惠券頁面輸入（`ownership-code-email.test.ts`）
- [x] 14.3 測試「LIFF 驗證後記住裝置」（`coupon-line-login.test.ts`、`liff-coupon.test.ts`）與「email 登記完成後記住裝置」（`email-verification-routes.test.ts`、`phone-registration-routes.test.ts`、`email-registration-form.test.tsx`）；`merge_requires_chat` 不給裝置憑證以突變驗證（改成一律給 → 測試失敗）
- [x] 14.4 更新既有測試：已歸戶顧客開啟票券連結改為帶裝置憑證（`coupon-wallet.test.ts`、`coupon-inbox.test.ts`、`coupon-realtime.test.ts`、`coupon-entry.test.tsx`），這是本節刻意的行為變更
- [x] 14.5 實作：裝置憑證簽發與驗證（portal-auth）；`openWalletSession` 檢查裝置憑證、回 `email_code_required`；`POST /fan/coupons/session` 收 `deviceTokens`；`POST /session/code`、`/session/code/verify`；驗證碼寄送與比對抽成共用函式（ownership-code）；LIFF `verified` 與 email 登記驗證成功附上裝置憑證
- [x] 14.6 前端：`lib/fan-device.ts`；票券頁帶裝置憑證、存新的裝置憑證、新增 email 驗證碼步驟（寄送、輸入、確認、重寄冷卻、各種錯誤）；LIFF 入口與 email 登記頁存裝置憑證
- [x] 14.7 `pnpm test`、優惠券與 identity-binding feature 測試通過；三個租戶隔離檢查 `--strict` 無新增違規；`node scripts/validate-openspec.mjs add-coupon-system` 通過；CHANGELOG 新增條目
