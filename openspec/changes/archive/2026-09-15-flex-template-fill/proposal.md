## Why

「零程式 Flex 編輯器」是三家同業都沒做好的差異化縫隙（Super8 只有模板卡、Omnichat 加購、MAAC 仍貼 JSON）。研究 aitago 的視覺編輯器得到決定性教訓：**aitago 團隊自己已把功能完整的四欄視覺編輯器降級成「進階」選配，預設改用「範本填空」**——因為前者太複雜（單一 text 元件 20+ 欄位、需懂 box/flex 巢狀、無拖拉、三份表示手動同步）。所以正確方向是：**以「範本填空」為預設主線**，讓不會寫程式的行銷人選一張接近的範本卡、只填業務欄位（標題/內文/圖/按鈕/連結），涵蓋 90% 需求。open333CRM 已有雛形——`LineFlexShowcaseEditor` 能自動掃出 text/image/button 欄位逐格編輯、18 個官方範本、`line-flex-message-renderer` 即時預覽——本階段是把它升級成更清楚、更引導的填空體驗。

## What Changes

- **範本填空為 Flex 主線**：選「Flex 訊息」時，預設進入「選範本 → 填空」流程（取代原本只有「貼 JSON」）。
- **業務語彙的填空 UI**：把 `extractFields` 掃出的欄位，依所屬區塊分組成「主圖 / 標題與內文 / 價格 / 按鈕」這類業務卡片，不露 box/flex/gravity 技術術語。
- **每欄位對應的輸入型別**：圖片欄→上傳、文字欄→輸入框、按鈕欄→文字+連結、顏色/字級等進階屬性收進可摺疊的「進階設定」（預設隱藏）。
- **即時手機預覽**：複用現有 renderer，填一格即更新。
- **試發 + 存素材**：填完可試發到自己 LINE、或存成 line_flex 素材（進廣播發送）。
- **保留貼 JSON**：開發者仍可貼 Flex JSON（現有 line_flex_template 能力保留為進階入口）。

不在本階段範圍：AI 描述生成（階段 2）、進階視覺結構編輯/拖拉（階段 3）、carousel 多卡（先支援單 bubble 範本）。

## Capabilities

### New Capabilities
（無全新 capability；升級既有 Flex 素材編輯能力）

### Modified Capabilities
- `material-system`: Flex 素材編輯改以「範本填空」為預設主線——範本起手 + 業務語彙分組欄位 + 進階屬性摺疊隱藏 + 即時預覽，取代原本 showcase 的平鋪欄位列表。

## Impact

- **前端 (`apps/web/src/components/materials/line/showcase/`)**：
  - 升級 `LineFlexShowcaseEditor`：欄位依區塊分組成業務卡片；進階屬性（顏色/字級/排版）摺疊；圖片/文字/按鈕各自輸入型別；即時預覽並排。
  - 範本選擇入口更清楚（起手引導，非事後展示）。
  - `flex-fields.ts` 的 `extractFields`：擴充「欄位 → 業務區塊」的分組與命名（目前只掃 kind，需加所屬 slot 語彙）。
- **選類型頁 (`TemplatePickerGrid`)**：Flex 類型的說明/入口對齊「視覺填空」而非「匯入 JSON」。
- **後端**：無新端點（存素材走既有 material CRUD、驗證走既有 `POST /materials/line-flex/validate`）。
- **相容性**：line_flex_template（貼 JSON）保留為進階；line_flex_showcase 升級但 body 結構相容（仍是 { sampleId, contents, altText }）。
- **RLS**：無新資料表，走既有 material 租戶隔離。
