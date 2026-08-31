## Context

程式碼實查：
- `LineFlexShowcaseEditor`（`apps/web/src/components/materials/line/showcase/LineFlexShowcaseEditor.tsx`）已有：選範本（18 個 SHOWCASE_SAMPLES）→ `extractFields(contents)` 自動掃出所有 text/image/button 欄位 → 逐格編輯 + altText + 加元件。body 結構 `{ sampleId, contents, altText }`。
- `flex-fields.ts` 的 `extractFields`：掃出欄位帶 kind（text/image/button）+ path，但**沒有「所屬區塊業務語彙」**（例如這個 text 是「標題」還是「價格」）。
- 即時預覽：`MaterialPreview` → `line-flex-message-renderer`（現成、真實渲染）。
- 驗證：`POST /materials/line-flex/validate`（實打 LINE API）。

aitago 教訓（要避）：屬性面板攤開 LINE 全規格（單 text 20+ 欄位）、術語技術化、無範本引導主線。

## Goals / Non-Goals

**Goals:**
- Flex 素材預設走「選範本 → 業務語彙填空」，涵蓋 90% 需求。
- 欄位依區塊分組（主圖/標題內文/價格/按鈕），不露 box/flex 術語。
- 進階屬性（顏色/字級/排版）預設隱藏，摺疊可展開。
- 即時預覽 + 試發 + 存素材。

**Non-Goals:**
- AI 描述生成（階段 2）、拖拉/結構編輯（階段 3）、carousel 多卡。
- 不重寫預覽渲染（用現成 renderer）。
- 不發明中間格式（body 仍存 LINE Flex JSON，比照 aitago 借鑑點）。

## Decisions

### D1. 升級既有 showcase editor，不另起新元件
- 直接改造 `LineFlexShowcaseEditor` + `flex-fields.ts`，而非新開編輯器——雛形已有 extractFields + 範本 + 預覽，省力且相容。
- body 結構不變（`{ sampleId, contents, altText }`），存素材、發送、驗證全鏈路不動。

### D2. 欄位 → 業務區塊分組（關鍵易用性）
- `extractFields` 擴充：回傳每欄位的「區塊語彙標籤」。判斷來源：欄位在 Flex 樹的位置（hero → 主圖；body 第一個 text → 標題；含 $/價格樣式 → 價格；footer button → 按鈕）。
- **範本自帶欄位 meta（更可靠）**：在 SHOWCASE_SAMPLES 的 sample 上加一份 `slots` 定義（path → { label:'標題', kind:'text', group:'標題與內文' }），extractFields 優先用範本 meta 的語彙，沒有才 fallback 到位置推斷。這樣「標題/價格/主圖」的命名精準。
- UI 依 group 把欄位裝進業務卡片（主圖卡/標題內文卡/價格卡/按鈕卡）。

### D3. 進階屬性預設隱藏
- 填空 UI 只顯示核心值（文字內容、圖片、按鈕文字+連結）。
- 顏色/字級/粗細/對齊/排版收進每個區塊卡的「⚙ 進階設定」摺疊，預設收合——要調才展開（對比 aitago 全攤開）。

### D4. 各欄位輸入型別
- text → 輸入框（+ AI 潤稿鈕 stub、插變數鈕，AI 潤稿實作在階段 2）
- image → 圖片上傳（複用現有 CompactImageField）
- button → 文字 + 連結（uri）兩欄
- 進階：顏色 swatch、字級 seg、對齊 seg（摺疊內）

### D5. 保留貼 JSON 為進階入口
- line_flex_template（貼 JSON）不動，選類型頁維持它為「進階/開發者」選項；主線是升級後的 showcase 填空。

## Risks / Trade-offs

- **欄位分組推斷可能不準**：純靠位置推斷「哪個 text 是標題」易錯 → 用 D2 的「範本自帶 slots meta」為主、位置推斷為 fallback，命名才可靠。要為 18 個範本補 slots meta（工作量在此）。
- **進階屬性藏起後，重度使用者要調細節**：靠「進階設定」摺疊 + 未來階段 3 的視覺編輯補足。多數人不需要（aitago 已證明）。
- **carousel 多卡未支援**：本階段只單 bubble 範本；多卡範本留後（多數行銷單卡夠用）。
- **不改 body 結構**：好處是全鏈路相容；限制是 slots meta 存在範本定義（前端常數）而非 body，改範本要同步 meta。
