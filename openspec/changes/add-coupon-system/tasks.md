> **建議順序**：A1 → A2 → A7 → B1 → B2 先打通「建券 → 對話發券 → 顧客收到券卡」最短閉環
> （此時券碼直接顯示在 Flex 卡上，**尚不需要券夾**）。驗證商業價值後再做 A3／A4 的 LIFF 票券頁，
> A5 會員綁定可與之並行。

## A1. 資料模型

- [ ] 1.1 `Coupon` model：名稱、說明、券面圖、券型（`discount_amount`/`discount_percent`/`gift`/`exchange`）、用途分類（`marketing`/`service`）
- [ ] 1.2 `Coupon` 效期欄位：`validityMode`（`fixed`/`after_claim`/`after_open`）+ `startAt`/`endAt`/`afterClaimDays`/`afterOpenMinutes`
- [ ] 1.3 `Coupon` 序號欄位：`codeMode`（`shared_code`/`unique_code`/`imported_codes`）+ `sharedCode`
- [ ] 1.4 `Coupon` 發行控制：`totalLimit`、`perContactLimit`、`claimTagId`、`status`（`draft`/`active`/`paused`/`ended`）
- [ ] 1.5 `CouponInstance` model：`couponId`/`contactId`/`code`/`status`/各時間戳/`issuedVia`/`issuedRefId`/`redeemedBy`/`redeemChannel`
- [ ] 1.6 `CouponCode` model（序號包庫存）：`couponId`/`code`/`status`/`instanceId`
- [ ] 1.7 唯一約束：券碼在租戶內唯一；`CouponInstance` 依 `(couponId, contactId)` 配合每人上限查核
- [ ] 1.8 產出正式 migration（**不可只用 db push**）
- [ ] 1.9 **RLS policy migration**（三張新表，比照 `20260828091000_rls_agentic_llm`）
- [ ] 1.10 `prisma generate` 並確認 `@open333crm/database` build 通過

## A2. 券 API 模組

- [ ] 2.1 建立 `apps/api/src/modules/coupon/`（routes + service，比照既有 module 結構）
- [ ] 2.2 券 CRUD：建立／更新／發布／暫停／結束；發布前驗證（序號包模式須有庫存、效期欄位齊備）
- [ ] 2.3 發券 API：檢查發行總量與每人上限 → 配發券碼（依三種 codeMode）→ 建立 `CouponInstance`
- [ ] 2.4 領取 API：狀態轉 `claimed`，依效期模式計算 `expiresAt` 落地
- [ ] 2.5 核銷 API：**DB transaction 內條件式更新搶狀態**（`WHERE status='claimed'`），受影響列數 0 即回報已使用
- [ ] 2.6 券成效查詢：發送／領取／開封／核銷／核銷率五指標
- [ ] 2.7 領取名單匯出（CSV，沿用 analytics 既有做法）
- [ ] 2.8 所有 route 使用租戶綁定連線（`TenantDb`），不得用 `prismaAdmin`

## A3. LIFF 票券頁

- [ ] 3.1 LIFF Gateway：處理 `liff.state` 參數導流（參照 aitago `LiffGatewayController`）
- [ ] 3.2 券夾頁：三分頁（可使用／已使用／已失效）、券卡列表、空狀態
- [ ] 3.3 券詳情頁：券面、券號（含未生效遮蔽）、使用條款、狀態相應的動作按鈕
- [ ] 3.4 核銷確認頁：倒數計時、店員驗證碼輸入、確認按鈕在輸入完整前停用
- [ ] 3.5 核銷完成頁：金額、時間、店員碼（店員需在一個手臂距離外可辨識）
- [ ] 3.6 券夾 API 掛於既有 `/api/v1/fan` 前綴
- [ ] 3.7 深色模式：LIFF 在 LINE App 內開啟會吃到系統深色設定，兩套主題皆須可讀

## A4. fan auth 補 LIFF id_token 驗證

- [ ] 4.1 `POST /api/v1/fan/auth` 改為要求 LIFF `id_token`，以 `line-login` 的 `verifyIdToken` 驗證
- [ ] 4.2 驗證通過後以 LINE userId 對應聯絡人，再簽發 fan token
- [ ] 4.3 移除「僅憑 contactId 即發 token」的舊路徑
- [ ] 4.4 確認既有粉絲活動／點數功能不因此中斷（回歸測試）

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
- [ ] 6.3 核銷台頁（**mobile-first**，店員用手機開）：掃碼取景框、手動輸入券號、明確的成功／失敗狀態
- [ ] 6.4 券成效報表頁（掛進既有 analytics）
- [ ] 6.5 UI 不放 emoji、成功訊息不加勾勾（依專案慣例）

## A7. LINE Flex 券卡版型

- [ ] 7.1 `material.routes.ts` 的 `CONTENT_TYPE_VALUES` 加入 `line_coupon`
- [ ] 7.2 `packages/channel-plugins/src/line/builders.ts` 新增 `buildLineCoupon()`
- [ ] 7.3 `line/index.ts` 的 `switch (contentType)` 加入對應 case
- [ ] 7.4 前端五處：`MaterialEditor`（標籤字典 + editor 分支）、`MaterialPreview`、`TemplatePickerGrid`、`TemplateThumb`、`default-bodies`
- [ ] 7.5 確認 `validateLineMaterialWithLineApi` 對此版型的處理（走驗證或加白名單）

## B1. Inbox 對話發券

- [ ] B1.1 對話視窗新增「發送優惠券」入口（**參照 `TemplatePicker.tsx`，287 行可大幅照抄**）
- [ ] B1.2 挑券後呼叫發券 API，`issuedVia` 記為 `inbox`、`issuedRefId` 記座席 id
- [ ] B1.3 僅列出用途分類為「客服補償」且狀態為 active 的券

## B2. 發送策略接線

- [ ] B2.1 客服發券用 `push`
- [ ] B2.2 關鍵字與加好友觸發用 `reply`（免費；`replyToken` 有效期短，須立即送出）
- [ ] B2.3 分眾群發用 `multicast`（service 層已處理 500/批切分）
- [ ] B2.4 確認 SafeReply 降級在發券路徑生效（reply 失敗自動改 push）

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
- [ ] C3.6 跨租戶隔離：A 租戶無法存取 B 租戶的券

## C4. 收尾

- [ ] C4.1 `pnpm build` 與相關套件 typecheck 全綠
- [ ] C4.2 本機驗證（LINE／FB 本機收不到 webhook，見專案既有限制；可用 WEBCHAT 或 UAT）
- [ ] C4.3 更新 `CHANGELOG.md`（date-only heading）
- [ ] C4.4 UAT 驗收：建券 → 對話發券 → 顧客收到 → 領取 → 核銷 全流程

## D. 客製（不在本 change 範圍）

- 對接特定客戶會員 API：端點、認證、請求／回應格式、欄位 mapping、錯誤處理
- 提案前須向客戶確認：認證方式、端點規格、用什麼當 Key、是否雙向同步、測試環境
