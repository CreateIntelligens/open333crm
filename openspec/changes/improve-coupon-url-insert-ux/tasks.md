## 1. 按鈕名稱與說明（material-system）

- [x] 1.1 測試 `apps/web/tests/unit/components/materials/coupon-url-insert.test.tsx`：既有六個 scenario 改用「插入顧客專屬券連結」；「顯示說明文字」「展開與收合詳細說明」，在現有程式上斷言失敗
- [x] 1.2 `CouponUrlTextField.tsx` 改按鈕名稱、一行說明與「怎麼用？」展開區（`aria-expanded`、`aria-controls`）

## 2. 預覽標籤（material-system）

- [x] 2.1 測試 `apps/web/tests/unit/components/materials/material-preview-coupon-url.test.tsx`：「預覽顯示標籤」「編輯框保留原字」，在現有程式上斷言失敗
- [x] 2.2 新增 `apps/web/src/lib/marketing/coupon-url.ts`（偵測與切字）；`MaterialPreview.tsx` 的 `BubbleText`、`ButtonsPreview` 顯示標籤（design D4）

## 3. 插入領券連結（material-system、coupon-management）

- [x] 3.1 測試 `apps/api/tests/unit/modules/coupon/coupon-claim-link-available.test.ts`：「只列出可用的連結」「只列出同租戶的連結」，在現有程式上斷言失敗（函式不存在時先以回傳空陣列的空實作讓斷言失敗）
- [x] 3.2 測試 `apps/api/tests/unit/modules/coupon/coupon-claim-link-available-route.test.ts`：「缺少檢視權限」回 403，有權限時回 200 與清單，在現有程式上斷言失敗（路由不存在回 404）
- [x] 3.3 `listAvailableClaimLinks()`（service）、`listAvailableClaimLinksFlow`、`GET /claim-links` 路由（design D6）
- [x] 3.4 測試 `apps/web/tests/unit/components/materials/claim-link-insert.test.tsx`：「選一條領券連結插入」「沒有可用的領券連結」「插入領券連結超過字數上限」「清單載入失敗」，「其他版型沒有插入按鈕」加上領券連結按鈕的斷言，在現有程式上斷言失敗
- [x] 3.5 新 hook `useAvailableClaimLinks`；`CouponUrlTextField.tsx` 加「插入領券連結」面板
- [x] 3.6 測試（同 3.1、3.2、3.4 的檔案）：「依渠道篩選」「只有管理行銷權限的素材編輯者可以讀」「缺少檢視權限」改為兩種權限都沒有、「只列出與素材同渠道的領券連結」、403 說明兩種權限，在現有程式上斷言失敗
- [x] 3.7 `channelType` 查詢參數與 service 篩選；路由改 `requireAnyPermission(['coupon.view', 'marketing.manage'])`；編輯器帶入素材渠道。突變驗證：改回 `requirePermission('coupon.view')` 時「只有管理行銷權限…可以讀」與 403 測試失敗；多放行 `marketing.view` 時 403 測試失敗
- [x] 3.8 測試 `coupon-claim-link-available.test.ts`「不列出固定效期已到期的券」在現有程式上斷言失敗；service 以 `coupon.OR` 列出可用情況（不用 `NOT`，避免 NULL 被排除）。突變驗證：到期日條件改成不看現在時間時測試失敗

## 4. 用錯地方時提醒並擋下（coupon-management、automation-engine）

- [x] 4.1 測試 `apps/api/tests/unit/modules/marketing/broadcast-material-coupon-url.test.ts`：「不附券的廣播選了含券連結的素材」「附券廣播可用含券連結的素材」「不含券連結的素材不受影響」，在現有程式上斷言失敗
- [x] 4.2 `template-renderer.ts` 新增 `bodyHasCouponUrl()`；`createBroadcast()` 沒附券且素材含佔位字回 400 `MATERIAL_NEEDS_COUPON`
- [x] 4.3 測試 `apps/api/tests/unit/modules/automation/send-material-coupon-url.test.ts`：「建立關鍵字回覆時選了含券連結的素材」「更新動作時同樣檢查」「只改啟用狀態不檢查」，在現有程式上斷言失敗（「只改啟用狀態不檢查」寫好就通過，突變驗證：讓 `updateRule` 不論有沒有送 `actions` 都呼叫 `assertSendMaterialReferences` 時失敗）
- [x] 4.4 `assertSendMaterialReferences()` 查素材時選 `body`，含佔位字時回 400
- [x] 4.5 測試 `apps/web/tests/unit/lib/marketing/broadcast-source-error.test.ts`（純函式）與 `apps/web/tests/unit/components/line/keyword-reply-coupon-url.test.tsx`：「建立對話框提醒並停用建立按鈕」（`broadcastSourceError` 回傳提醒、附券後為 null）、「關鍵字回覆對話框提醒並擋下存檔」，在現有程式上斷言失敗
- [x] 4.6 `broadcastSourceError()` 收素材 body；`marketing/page.tsx` 顯示提醒並停用建立；`KeywordReplyEditDialog.tsx` 提醒並擋下存檔；`ActionEditor.tsx` 的素材選單顯示提醒（design D3）

