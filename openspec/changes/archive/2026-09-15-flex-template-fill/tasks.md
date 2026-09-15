## 1. 欄位分組 metadata

- [ ] 1.1 SHOWCASE_SAMPLES 每個 sample 加 `slots` meta：path → { label, kind, group }（如「標題」text 標題與內文、「價格」text 價格、「主圖」image 主圖、「立即購買」button 按鈕）
  - 本階段先以「位置推斷」（inferGroup/slotOf）達成分組，未做逐 sample slots 覆寫；精準覆寫留待後續（有需要更細分組時再補）
- [ ] 1.2 先做核心幾個常用範本（商品促銷/餐廳/優惠券/預約）的 slots，其餘 fallback 位置推斷 — 同 1.1，暫全走位置推斷
- [x] 1.3 `flex-fields.ts` extractFields 擴充：加 `group` 欄位，依位置推斷（image/icon→主圖、text→標題與內文、button_*→按鈕）；預留 sample.slots 覆寫接口

## 2. 填空 UI 升級

- [x] 2.1 LineFlexShowcaseEditor：欄位依 group 裝進業務卡片（主圖/標題與內文/按鈕），不再平鋪技術欄位
- [x] 2.2 各欄位輸入型別：text→輸入框、image/icon→CompactImageField 上傳、button→依 kind 顯示（按鈕文字/網址/訊息）
- [ ] 2.3 進階屬性（顏色/字級/粗細/對齊）收進每卡「⚙ 進階設定」摺疊 — 本階段未實作屬性編輯；改把「新增/刪除元件」結構操作收進 `<details>` 進階區
- [ ] 2.4 text 欄位加「插入變數」鈕；AI 潤稿鈕先放 stub — 未做（AI 潤稿屬階段 2 flex-ai-generate；插入變數留後續）

## 3. 即時預覽 + 動線

- [x] 3.1 填空表單與手機預覽並排；改欄位即時更新（現有 renderer）— 已驗證：改標題即時反映預覽
- [ ] 3.2 試發鈕（複用既有試發機制若有，否則 stub 提示）— 未做，沿用既有存素材後試發動線
- [x] 3.3 存素材走既有 material CRUD（body { sampleId, contents, altText } 不變）

## 4. 選類型頁 + 進階入口

- [x] 4.1 選類型頁：line_flex_showcase「精選範本」為進階版型主入口，文案「直接套用官方設計範本」
- [x] 4.2 line_flex_template（匯入 Flex JSON）維持為「進階（開發者）」選項，不動

## 5. 驗證與收尾

- [x] 5.1 端到端：選餐廳範本 → 欄位依分組填空 → 改標題預覽即時更新 → 進階區容器編輯可展開
- [ ] 5.2 進階設定摺疊：預設看不到顏色/字級 — 不適用（本階段無屬性編輯）；改為「新增/刪除元件」預設收合，已驗證
- [x] 5.3 匯入 JSON 進階入口仍可用（選類型頁保留）
- [x] 5.4 存的 body 結構不變（sampleId/contents/altText），通過既有 line-flex validate
- [x] 5.5 web typecheck 0 error
- [x] 5.6 `openspec validate --strict` 通過
- [x] 5.7 更新 CHANGELOG.md（Added：Flex 範本填空編輯器分組 UI）
