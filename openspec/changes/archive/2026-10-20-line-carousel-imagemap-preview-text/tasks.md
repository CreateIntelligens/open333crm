## 1. 送出時的預覽文字

- [x] 1.1 測試：卡片訊息與圖文訊息送出時用 trim 後的 `altText`，沒填或只有空白時用預設文字（`packages/channel-plugins/tests/unit/line/line-alt-text.test.ts`）
- [x] 1.2 實作：`buildLineCarousel`、`buildLineImagemap` 改用 trim 後的 `altText`，空的時候用預設文字

## 2. 編輯器欄位

- [x] 2.1 測試：卡片訊息與圖文訊息編輯器的「預覽文字」欄位寫入 `altText`、上限 400 字；切換頁面類型保留 `altText` 和 `endPage`（`apps/web/tests/unit/components/materials/line/line-preview-text.test.tsx`）
- [x] 2.2 實作：兩個編輯器加「預覽文字」欄位；`changePageType` 保留 body 其他欄位

## 3. 收尾

- [x] 3.1 CHANGELOG、`docs/ref` 素材文件
- [x] 3.2 `pnpm test`、typecheck、`node scripts/validate-openspec.mjs line-carousel-imagemap-preview-text`
