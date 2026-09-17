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
- [ ] 2.3b 序號匯入：支援**貼上文字**與**上傳檔案**兩種輸入；逐筆檢查格式、清單內重複、與既有券碼衝突
- [ ] 2.3c 匯入結果回報：成功筆數、因重複略過、因衝突拒絕，各自列出
- [ ] 2.3d 序號庫存追加：已發布的券可補充序號，不影響已配發者
- [x] 2.4 領取 API：狀態轉 `claimed`，依效期模式計算 `expiresAt` 落地
- [x] 2.4a **憑證換券 API**（`POST /api/v1/fan/coupons/claim`）：交易內條件式更新（`WHERE claimToken=? AND status='issued' AND claimTokenExpiresAt > now()`）→ `contactId` 改為已驗證身分、狀態轉 `claimed`、憑證清空；受影響列數 0 即回報
- [x] 2.4b 換券失敗分類回報：憑證已被領取／已過期／不存在，不可只回泛稱失敗
- [x] 2.4c 發券時依渠道決定初始狀態：LINE 直接建 `claimed`；FB／IG 與公開連結建 `issued` + 憑證
- [x] 2.5 核銷 API：**DB transaction 內條件式更新搶狀態**（`WHERE status='claimed'`），受影響列數 0 即回報已使用
- [x] 2.5a 失敗分類回報：已使用／已過期／尚未生效／查無此券，不可只回泛稱失敗
- [x] 2.5b 粉絲端自助核銷端點：**僅當該券 `redeemMode='self'` 時開放**，其他模式回 403
- [ ] 2.6 券成效查詢：發送／領取／開封／核銷／核銷率五指標
- [ ] 2.7 領取名單匯出（CSV，沿用 analytics 既有做法）
- [x] 2.8 所有 route 使用租戶綁定連線（`TenantDb`），不得用 `prismaAdmin`

## A3. 票券頁（第一階段為一般網頁，LIFF 為第二階段）

> 頁面與元件兩階段共用；差別僅在認證入口（A4a／A4b）與是否在 LINE webview 內開啟。
> **勿把版面寫死在 LIFF 假設上**（如必為 LINE 內開、必有 `liff.state`）。

- [ ] 3.1 路由與導流：第一階段以一般網址進入；**LIFF Gateway（`liff.state` 導流，參照 aitago `LiffGatewayController`）屬 A4b 階段**
- [ ] 3.2 券夾頁：三分頁（可使用／已使用／已失效）、券卡列表、空狀態
- [ ] 3.3 券詳情頁：券面、券號（含未生效遮蔽）、**使用條款（呈現消毒後的 HTML）**、狀態相應的動作按鈕
- [ ] 3.4 核銷確認頁（店員模式）：倒數計時、店員驗證碼輸入、確認按鈕在輸入完整前停用
- [ ] 3.4a 核銷確認頁（自助模式）：**滑動確認**而非按鈕（少了店員這道關卡，需以持續動作提高誤觸成本）
- [ ] 3.5 核銷完成頁：金額、時間、店員碼（店員需在一個手臂距離外可辨識）
- [ ] 3.5a 領取頁（`/coupon/claim/{claimToken}`）：身分驗證後自動換券，成功導向券詳情；失敗依原因顯示對應說明
- [ ] 3.6 券夾 API 掛於既有 `/api/v1/fan` 前綴
- [ ] 3.7 深色模式：LINE App 內與一般瀏覽器皆會吃到系統深色設定，兩套主題皆須可讀

## A4a. fan auth 過渡：Account Link 驗證（不需 LINE Login channel）

> **為何拆**：LIFF 須建於 LINE Login channel 之下，客戶短期內無法取得（design D11）。
> 現況 fan auth 零驗證，不可作為過渡。本組先以 Account Link 補上身分驗證，**A4b 到位前這是唯一合法入口**。

