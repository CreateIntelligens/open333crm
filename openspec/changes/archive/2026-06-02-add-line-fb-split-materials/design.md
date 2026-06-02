## Context

`add-material-system` 上線後，使用者實際操作 LINE Flex 範本（餐廳 / 服飾 / 飯店 ...）時發現「結構樹 + JSON 編輯」太硬核，且雙平台通用概念太抽象。對比 LINE OA 官方後台「訊息項目」是用情境式表單（直接填「商品標題 / 圖片 / 價格 / 動作」），使用者不需要懂 Flex Message 規範。

本 change 把架構整個拆掉重做：LINE 跟 FB 完全分開，每邊各自有專屬的訊息類型（不再共用 universal）。

aitago-admin-frontend-v2 已有 LINE 圖文選單（Rich Menu）的成熟實作，用 cropperjs 做區域切割，本 change 直接對齊那套 UX。

## Goals / Non-Goals

**Goals**
- LINE / FB 兩條獨立路線，使用者建立素材時先選 channel，再選類型
- 對齊 LINE OA Manager 後台「訊息項目」的 UX（情境式表單、左預覽右編輯）
- 圖文訊息支援 28 種預設版型 + 自訂版型（用 cropper 切區域）
- 多頁訊息支援 4 種頁面類型（商品服務 / 地點 / 人物 / 圖文），每種固定欄位
- 把舊資料砍乾淨，避免兩套 contentType 並存造成混亂

**Non-Goals**
- 雙平台通用版（之後另案）
- 變數系統 UI（資料層保留，UI 砍掉）
- FB 端編輯器重做（先把 LINE 做完）
- Broadcast / Inbox 整合（Louis）

## Decisions

### 為什麼整批砍掉重做，不漸進改造

舊版的 LineFlexEditor / Universal Editor / 變數 UI 互相耦合：
- `MaterialEditor` 殼依 contentType dispatch，contentType enum 改了會牽動所有 editor
- `MaterialPreview` 也跟著 contentType 分支
- `TemplatePickerGrid` 的群組與 channel filter 邏輯都假設「3 種 channelType」
- seed 27 個範本若保留少數會造成兩套 UX 並存

整批砍砍乾淨 vs. 漸進改造的工作量差不多（都要重寫主要元件），但漸進改造會留下大量 dead code 與兩套並存的 contentType。POC 階段沒有真實使用者資料的負擔，所以**整批砍**比較乾淨。

### 為什麼選 react-cropper

aitago-frontend-v2 用的是 `cropperjs`（pure JS）。我們是 React，要選一個 wrapper 或直接接 vanilla：

| 方案 | 優 | 缺 |
|---|---|---|
| react-cropper | 對 React 友善（受控元件、ref forward）；底層是同一個 cropperjs，aitago 邏輯可直接借用 | 多一層套件 |
| 直接接 cropperjs | 零中介層 | 要自己處理 useEffect 生命週期、destroy 順序 |
| react-image-crop | 純 React 不依賴 cropperjs | 跟 aitago 邏輯不同 |

**選 react-cropper**。aitago `EditView.vue` 中的 `initCropper(axis)` / `setCropData(index, axis)` 邏輯可幾乎照抄到 React。

### contentType enum 重定義

```typescript
// LINE
'line_text' | 'line_image' | 'line_carousel' | 'line_imagemap' | 'line_video'

// FB
'fb_text' | 'fb_image' | 'fb_video'
'fb_generic' | 'fb_button' | 'fb_media'
'fb_coupon' | 'fb_receipt' | 'fb_feedback'

// 廢棄（不再支援）
✗ text / image / video（共用基礎）
✗ universal_* 全部 6 個
✗ line_flex_* 全部 12 個
✗ flex / quick_reply / fb_carousel / template（legacy）
```

`channelType` enum 收窄為 `'line' | 'fb'`（不再有 `universal`）。

### Material `templateId` 改 optional

舊設計強制從版型 fork，現在使用者直接選類型建立 Material，不需要中間的「版型」概念。`templateId` 改 optional。

對應 API 改動：
- `material.service.createMaterial` 移除 `templateId 必填` 驗證
- material.routes.ts createMaterialSchema：`templateId: z.string().uuid().optional()`

### 多頁訊息（line_carousel）欄位設計

四種頁面類型，每種欄位不同（對照 LINE OA 截圖）：

| 頁面類型 | 欄位 |
|---|---|
| **商品服務** | 標籤 + 圖片 + 頁面標題 + 文字說明 + 價格 + 動作 1 + 動作 2 |
| **地點** | 標籤 + 圖片 + 頁面標題 + 地址 + 相關資訊（時間下拉 + 自由文字） + 動作 1 + 動作 2 |
| **人物** | 圖片 + 姓名 + 人物特點 1-3（含背景顏色 6 選 1） + 文字說明 + 動作 1 + 動作 2 |
| **圖文** | 標籤 + 圖片 + 頁面標題 + 文字說明 + 動作 1 + 動作 2 |

