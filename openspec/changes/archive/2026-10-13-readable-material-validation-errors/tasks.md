## 1. LINE 表單版型錯誤訊息（material-system）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/marketing/line-validate-error.test.ts`：「Empty text」「Carousel button link」「Flex material keeps the property path」，以及 UAT 實際回過的其他訊息（縮圖網址、點擊區連結、長度上限、同欄位多則說明只留一則）
- [x] 1.2 實作：`line-validate-error.ts` 的 `formatLineValidateError(contentType, status, body)`，`material.service.ts` 改用它

## 2. 卡片頁數上限（material-system）

- [x] 2.1 測試先行：「Thirteen bubbles」「Editor maximum」
- [x] 2.2 實作：`material.service.ts` 在呼叫 LINE 驗證前檢查頁數

## 3. LINE 圖片縮圖預設使用圖片（material-system）

- [x] 3.1 測試先行：`packages/channel-plugins/tests/unit/line/line-image-message.test.ts`「Blank thumbnail」；`apps/api/tests/unit/modules/marketing/line-default-bodies.test.ts`「Replace only the image」（預設內容沒有 `previewUrl`）
- [x] 3.2 實作：`buildLineMessage()` 的 `line_image` 縮圖空白時用 `mediaUrl`；`default-bodies.ts` 拿掉 `line_image.previewUrl`
- [x] 3.3 附帶：`line_video` 預設內容拿掉 `endCard`（結束畫面已從編輯器移除、發送時不送；示範值存進去，以後補上發送時舊素材會多送一張卡片）。測試先行：`line-default-bodies.test.ts`

## 4. FB 編輯器與預覽（material-system）

- [x] 4.1 測試先行：`apps/web/tests/unit/components/materials/fb-editors.test.tsx`「Postback button」「Card buttons」「Media type choice」、卡片按鈕上限、FB 影片上傳鈕；`material-preview.test.tsx`：文字換行、FB 影片用 video
- [x] 4.2 實作：`editors.tsx` 共用 `FbButtonsField`（類型、文字、網址／回傳值），用在按鈕選單與商品輪播；大圖廣告媒體類型改下拉選單；FB 影片改用 `CompactVideoField`（`validateUrl={null}`，LINE 專用的即時提示不顯示）；`MaterialPreview.tsx` 文字氣泡 `whitespace-pre-wrap`、FB 影片用 `<video>`
- [x] 4.3 附帶：素材名稱、分類、描述的輸入框加上與後端 Zod 相同的字數上限（200／100／500）。原本名稱打 201 字可以送出，後端只回「輸入內容有誤，請檢查後重新送出」。測試先行：`material-editor-limits.test.tsx`

## 5. 完成檢查

- [x] 5.1 `CHANGELOG.md` 新增 Fixed 條目；更新 `docs/ref/features/tenant/MARKETING.md`
- [x] 5.2 `pnpm test` 通過
- [x] 5.3 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 5.4 `node scripts/validate-openspec.mjs readable-material-validation-errors` 通過
- [x] 5.5 部署後在 UAT 重跑素材欄位探測，確認 LINE 錯誤訊息為中文（2026-10-13：LINE 5 種版型 27 則探測全過，錯誤訊息皆為欄位名稱加中文說明，沒有 LINE 原文或 JSON 路徑）
