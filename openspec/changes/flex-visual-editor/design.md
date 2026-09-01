## Context

- 階段 1（填空）+ 階段 2（AI）已涵蓋多數需求。本階段是進階選配。
- aitago 研究是本階段的核心參考：它的四欄視覺編輯器被自家降級，教訓明確（見下 Decisions 的借鑑/避坑）。
- body 存 LINE Flex JSON；預覽用 `line-flex-message-renderer`；驗證用既有 validate API。

## Goals / Non-Goals

**Goals:**
- 提供進階使用者「視覺結構編輯」：加減元件、調巢狀、拖拉排序。
- 忠實對應 Flex 結構（樹狀），但盡量降低 aitago 的複雜度。
- 視覺 ↔ JSON 雙向；填空 ↔ 進階可互轉。

**Non-Goals:**
- 不當預設（填空才是預設）。
- 不重寫渲染引擎（用現成 renderer）。
- carousel 多卡先不做；本階段需求驗證後才實作。

## Decisions

### D1. 借鑑 aitago 的對的手法
- **單一資料源 = LINE Flex JSON**（不發明中間格式、不維護 TreeNode/DOM 鏡像）。樹與預覽都從這份 JSON 即時算出（宣告式，非命令式 splice/insertBefore）。
- **元件 registry（宣告式）**：一份 registry 定義每種元件的 { 可編屬性, allows 巢狀白名單, 預設值 }。取代 aitago 的「五檔 × 每元件」散落。
- **屬性面板 config-driven**：由 registry 的屬性定義渲染表單——但**核心屬性直接顯示、進階旋鈕摺疊**（避開 aitago 全攤開）。
- **LINE 錯誤回貼欄位**：validate 回的錯誤路徑對應到樹節點/欄位高亮（借鑑 aitago 這個好體驗）。
- **undo/redo**：deepClone 快照 + debounce（借鑑 aitago，簡單可靠）。

### D2. 避開 aitago 的坑
- **不維護三份平行表示**：只有 JSON 一份真實資料；樹與預覽是它的衍生 view，不手動同步。
- **不重寫渲染引擎**：預覽用現成 renderer，接受少量誤差，不手刻幾百行 CSS class。
- **一定要拖拉**：引入 dnd 套件（@dnd-kit for React）做樹排序，不用「上移/下移」按鈕。
- **降低巢狀可見度**：bubble 的 header/hero/body/footer 用業務語彙呈現；進階旋鈕預設摺疊。

### D3. 從填空「轉為進階」進入
- 填空編輯器加「轉為進階編輯」鈕 → 帶當前 JSON 進視覺編輯器。
- 進階改過的 JSON 回填空：填空只顯示可對應的具名欄位、無法對應的複雜結構保留原樣不動（不破壞）。

### D4. 需求驗證後再實作（決策點）
- 本階段優先度最低。**建議先上階段 1+2，觀察是否真有使用者要自訂結構**，再決定做不做。
- 若做，先單 bubble 結構編輯；carousel 多卡另議。

## Risks / Trade-offs

- **工程量大**：結構樹 + 拖拉 + 屬性 + JSON 雙向 + 連動，是三階段中最重的。這也是「需求驗證後再做」的原因。
- **重蹈 aitago 覆轍風險**：即使降複雜度，視覺結構編輯天生比填空難用。緩解＝定位為進階選配、預設藏、核心屬性優先。
- **填空 ↔ 進階互轉的資料保真**：進階產生的複雜結構回填空可能有欄位對不上 → 填空保留不動、只編能對應的，不強制降級。
- **dnd 套件引入**：repo 目前無，需評估 bundle 大小與框架相容（apps/web 是 Next.js/React → @dnd-kit）。
- **最實際的風險是「做了沒人用」**：aitago 已是前車之鑑，故列為需求驗證後再實作。
