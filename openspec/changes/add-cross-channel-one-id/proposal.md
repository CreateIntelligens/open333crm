## Why

老闆需求：同一位顧客在 LINE、FB、IG 上的身分（LINE userId / PSID / IGSID 三者各自以 provider / 粉專 / IG 帳號為範圍，彼此無法換算）要能歸為同一人（One ID），且**沒有自家會員資料庫的租戶也要能用**。

現況零件有但沒串起來、且有安全與資料正確性問題：
- `IdentityMap` / `MergeSuggestion` 表存在，但 `stitchByPhone` / `detectPhoneDuplicates` 沒有任何呼叫者，從未寫入。
- 合併聯絡人有**三套實作**（手動合併 `mergeContacts`、建議合併 `approveMerge`、LINE/FB Login 的 `mergeContactIntoTarget`，另有一套無人呼叫的 `ContactService.mergeContacts` 死程式碼），各漏搬不同資料；LINE/FB Login 那套**硬刪除**來源聯絡人，遇到有點數/活動報名紀錄會直接失敗。
- `POST /api/v1/fan/auth` 對任意 `{contactId, tenantId}` 發顧客 token，不驗證呼叫者身分（安全漏洞）。

同業調查（漸強 CAAC 導流邀請、Omnichat OmniLink）顯示「一次性代碼」是不需會員庫、不需個資、零簡訊成本的主流歸戶法，符合我們的需求；有會員庫的租戶則在後續 change 以「會員登入頁 → 發碼」接上。

本 change 取代優惠券 change（`add-coupon-system`）D6「不做跨渠道歸戶」的決議。

## What Changes

**P0 — 前置修正**
- **BREAKING** 移除 `POST /api/v1/fan/auth`（憑任意 contactId 直接發顧客 token）。經查 apps/web、widget、cli、workers、packages 均無呼叫者，移除後 main 上暫無簽發 fan token 的路徑（粉絲門戶受保護路由暫不可用，但目前沒有顧客端頁面使用），待優惠券分支的 Account Link 或 P2 會員登入頁接上。
- 統一合併引擎：三套合併實作收斂為單一 `mergeContacts` 服務，搬移**所有**帶 `contactId` 的關聯資料，來源聯絡人改為封存（`isArchived` + `mergedIntoId`）不硬刪，並寫入合併紀錄（供稽核與日後拆回）。

**P1 — 一次性綁定代碼引擎**
- 顧客在任一渠道對話中發出綁定請求（關鍵字或選單），系統發出一次性綁定代碼與各目標渠道的導流連結：
  - LINE：`https://line.me/R/oaMessage/{OA ID}/?{含代碼文字}`（預填訊息，顧客按送出）
  - FB：`https://m.me/{粉專}?ref={代碼}`（`messaging_referrals` webhook）
  - IG：`https://ig.me/m/{帳號}?ref={代碼}`（`messaging_referral` webhook）
- 代碼高熵、單次使用、短效（預設 30 分鐘），綁定來源聯絡人。
- FB/IG plugin 目前會**丟棄** referral 事件（`messaging_referrals` / `messaging_referral`），需補解析並帶出 `ref`。
- 各渠道 webhook 在首次打招呼訊息、AI／關鍵字／自動化**之前**攔截代碼：驗證通過即合併兩個聯絡人，並在**雙邊**對話送出確認訊息（含「非本人請回覆解除」）。
- 解除綁定：顧客回覆解除指令或客服在後台操作，將該渠道身分從合併後聯絡人拆出為獨立聯絡人。
- 合併紀錄寫入 `IdentityMap`（新增來源 `BINDING_CODE`），聯絡人頁顯示已綁定渠道與來源。

**不在本 change 範圍**：會員登入頁與客戶會員 API 比對（P2，後續 change）、簡訊/Email OTP、LIFF、手機重複合併建議、後台衝突清單（P3）。

## Capabilities

### New Capabilities
- `cross-channel-binding-code`: 一次性綁定代碼的發放、各渠道導流連結產生、webhook 攔截兌換、雙邊確認、解除綁定與濫用防護。

### Modified Capabilities
- `contact-management`: 聯絡人合併改為單一引擎，完整搬移關聯資料、封存不硬刪、記錄合併日誌；新增解除綁定（拆出渠道身分）。
- `identity-stitching-engine`: 新增 `BINDING_CODE` 歸戶來源；已驗證代碼歸戶視為高信心自動合併。
- `inbound-message-processing`: 入站訊息在 AI/關鍵字/自動化前先檢查綁定代碼與解除指令；FB/IG referral 事件帶出 `ref`。

## Impact

- **DB**：新增綁定代碼表（或 Redis 儲存，design 決定）、合併日誌表；`StitchSource` 列舉加 `BINDING_CODE`；需正式 migration。
- **API**：`modules/contact`（合併引擎）、`modules/portal`（移除 fan/auth 漏洞）、`modules/line-login` / `fb-login`（改呼叫統一合併）、`packages/core/src/identity`（`approveMerge` 改呼叫統一合併）、webhook 入站管線（代碼攔截）、新 `modules/identity-binding`。
- **channel-plugins**：FB/IG 解析 referral 的 `ref`；需要各渠道的導流識別（LINE Basic ID、FB 粉專 ID/username、IG username）。
- **Web**：聯絡人頁顯示綁定渠道與解除操作；渠道設定補導流識別欄位（LINE Basic ID、IG username 目前皆未儲存，FB 只有選填 pageId）。
- **RLS**：代碼兌換在 webhook（public 路徑）內發生，須以代碼所屬 tenantId 走 `withTenant`，且驗證代碼的 tenant 與收訊渠道的 tenant 一致。
- **相容性**：`fan/auth` 無呼叫者；優惠券分支（未 merge）的 D6 描述需更新。
