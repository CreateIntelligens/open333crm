## 1. Spec / 提案文件

- [x] 1.1 寫 `proposal.md`（Why / What Changes / Capabilities / Impact / Non-Goals）
- [x] 1.2 寫 `design.md`（決策、4 種頁面類型、28 種版型、react-cropper、Action 簡化）
- [x] 1.3 寫 spec delta（`specs/material-system/spec.md`，含 MODIFIED + ADDED + REMOVED）
- [x] 1.4 寫 `tasks.md`（本檔）
- [x] 1.5 OpenSpec validate 通過 strict 模式

## 2. 砍掉舊系統（最先做）

- [x] 2.1 刪除 `packages/database/prisma/seed-data/line-flex-samples.ts` 整檔
- [x] 2.2 刪除 `packages/channel-plugins/src/universal/` 整個資料夾
- [x] 2.3 移除 `packages/channel-plugins/src/line/index.ts` 內 `import buildLineFromUniversal` 與 `universal_*` / `line_flex_*` case
- [x] 2.4 移除 `packages/channel-plugins/src/facebook/index.ts` 內 `import buildFbFromUniversal` 與 `universal_*` case
- [x] 2.5 刪除 `apps/web/src/components/materials/editors.tsx` 內 `LineFlexEditor` / `BubbleQuickEdit` / 6 個 `Universal*Editor`
- [x] 2.6 刪除 `apps/web/src/components/materials/MaterialPreview.tsx` 內 LINE Flex 相關預覽分支
- [x] 2.7 改 `apps/api/src/modules/marketing/marketing.routes.ts` 的 contentType enum：移除 universal_* / line_flex_* / legacy 4 個（flex/quick_reply/fb_carousel/template）
- [x] 2.8 改 `apps/api/src/modules/marketing/material.routes.ts` contentType / channelType enum
- [x] 2.9 改 `apps/api/src/modules/marketing/material.service.ts` 拿掉 universal validation 與 templateId 必填檢查

## 3. Schema 改動

- [x] 3.1 `packages/database/prisma/schema.prisma` Material `templateId String? @db.Uuid`（改 optional）
- [x] 3.2 對應 reverse relation 改 `template MessageTemplate?`
- [x] 3.3 `prisma migrate dev --name material_template_optional` 產 migration
- [x] 3.4 手動 DELETE 舊 27 個 system templates + 既有 materials（DB 已乾淨）
- [x] 3.5 重寫 `packages/database/prisma/seed-data/system-templates.ts`：清空為空陣列

## 4. Channel Plugin 擴充新類型

- [x] 4.1 `packages/channel-plugins/src/line/index.ts` 加 `case 'line_text'`：text message
- [x] 4.2 加 `case 'line_image'`：image message
- [x] 4.3 加 `case 'line_video'`：video message（endCard 暫由前端額外傳 follow-up message）
- [x] 4.4 加 `case 'line_carousel'`：新增 `line/builders.ts` 把多頁訊息轉 Flex Bubble Carousel
- [x] 4.5 加 `case 'line_imagemap'`：包成 imagemap message（baseUrl + actions）
- [x] 4.6 `packages/channel-plugins/src/facebook/index.ts` 加 `fb_text` / `fb_image` / `fb_video` case（既有 fb_generic 等 6 個保留）

## 5. 安裝套件

- [x] 5.1 `pnpm --filter @open333crm/web add react-cropper cropperjs`
- [ ] 5.2 `pnpm --filter @open333crm/web add -D @types/cropperjs` — cropperjs 已含內建 types，不需要
- [ ] 5.3 確認 `cropperjs/dist/cropper.css` 能正常被 Next.js 載入 — 待 cropper 整合 task 時驗證

## 6. 前端共用元件

- [ ] 6.1 `apps/web/src/components/materials/line/CropperBox.tsx` — react-cropper React wrapper（留待圖文訊息進階迭代）
- [x] 6.2 新增 `line/ActionConfigEditor.tsx` — 三種 action 的小型編輯器
- [x] 6.3 改 `TemplatePickerGrid.tsx` → 兩步驟：選 channel → 選類型
- [x] 6.4 改 `TemplateThumb.tsx` 對應新的 14 種類型（5 LINE + 9 FB）
- [x] 6.5 改 `MaterialEditor.tsx` 拿掉變數區、preview 直接用 body

## 7. LINE 多頁訊息編輯器

