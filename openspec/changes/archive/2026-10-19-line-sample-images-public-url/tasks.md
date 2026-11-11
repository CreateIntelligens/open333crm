## 1. 儲存時轉換示範圖

- [x] 1.1 測試：圖片、影片與卡片訊息的示範圖換成公開網址；圖文訊息的舊示範底圖換成示範底圖端點；不是示範圖的網址不變；更新素材時一樣轉換；FB 素材不轉換（`apps/api/tests/unit/modules/marketing/material-sample-urls.test.ts`）
- [x] 1.2 新增 `material-sample-urls.ts`，`createMaterial()`、`updateMaterial()` 在驗證前呼叫；`getApiPublicUrl()` 移到 `storage.service.ts`

## 2. 卡片訊息切換頁面類型

- [x] 2.1 測試：卡片訊息切換頁面類型時，完整網址的示範圖也換掉（`apps/web/tests/unit/components/materials/line/carousel-page-types.test.ts`）
- [x] 2.2 `carousel-page-types.ts` 的 `isSampleImage()` 依路徑判斷

## 3. 文件

- [x] 3.1 `CHANGELOG.md`、`material.service.ts` 註解

## 突變驗證

- 任何站內路徑都換成公開網址 →「不是示範圖的網址不變」
- 字串中出現示範圖路徑就換 →「不是示範圖的網址不變」「圖文訊息的舊示範底圖換成示範底圖端點」
- 拿掉「只處理 LINE 版型」→「FB 素材不轉換」
- 換成完整網址的舊示範底圖不換 →「圖文訊息的舊示範底圖換成示範底圖端點」
- 其餘情境（圖片／影片／卡片、更新素材、卡片切換頁面類型）實作前即失敗

### Code review（bot 審查 0c2ffd16）

- 更新 Flex 素材時跳過轉換 →「更新 Flex 素材時一樣轉換」（修正前失敗）
- 卡片訊息只比對網址結尾 →「使用者自己的圖切換頁面類型時保留」新增「結尾相同但路徑不同」的案例（修正前失敗）

### Code review（bot 審查 32cb6204）

- 轉換不限網址欄位 →「不是示範圖的網址不變」新增「文字欄位整段是示範圖路徑」案例（修正前失敗）
- 卡片訊息不比對來源 →「使用者自己的圖切換頁面類型時保留」新增「其他網域、路徑相同」案例（修正前失敗）
