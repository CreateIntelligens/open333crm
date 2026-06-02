## Why

`add-material-system` 上線實作後與使用者實際使用時發現幾個問題：

1. **LINE Flex JSON 編輯器太難用** — 直接讓使用者改 Flex JSON 結構樹，需要懂 LINE Flex 規範，門檻過高
2. **「雙平台通用」概念對使用者不直覺** — 使用者想的是「我要發 LINE / 我要發 FB」，而不是「我要做一份兩邊都能發的素材」
3. **變數系統 `{{key}}` 太複雜** — 對 POC 階段的使用者來說，自動替換概念造成困擾，預設值與預覽連動不直觀
4. **27 個範本太多** — 多數使用者不知道差異，反而增加選擇焦慮

對齊 LINE OA Manager 後台「訊息項目」的設計（多頁訊息 / 圖文訊息 / 進階影片訊息），改成情境式表單，每個欄位用語都讓使用者一看就懂。

## What Changes

廢棄舊架構，重做為**「LINE 與 FB 分開做」的訊息素材系統**：

- **廢棄 27 個系統範本** — 包括 line_flex_* 12 個、universal_* 6 個、基礎 3 個、FB 6 個全部砍掉
- **廢棄整合版（雙平台通用）** — Universal 概念暫不做，之後另案規劃
- **廢棄變數系統 UI** — `{{key}}` 替換功能拿掉（資料層 variables 欄位保留，給未來進階模式）
- **廢棄 LineFlexEditor** — 結構樹 + JSON 編輯器整個刪除
- **新增 LINE 訊息類型（5 種）**：
  - LINE 純文字
  - LINE 單張圖片
  - LINE 多頁訊息（Carousel） — 4 種頁面類型：商品服務 / 地點 / 人物 / 圖文
  - LINE 圖文訊息（Imagemap） — 28 種預設版型 + 自訂
  - LINE 進階影片（影片 + 結束畫面 + CTA）
- **保留 FB 訊息類型（簡化）**：FB 純文字 / 圖片 / 影片 / 商品輪播 / 按鈕選單 / 大圖廣告 / 優惠券 / 訂單收據 / 滿意度調查
- **Material schema 改動**：
  - `templateId` 從必填改為**選填**（不再從版型 fork，直接選類型建立）
  - `channelType` enum 收窄為 `line` / `fb`（不再有 `universal`）
- **新增依賴**：`react-cropper` + `cropperjs` 用於圖文訊息區域編輯
- **資料砍除**：開發環境直接 `prisma migrate reset`，把舊 27 個 system templates 跟所有舊 Material 都清掉

## Capabilities

### Modified Capabilities
- **`material-system`**：拆掉「雙平台通用 + Flex JSON 編輯」概念，改為「LINE / FB 各自獨立、情境式表單」設計；移除變數系統 UI（資料層欄位保留）；contentType enum 重新定義。

## Impact

### 程式碼

**廢棄／刪除**
- `packages/database/prisma/seed-data/line-flex-samples.ts` — 整檔刪除
- `apps/web/src/components/materials/editors.tsx` 內 `LineFlexEditor` / `BubbleQuickEdit` — 刪除
- `apps/web/src/components/materials/editors.tsx` 內 6 個 `Universal*Editor` — 刪除
- `packages/channel-plugins/src/universal/converter.ts` — 整檔刪除
- system seed 27 個範本資料 — 全刪
- 變數編輯區（MaterialEditor 內的 VariableEditor 整段） — UI 拿掉但資料層保留

**新增**
- `packages/database/prisma/seed-data/system-templates.ts` — 重寫成新的「LINE 5 種 + FB 9 種」範本清單（每個只是一個「類型入口」，不再是有內容的範本）
- `apps/web/src/components/materials/line/LineCarouselEditor.tsx` — 多頁訊息編輯器（4 種頁面類型）
- `apps/web/src/components/materials/line/LineImagemapEditor.tsx` — 圖文訊息編輯器（cropper + 28 版型）
- `apps/web/src/components/materials/line/LineVideoEditor.tsx` — 進階影片編輯器
- `apps/web/src/components/materials/line/imagemap-layouts.ts` — 28 種版型常數
- `apps/web/src/components/materials/line/carousel-page-types.ts` — 4 種頁面類型欄位定義
- `apps/web/src/components/materials/CropperBox.tsx` — react-cropper React wrapper（仿 aitago EditView.vue 邏輯）

**改動**
- `packages/database/prisma/schema.prisma` Material 的 `templateId` → optional
- `apps/api/src/modules/marketing/material.service.ts` — 移除 templateId 必填檢查
- `apps/api/src/modules/marketing/material.routes.ts` — contentType enum 改寫
- `packages/channel-plugins/src/line/index.ts` `buildLineMessage()` — 加 `line_carousel` / `line_imagemap` / `line_video` 三個 case
- `packages/channel-plugins/src/facebook/index.ts` — 無大改（既有 FB case 保留）
- `apps/web/src/components/materials/MaterialEditor.tsx` — 拿掉變數區、預覽 render、detectedKeys 提示
- `apps/web/src/components/materials/TemplatePickerGrid.tsx` — 重做為「選 LINE / FB → 選類型」兩步驟
- `apps/web/src/components/materials/TemplateThumb.tsx` — 重做（沒有舊範本要顯示）

### 套件

```
   pnpm --filter @open333crm/web add react-cropper cropperjs
   pnpm --filter @open333crm/web add -D @types/cropperjs
```

### 資料庫

- `prisma migrate reset --force`（本機砍掉重來，含 system templates + 所有 Material）
- 線上資料**不動**（線上沒有舊 27 個範本，目前是空 materials 表）

### Spec

- `openspec/specs/material-system/spec.md` — archive 時合併（本 change 內 delta 為 `MODIFIED Requirements`）

## Non-Goals

- **整合版（雙平台通用）** — 未來另案，等 LINE / FB 各自穩定再做
- **變數 / per-recipient 替換 UI** — 資料層保留，UI 砍掉；未來再做「進階模式」
- **Broadcast / Inbox 整合** — 仍交給 Louis 另案
- **FB 端編輯器重做** — FB 9 種編輯器維持現狀，先把 LINE 重做完成
- **真實 cropper UX 細節打磨**（縮放、座標微調、滑動切區）— 先做核心功能（版型套用、區域 action 編輯）能用即可
