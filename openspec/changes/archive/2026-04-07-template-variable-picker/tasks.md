## 1. 後端：可用變數清單 API

- [x] 1.1 在 `marketing.routes.ts` 新增 `GET /marketing/templates/available-variables` 路由
- [x] 1.2 在 `marketing.service.ts` 實作 `getAvailableVariables(prisma, tenantId)` — 靜態清單 + 動態 contact attribute keys 查詢
- [x] 1.3 在 `template-context.ts` 補上靜態變數清單的 metadata（label、example），供 API 及 sampleVariables 共用
- [x] 1.4 撰寫 API response 的 Zod schema（分類陣列格式）並接入路由

## 2. 前端：Variable Picker 元件

- [x] 2.1 新增 `VariablePicker` 元件（`apps/web/src/components/marketing/VariablePicker.tsx`），接受 `variables` prop（分類清單）及 `onInsert(key)` callback
- [x] 2.2 元件內含搜尋框，可即時過濾變數清單
- [x] 2.3 使用 Popover 包裝，點擊外部自動關閉

## 3. 前端：整合至 TemplateFormDialog

- [x] 3.1 在 `TemplateFormDialog.tsx` 的「訊息內容」textarea 使用 `useRef` 取得 DOM 參考，記錄游標位置
- [x] 3.2 呼叫 `GET /marketing/templates/available-variables` 取得可用變數清單（在 dialog 開啟時 fetch）
- [x] 3.3 在「訊息內容」label 旁渲染 `VariablePicker`，並實作 `handleInsertVariable(key)` — 在游標位置插入 `{{key}}`
- [x] 3.4 `handleInsertVariable` 執行後，檢查 variables 陣列是否已有該 key；若無，自動 append 對應定義（key、label、defaultValue、required: false）