## 4b. 固定效期已過到期日的券不發放（coupon-management、automation-engine）

- [x] 4b.1 測試 `packages/core/tests/unit/coupon/issue-expired.test.ts`「發券核心略過已到期的券」「到期當下就不再發」「不是固定效期的券不看到期日」，在現有程式上斷言失敗
- [x] 4b.2 core `isCouponPastFixedEnd`、`couponNotPastFixedEnd`，`issueInstances` 略過並回報 `COUPON_EXPIRED`。突變驗證：拿掉略過時核心測試失敗；`<=` 改 `<` 時「到期當下」失敗
- [x] 4b.3 測試：api `coupon-expired-gates.test.ts`（公開領券、發券服務）、`issue-coupon-reference.test.ts`（存檔擋下）、`keyword-yield-channel.test.ts`（不擋 AI）、feature `broadcast-coupon.test.ts`（建立擋下、發送時擋下）、`coupon-inbox.test.ts`（清單不列、發送擋下），workers `automation-issue-coupon-failure.test.ts`，web `issuable.test.ts`、`coupon-select-field.test.tsx`、`broadcast-coupon-field.test.tsx`、`coupon-detail.test.tsx`，在現有程式上斷言失敗
- [x] 4b.4 各入口的檢查與訊息。突變驗證（各自拿掉該處檢查時測試失敗）：`issueCoupons`、`isClaimable`、規則存檔、keyword-yield、建立廣播、廣播發送、發券面板清單、選券欄、廣播選券、券詳情頁「發送給…」。對話發券的檢查單獨拿掉時測試仍過（`issueCoupons` 拋錯一樣回 `COUPON_NOT_ISSUABLE`），與 `issueCoupons` 一起拿掉時失敗；workers 兩處檢查與核心略過一起拿掉時失敗，原因文字改回時失敗
- [x] 4b.6 PR #385 審查：發送途中券到期時原本當成暫停（`COUPON_NOT_ACTIVE`、提示恢復發放）。測試 feature「發送途中券過了到期日：保留時回報已到期」、unit `broadcast-coupon-stop.test.ts`，在現有程式上斷言失敗；`CouponExpiredError`、`couponUnavailableStop`。突變驗證：拿掉保留時對 `CouponExpiredError` 的判斷時 feature 測試失敗
- [x] 4b.5 `coupon-detail.test.tsx` 既有「顯示發送給…」改用遠期到期日，避免預設資料的到期日過去後誤判
- [x] 4b.7 測試 `coupon-list-view.test.tsx`「優惠券列表標示已到期的券」，在現有程式上斷言失敗
- [x] 4b.9 PR #389 審查：測試 `issue-expired.test.ts`「券已到期時找不到的對象仍回報找不到聯絡人」「同一批發到一半券到期」，在現有程式上斷言失敗；`issueInstances` 的到期檢查移進迴圈、排在找不到聯絡人之後。突變驗證：檢查移回迴圈前時兩個測試都失敗
- [x] 4b.8 `CouponTable` 狀態欄在進行中且已過到期日的券下方標示「已過到期日」。突變驗證：拿掉到期判斷時「還沒到期的券沒有標示」失敗

## 5. 文件

- [x] 5.1 操作手冊 `apps/web/public/manual/ch18-coupons.html`、`ch10-line.html` 改用新名稱、修正關鍵字回覆的說明
- [x] 5.2 `docs/ref/` 描述插入券連結、附券廣播或領券連結 API 的段落同步

## 6. 完成定義

- [x] 6.1 `pnpm test`（api、web、workers、channel-plugins unit）
- [x] 6.2 三種 tsc（api、web、workers）
- [x] 6.3 web build
- [x] 6.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 6.5 `node scripts/validate-openspec.mjs improve-coupon-url-insert-ux` 與 `--specs`
- [x] 6.6 `CHANGELOG.md` 的 `## [2026-10-28]` 加條目
- [ ] 6.7 歸檔：PR 合併後以 `pnpm exec openspec archive improve-coupon-url-insert-ux` 歸檔
