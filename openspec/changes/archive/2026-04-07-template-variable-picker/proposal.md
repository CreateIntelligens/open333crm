## Why

訊息範本編輯器目前要求使用者手動輸入 `{{contact.name}}` 等佔位符，且沒有任何提示說明哪些 key 可用，導致錯字、漏填或需要翻閱文件才能使用。加入 Variable Picker 可讓編輯器直接引導使用者選擇可用變數，顯著降低使用門檻。

## What Changes

- 新增可用變數清單 API，回傳所有可在範本中使用的 key（含分類與說明）
- 在範本編輯器的訊息內容輸入區旁新增「插入變數」按鈕，點開後顯示分類清單（Contact、Case、Attribute 等）
- 點擊清單中的變數項目，自動在游標位置插入對應的 `{{key}}`
- 同步在「變數定義」區自動補上該變數的 key、label、defaultValue（若尚未存在）
- 支援 `attribute.*` 動態欄位：從當前 tenant 的 contact attributes 讀取可用清單

## Capabilities

### New Capabilities

- `template-variable-picker`: 範本編輯器中的變數選擇器 UI，含可用變數清單 API 及自動插入邏輯

### Modified Capabilities

- `advanced-template-library`: 範本編輯器新增 Variable Picker 入口，variables 陣列同步自動填寫

## Impact

- **前端**：`apps/web/src/components/marketing/TemplateFormDialog.tsx` — 新增 Popover 元件與 textarea 游標插入邏輯
- **後端**：`apps/api/src/modules/marketing/` — 新增 `GET /marketing/templates/available-variables` 端點
- **無 breaking change**：現有手動輸入方式仍然保留，picker 為輔助功能
