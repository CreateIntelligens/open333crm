## 0. 需求驗證（前置決策點）

- [ ] 0.1 上線階段 1+2 後觀察：是否真有使用者要自訂結構（範本+AI 不夠用）？確認有需求再往下做
- [ ] 0.2 若確認，評估 dnd 套件（@dnd-kit for React）bundle 與相容

## 1. 元件 registry（宣告式）

- [ ] 1.1 一份 registry：每種元件（text/image/button/box/separator/icon）定義 { 可編屬性, allows 巢狀白名單, 預設值 }
- [ ] 1.2 借鑑 aitago allows 概念但簡化成單一 registry（非五檔散落）

## 2. 結構樹 + 拖拉

- [ ] 2.1 結構樹元件：從 Flex JSON 衍生（單一資料源，不建鏡像）；加/刪/選中
- [ ] 2.2 引入 @dnd-kit 做拖曳排序（避開 aitago 上移/下移）
- [ ] 2.3 加元件受 allows 白名單約束；不合法巢狀擋下

## 3. 屬性面板 + 預覽連動

- [ ] 3.1 config-driven 屬性面板：核心屬性直接顯示、進階旋鈕摺疊
- [ ] 3.2 選樹節點 → 屬性面板顯示該元件屬性；改屬性 → 更新 JSON
- [ ] 3.3 預覽用現成 renderer 從 JSON 即時算（不重寫渲染引擎）
- [ ] 3.4 LINE validate 錯誤路徑對映樹節點/欄位高亮

## 4. JSON 雙向 + undo/redo + 互轉

- [ ] 4.1 視覺 ↔ 原始 JSON 雙向切換（同一份 JSON）
- [ ] 4.2 undo/redo：deepClone 快照 + debounce
- [ ] 4.3 填空「轉為進階」入口；進階回填空保留無法對應的結構不動

## 5. 驗證與收尾

- [ ] 5.1 端到端：填空轉進階 → 拖拉加減元件 → 預覽更新 → 存素材
- [ ] 5.2 巢狀白名單擋不合法
- [ ] 5.3 JSON 雙向 + undo/redo
- [ ] 5.4 填空 ↔ 進階互轉保真
- [ ] 5.5 web typecheck 0 error
- [ ] 5.6 `openspec validate --strict` 通過
- [ ] 5.7 更新 CHANGELOG.md（Added：Flex 進階視覺編輯）
