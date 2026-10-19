## 1. API 示範底圖

- [x] 1.1 測試：示範底圖提供 LINE 規定的五種寬度、其他寬度不提供（`apps/api/tests/unit/modules/storage/line-imagemap-demo.test.ts`）
- [x] 1.2 產生 `apps/api/assets/imagemap-demo/{240,300,460,700,1040}.jpg`，`line-imagemap.routes.ts` 新增 `/demo/:width`

## 2. 編輯器預設值與預覽

- [x] 2.1 測試：新建圖文訊息預設帶入公開的示範底圖、預覽示範底圖（`apps/web/tests/unit/lib/imagemap-url.test.ts`）
- [x] 2.2 `imagemap-url.ts` 匯出示範底圖網址並在預覽加 `/1040`；`default-bodies.ts` 改用它

## 3. 文件

- [x] 3.1 `CHANGELOG.md`

## 突變驗證

- 拿掉 `/demo/:width` 路由 →「示範底圖提供 LINE 規定的五種寬度」「其他寬度不提供」（實作前即失敗）
- 預覽不處理 `/line-imagemap/demo` →「預覽示範底圖」（實作前即失敗）
- 預設 body 仍用 `/material-samples/promo-banner.jpeg` →「新建圖文訊息預設帶入公開的示範底圖」（實作前即失敗）
