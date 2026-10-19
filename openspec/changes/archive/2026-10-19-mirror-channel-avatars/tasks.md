## 1. 下載頭像

- [x] 1.1 測試：新聯絡人的頭像存進物件儲存、不安全或不是圖片的網址不存（`apps/api/tests/unit/modules/storage/avatar-mirror.test.ts`）
- [x] 1.2 實作 `avatar-mirror.service.ts`：轉址逐次檢查 `isBlockedUrl()`、類型與大小上限、上傳到 `avatars`

## 2. 進站時補存

- [x] 2.1 測試：新聯絡人、舊身分補存、已存過不再下載、客服改過的頭像不覆蓋、失敗後一小時內不重試（`apps/api/tests/unit/modules/webhook/inbound-avatar-refresh.test.ts`）
- [x] 2.2 實作 `inbound-avatar-refresh.ts`，`inbound-contact-resolver.ts` 在解析出身分後於背景排入

## 3. 資料刪除

- [x] 3.1 測試：匿名化刪除頭像檔、硬刪除刪除頭像檔、不刪物件儲存以外或其他租戶的檔案（`apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`）
- [x] 3.2 實作 `data-erasure.handler.ts` 收集並刪除頭像檔

## 4. 文件

- [x] 4.1 更新 `docs/ref/system/AUDIT.md` IDENT-06 與 ERASE-01、`AUDIT-REVIEWS.md`、`CHANGELOG.md`

## 突變驗證

每個突變都讓下列測試失敗，還原後全部通過：

- 只檢查第一站網址、不檢查轉址 →「轉址到內部網路」
- 拿掉 `isBlockedUrl()` →「http 網址」「轉址到內部網路」
- 拿掉圖片類型白名單 →「回應不是允許的圖片類型」
- 拿掉 content-length 檢查、拿掉讀取上限 →「超過 5 MB」
- 404 當成功 →「平台回 404」
- 拿掉「已是自己的網址」判斷 →「已存過的頭像不再下載」
- 更新聯絡人不比對原網址 →「新聯絡人…」「舊身分…」（mock 只在條件符合時更新）
- 拿掉重試間隔 →「補存失敗後一小時內不重試」
- 下載失敗不重新取得 →「舊身分在下次進站時補存」
- resolver 不排入補存 → 4 個進站情境
- 刪除頭像不限本租戶 →「不刪物件儲存以外或其他租戶的檔案」
- 匿名化、硬刪除不刪頭像 →「匿名化刪除頭像檔」「硬刪除刪除頭像檔」

### Code review 後補上（bot 審查 8b7e2916）

- 讀頭像時不加 `FOR UPDATE` →「刪除期間才寫回的頭像檔也會刪除」
- 比對整個網址而不是路徑、key 不檢查格式 →「不刪物件儲存以外或其他租戶的檔案」