body 結構：
```typescript
{
  pageType: '商品服務' | '地點' | '人物' | '圖文';
  pages: Array<{
    label?: { text: string; bgColor: string };
    imageUrl?: string;
    title?: string;
    description?: string;
    // 商品服務 ↓
    price?: { currency: 'NT$' | '$' | '¥'; amount: string };
    // 地點 ↓
    address?: string;
    extraInfo?: { type: '時間' | '電話' | '其他'; value: string };
    // 人物 ↓
    name?: string;
    tags?: Array<{ text: string; color: string }>; // 1-3 個
    // 動作（所有類型共用）
    action1?: ActionConfig;
    action2?: ActionConfig;
  }>;
  endPage?: { ... }; // 結尾頁，選填
}
```

### 圖文訊息（line_imagemap）版型常數

28 種版型分四類，每種版型有固定座標。常數結構：

```typescript
interface ImagemapLayout {
  id: string;            // 'sq_1' / 'sq_2_h' / 'sq_4grid' / ...
  category: '正方形' | '橫長' | '縱長' | '自訂';
  width: number;          // 固定 1040
  height: number;         // 350 / 585 / 700 / 1040 / 1300 / 1850 / 自訂
  thumbnail: string;      // CSS grid-template 描述（畫小縮圖用）
  defaultAreas: Array<{
    x: number; y: number; width: number; height: number;
  }>;
}
```

例：
- `sq_1`（正方形 1 整塊）：1 區，`[{x:0,y:0,w:1040,h:1040}]`
- `sq_4grid`（正方形田字 4 格）：4 區
- `lo_585_2col`（橫長 1040×585 對切）：2 區
- `cu_*`（自訂）：高度 520-2080，初始 1 區覆蓋整圖，使用者用 cropper 自己切

body 結構：
```typescript
{
  baseImageUrl: string;
  layoutId: string;       // 'sq_4grid' or 'custom'
  width: 1040;
  height: number;
  areas: Array<{
    x: number; y: number; width: number; height: number;
    action: ActionConfig;
  }>;
}
```

### 進階影片（line_video）

```typescript
{
  videoUrl: string;        // mp4 URL（建議 720x720 或 16:9）
  previewImageUrl: string; // 影片縮圖
  trackingId?: string;     // LINE 統計用
  endCard: {
    imageUrl: string;      // 影片結束畫面背景
    action: ActionConfig;  // 結束畫面點擊行為
    label: string;         // CTA 按鈕文字
  };
}
```

### ActionConfig 統一定義

所有訊息類型內按鈕／點擊區域的 action 共用一份 type：

```typescript
type ActionConfig =
  | { type: 'message'; label: string; text: string }
  | { type: 'uri'; label: string; uri: string; altUriDesktop?: string }
  | { type: 'postback'; label: string; data: string; displayText?: string };
```

LINE OA 後台只支援 3 種類型（不含 datetimepicker / clipboard），對應 spec 簡化。

### 為什麼 Material 不刪 variables 欄位

雖然 UI 拿掉，但保留 `variables Json @default("[]")`。理由：
1. 未來「進階模式」重新加 UI 時不用 migration
2. 既有的 `template-renderer.ts`、`render.ts` 仍可在 channel plugin / Broadcast 發送時用
3. 不影響資料庫大小（空陣列幾乎零成本）

### 28 種版型如何視覺化

每個版型卡片內畫一個迷你縮圖（CSS grid，按比例顯示分割線），不需要實際載入圖片：

```typescript
// 例：sq_4grid
<div className="grid grid-cols-2 grid-rows-2 gap-px bg-slate-300 aspect-square">
  <div className="bg-slate-100" />
  <div className="bg-slate-100" />
  <div className="bg-slate-100" />
  <div className="bg-slate-100" />
</div>
```

LINE OA 後台就是這樣做的（看截圖 53 的版型 dialog）。

## Risks / Trade-offs

- **[Risk]** 砍掉舊 27 範本後，本機已建立的 Material 若還在用舊 contentType，會發送失敗 → **Mitigation**：`prisma migrate reset --force` 整個重來，避免任何髒資料
- **[Risk]** react-cropper 在 SSR / Next.js App Router 可能有 hydration mismatch → **Mitigation**：CropperBox 元件用 `'use client'` + 動態 import
- **[Trade-off]** 28 種版型工作量大（約 1-2 天） → 接受；按你要求全做
- **[Trade-off]** 拿掉變數 UI 會減弱 broadcast 個人化能力 → 接受；POC 階段優先簡化

## Migration Plan

- **本機**：`prisma migrate reset --force`（含 seed），所有舊 system templates 與 Material 都清掉
- **線上**：線上 materials 表本來就是空的（之前部署只跑了建表 migration），不需特別處理。`contentType` 改動是純 zod 層，不影響 schema
- **schema**：只需要把 `templateId` 改 optional（一支小 migration）
- **不需新增 migration 檔**（schema 唯一改動是 templateId nullable，可加在新 migration 內）
