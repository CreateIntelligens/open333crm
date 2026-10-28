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

## 4. 用錯地方時提醒並擋下（coupon-management、automation-engine）

- [x] 4.1 測試 `apps/api/tests/unit/modules/marketing/broadcast-material-coupon-url.test.ts`：「不附券的廣播選了含券連結的素材」「附券廣播可用含券連結的素材」「不含券連結的素材不受影響」，在現有程式上斷言失敗
- [x] 4.2 `template-renderer.ts` 新增 `bodyHasCouponUrl()`；`createBroadcast()` 沒附券且素材含佔位字回 400 `MATERIAL_NEEDS_COUPON`
- [x] 4.3 測試 `apps/api/tests/unit/modules/automation/send-material-coupon-url.test.ts`：「建立關鍵字回覆時選了含券連結的素材」「更新動作時同樣檢查」「只改啟用狀態不檢查」，在現有程式上斷言失敗（「只改啟用狀態不檢查」寫好就通過，突變驗證：讓 `updateRule` 不論有沒有送 `actions` 都呼叫 `assertSendMaterialReferences` 時失敗）
- [x] 4.4 `assertSendMaterialReferences()` 查素材時選 `body`，含佔位字時回 400
- [x] 4.5 測試 `apps/web/tests/unit/lib/marketing/broadcast-source-error.test.ts`（純函式）與 `apps/web/tests/unit/components/line/keyword-reply-coupon-url.test.tsx`：「建立對話框提醒並停用建立按鈕」（`broadcastSourceError` 回傳提醒、附券後為 null）、「關鍵字回覆對話框提醒並擋下存檔」，在現有程式上斷言失敗
- [x] 4.6 `broadcastSourceError()` 收素材 body；`marketing/page.tsx` 顯示提醒並停用建立；`KeywordReplyEditDialog.tsx` 提醒並擋下存檔；`ActionEditor.tsx` 的素材選單顯示提醒（design D3）

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