- [ ] 4a.1 nonce 產生：CSPRNG、≥128 bit、Base64（**不可用 Math.random 或時間戳**）
- [ ] 4a.2 nonce → contactId 對應存放，含 TTL 與**一次性消費**（比照 `line-login.service.ts` 的 stateStore，但需考量多實例部署 → 用 Redis 而非行程內 Map）
- [ ] 4a.3 發起綁定端點：呼叫既有 `issueAccountLinkToken()`（`channel-plugins/src/line/index.ts:613`），組 `https://access.line.me/dialog/bot/accountLink?linkToken=&nonce=` 連結並以 `reply`／`push` 送出
- [ ] 4a.4 webhook 接 `accountLink` 事件：**事件已解析完成**（同檔 `:282`，帶 `result`／`nonce`），本項只補業務邏輯
- [ ] 4a.5 `result === 'ok'` → 以 nonce 反查 contactId，寫入 `ContactAttribute`（沿用 D4 機制，**不新建表**），簽發 fan token
- [ ] 4a.6 `result === 'failed'` → 不簽發、不寫入，記錄事件供稽核；顧客端提示重新操作
- [ ] 4a.7 nonce 失效／查無 → 與驗證失敗**分別回報**，不可只回泛稱失敗
- [ ] 4a.8 **不寫死 linkToken 10 分鐘效期**（官方註明可能變動）；過期以「請重新點選領取」引導重試
- [ ] 4a.9 **移除「僅憑 contactId 即發 token」的舊路徑**（此項為上線阻斷，A4a／A4b 皆適用）
- [ ] 4a.10 券夾頁在**一般瀏覽器**可用（非 LIFF webview），以 fan token 認身分
- [ ] 4a.11 確認既有粉絲活動／點數功能不因此中斷（回歸測試）

## A4b. fan auth 正式：LIFF id_token 驗證（待 LINE Login channel 到位）

> **前置**：客戶取得 LINE Login channel 並建立 LIFF app。
> 到位後與 A4a 並存一段時間再收斂；`CouponInstance` 結構不變，僅替換認證入口。

- [ ] 4b.1 `POST /api/v1/fan/auth` 支援 LIFF `id_token`，以 `line-login` 的 `verifyIdToken` 驗證
- [ ] 4b.2 驗證通過後以 LINE userId 對應聯絡人，再簽發 fan token
- [ ] 4b.3 **Login channel 憑證改 per-tenant**：現況 `LINE_LOGIN_CHANNEL_ID`／`SECRET` 是全域 env（`config/env.ts:31`），多租戶下壞掉
- [ ] 4b.4 **驗證 id_token 的 `aud` 對應該租戶的 Login channel ID** —— 不驗 `aud` 等同容許跨租戶身分偽造（租戶隔離守門）
- [ ] 4b.5 LIFF endpoint 為固定 URL，**租戶識別一律自 `aud` 反解，不得信任 URL 參數**
- [ ] 4b.6 LIFF ID 沿用既有 `Channel.settings.liffConfig.liffId`（後台已有輸入欄位，**不新增設定處**）
- [ ] 4b.7 前端沿用既有 `apps/web/src/lib/liff.ts`（含 `liff.state` 解析與 sessionStorage 參數保存）
- [ ] 4b.8 A4a 的 Account Link 路徑保留或下線，依屆時客戶渠道狀況決定

## A5. 會員綁定（產品層）

- [ ] 5.1 LIFF 綁定頁：引導使用者完成平台身分驗證
- [ ] 5.2 綁定成功寫入 `ContactAttribute`（key 為會員編號欄位名，**不新建表**）
- [ ] 5.3 綁定成功自動貼標（沿用 `addTagToTarget`）
- [ ] 5.4 **設定驅動的對外 API 介面**：後台可填端點、認證方式、請求／回應格式、欄位對應
- [ ] 5.5 以 `executeApiFetchNode` 執行外部呼叫
- [ ] 5.6 錯誤處理：外部無回應／回傳錯誤／查無會員 三種情況分別回報，且不建立不完整綁定
- [ ] 5.7 介面設計前先蒐集 2–3 個真實客戶的 API 規格，驗證涵蓋度

