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

### Code review 第二輪（bot 審查 bd4b984c）

- `isStoredAvatarUrl()` 不限租戶 →「只有本租戶 avatars 目錄的網址算已存好的頭像」
- 補存不分租戶 →「其他租戶或不是 avatars 目錄的檔案要重新存」
- 信任回應標頭的類型 →「宣告是圖片、內容不是」
- 轉址多跟一次 →「最多跟 3 次轉址」（bot 指出的 off-by-one 在原本的程式上不成立，這個測試記下邊界）
- 重試紀錄不淘汰 →「重試紀錄有上限，超過時淘汰最舊的」
- workers 不比對來源、在路徑任意位置找 bucket →「不刪物件儲存以外或其他租戶的檔案」

### Code review 第三輪（bot 審查 825e4560）

- 回應標頭不是允許的圖片類型就擋 →「回應標頭只是參考：標成 octet-stream 或沒有標頭的圖片照樣存」
- API 端刪檔不檢查 key 格式 →「只刪本租戶 avatars 目錄、補存產生格式的檔案」
- 寫回不比對原網址、身分沒寫入時不刪上傳的檔 →「下載期間被改過的網址不覆蓋」

### Code review 第四輪（bot 審查 fe2f2faf）

- 刪除不檢查其他聯絡人是否還在用 →「其他聯絡人仍在用的頭像檔保留」（anonymize、hard_delete 各一）
- 沒有 `S3_PUBLIC_URL` 時不比對來源就刪 →「沒有設定 S3_PUBLIC_URL 時不刪頭像檔，筆數記在 affected」

### Code review 第五輪（bot 審查 c2d352d8）

- 寫回資料庫拋例外時不刪上傳的檔 →「寫回資料庫失敗時刪掉剛上傳的檔案」
- 不處理：「檢查沒人在用」與刪檔之間另一流程開始引用同一檔（需引用計數表或全域鎖，成本遠大於風險）；`isBlockedUrl()` 的 DNS rebinding（repo 共用限制，頭像網址來自平台 API）