- [x] 7.1 新增 `line/carousel-page-types.ts` 4 種頁面類型的欄位 schema
- [x] 7.2 新增 `line/LineCarouselEditor.tsx` 主編輯器（頁面類型 / tab / 新增刪除排序 / 結尾頁開關）
- [x] 7.3 商品服務頁面欄位（價格 with 幣別下拉）
- [x] 7.4 地點頁面欄位（地址 + 相關資訊類型下拉）
- [x] 7.5 人物頁面欄位（姓名 + 特點 1-3 含顏色）
- [x] 7.6 圖文頁面欄位（標籤 + 標題 + 文字 + 動作）
- [x] 7.7 即時預覽（MaterialPreview 走 line_carousel 分支顯示 carousel cards 縮圖）

## 8. LINE 圖文訊息編輯器

- [x] 8.1 新增 `line/imagemap-layouts.ts` 28 種版型常數（12 + 7 + 8 + 1）
- [x] 8.2 新增 `LayoutPickerDialog.tsx` — 版型選擇 dialog（4 分類 tab + 縮圖網格）
- [x] 8.3 新增 `line/LineImagemapEditor.tsx` 主編輯器（含底圖 / 版型選擇 / 區域列表 / 預覽底圖含區域虛線標示）
- [ ] 8.3a Cropper 拖拉調整區域座標（react-cropper 整合，留下版本）
- [x] 8.4 自訂版型可手動新增 / 刪除 / 微調座標欄位（最多 20 區）

## 9. LINE 進階影片編輯器

- [x] 9.1 新增 `line/LineVideoEditor.tsx`（影片 + 縮圖 + 結束畫面圖 + CTA action）
- [x] 9.2 預覽走 MediaCard kind=video（顯示縮圖含播放圖示）

## 10. LINE 純文字 / 圖片 編輯器

- [x] 10.1 新增 `LineTextEditor`（在 editors.tsx，文字 + 字數 5000 限制）
- [x] 10.2 新增 `LineImageEditor`（在 editors.tsx，圖片網址 + 縮圖網址）

## 11. MaterialEditor 派發

- [x] 11.1 `bodyEditorFor()` 對應新 14 種 contentType
- [x] 11.2 拿掉變數區
- [x] 11.3 拿掉 detectedKeys 提示
- [x] 11.4 刪除 render.ts（變數 render 邏輯不再需要）

## 12. MaterialPreview 重做

- [x] 12.1 移除 universal / line_flex_* 分支
- [x] 12.2 加 `line_carousel` 預覽（顯示 pages 縮圖）
- [x] 12.3 加 `line_imagemap` 預覽（顯示底圖 + 區域虛線標示）— 編輯器內自帶預覽
- [x] 12.4 加 `line_video` 預覽（MediaCard video）
- [x] 12.5 加 `line_text` / `line_image` 預覽

## 13. Build / Type check

- [x] 13.1 `pnpm --filter @open333crm/database build` 通過
- [x] 13.2 `pnpm --filter @open333crm/api build` 通過
- [x] 13.3 `pnpm --filter @open333crm/channel-plugins build` 通過
- [x] 13.4 `pnpm --filter @open333crm/web tsc --noEmit` 零 error
- [x] 13.5 web dev server 起得來，`/materials/new` 回 200

## 14. Manual QA

- [ ] 14.1 開 `/dashboard/marketing/materials/new` 看到「選 channel」步驟
- [ ] 14.2 選 LINE → 看到 5 種類型
- [ ] 14.3 選 FB → 看到 9 種類型
- [ ] 14.4 建立 LINE 多頁訊息（商品服務） → 加 3 頁 → 填欄位 → 儲存 → 列表頁看到
- [ ] 14.5 建立 LINE 多頁訊息（人物） → 確認顏色選擇器運作
- [ ] 14.6 建立 LINE 圖文訊息 → 選正方形 4 格 → 填 4 個區域 action → 儲存
- [ ] 14.7 建立 LINE 圖文訊息 → 選自訂 → 上傳高 1500px 圖 → cropper 切 3 區 → 儲存
- [ ] 14.8 建立 LINE 進階影片 → 填影片 / 縮圖 / 結束畫面 → 儲存
- [ ] 14.9 建立 LINE 純文字 / 圖片
- [ ] 14.10 建立 FB 9 種類型各一個（確認既有編輯器仍可用）
- [ ] 14.11 試 POST API 帶 `contentType: "universal_card"` → 應收到 400
- [ ] 14.12 試 POST API 帶 `contentType: "line_flex_restaurant"` → 應收到 400

## 15. Spec Sync（at archive）

- [x] 15.1 把 `specs/material-system/spec.md`（本 change delta）合進主 spec
- [x] 15.2 `CHANGELOG.md` `[Unreleased]` `### Changed` 補本 change 的條目
- [x] 15.3 通知 Louis 新的 contentType 清單（影響他做 Broadcast / Inbox 整合的 dispatch 邏輯）