## A6. 後台券管理頁

- [ ] 6.1 券列表頁（沿用素材庫列表樣式）：搜尋、狀態篩選、核銷率呈現
- [ ] 6.2 建立／編輯券表單：**券型四選一、效期三模式、序號三式的欄位連動顯示隱藏**
- [ ] 6.2a 序號區依模式切換：一人一碼→前綴設定；共用碼→單一輸入框；序號包→貼上文字框 + 檔案上傳
- [ ] 6.2b 共用碼模式須提示「無法追蹤個別顧客、無法防轉發」
- [ ] 6.2c 核銷方式三選一，選 `self` 時提示代價（顧客可自行核銷、無法歸因店員），並建議於條款揭露「誤按即失效」
- [ ] 6.2d 使用條款輸入框支援格式輸入，並說明可用的標記
- [ ] 6.3 核銷台頁（**mobile-first**，店員用手機開）：掃碼取景框、手動輸入券號、明確的成功／失敗狀態
- [ ] 6.4 券成效報表頁（掛進既有 analytics）
- [ ] 6.5 UI 不放 emoji、成功訊息不加勾勾（依專案慣例）

## A7. 發券訊息（帶 LIFF 連結）

> 券的內容（券夾／券詳情／核銷）全部呈現在 LIFF 頁，**不做專屬的 Flex 券卡版型**。
> 對話中送出的只是一則帶連結的訊息，讓顧客點進 LIFF 看券。

- [ ] 7.1 組出發券訊息：使用既有訊息型別（文字或既有 Flex 版型），內容含券名、面額與 LIFF 連結
- [ ] 7.2 連結帶 `liff.state` 參數指向該張券的詳情頁
- [ ] 7.3 連結沿用短網址以取得點擊歸因

## B1. Inbox 對話發券

- [ ] B1.1 對話視窗新增「發送優惠券」入口（**參照 `TemplatePicker.tsx`，287 行可大幅照抄**）
- [ ] B1.2 挑券後呼叫發券 API，`issuedVia` 記為 `inbox`、`issuedRefId` 記座席 id
- [ ] B1.3 僅列出用途分類為「客服補償」且狀態為 active 的券

## B2. 發送策略接線

- [ ] B2.1 客服發券用 `push`
- [ ] B2.2 關鍵字與加好友觸發用 `reply`（免費；`replyToken` 有效期短，須立即送出）
- [ ] B2.3 分眾群發用 `multicast`（service 層已處理 500/批切分）
- [ ] B2.4 確認 SafeReply 降級在發券路徑生效（reply 失敗自動改 push）
- [ ] B2.5 **FB／IG 發券訊息**：帶 `liff.state=/coupon/claim/{claimToken}` 的連結（FB 用 web_url 按鈕、IG 用連結），文案明示「此連結專屬於您，請勿轉發」
- [ ] B2.6 後台發券介面對高價值券標示 FB／IG 的轉發風險，讓商家自行決定是否開放該渠道

## B3. 觸發入口

- [ ] B3.1 圖文選單按鈕可指向領券／綁定頁
- [ ] B3.2 關鍵字回覆可觸發發券
- [ ] B3.3 卡片訊息按鈕可指向券頁
- [ ] B3.4 短網址帶歸因（沿用既有 `tagOnClick` 與 `link.clicked`）

## B4. 領券自動貼標

- [ ] B4.1 領取時呼叫 `addTagToTarget`，`addedBy` 標記為 `system`
- [ ] B4.2 支援時效標籤（`ContactTag.expiresAt`）

## B5. FB／IG 導流

- [ ] B5.1 FB／IG 卡片使用 `web_url` 按鈕連至帶 `liff.state` 的網址
- [ ] B5.2 驗證由 FB／IG 點擊後能正確跳轉 LINE 並開啟對應券

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
