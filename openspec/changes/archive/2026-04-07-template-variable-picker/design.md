## Context

範本編輯器 (`TemplateFormDialog.tsx`) 目前使用純 textarea 讓使用者手動輸入 `{{key}}` 佔位符，且 `variables` 陣列也需手動維護。後端的 `template-context.ts` 已定義所有可用變數（contact、case、attribute.*），但這份清單從未暴露給前端。

## Goals / Non-Goals

**Goals:**
- 提供 `GET /marketing/templates/available-variables` API，回傳可用變數清單（含分類與說明）
- 在訊息內容 textarea 旁新增「插入變數」Popover，列出分類變數讓使用者一鍵插入 `{{key}}`
- 插入後自動同步補齊 `variables` 陣列中的對應定義
- 支援 `attribute.*` 動態欄位（從 tenant 的 contact attributes schema 讀取）

**Non-Goals:**
- 不修改 body 的 JSON 結構（flex、quick_reply 等複雜類型的 variable picker 不在此次範圍）
- 不做 textarea 的 syntax highlighting 或 inline autocomplete
- 不修改發送/渲染邏輯

## Decisions

### 1. API 回傳靜態 + 動態變數合併清單

**決定**：後端提供一個 API，靜態部分（contact.*、case.*、storage.*）硬編碼，動態部分（attribute.*）從 DB 查詢當前 tenant 的 contact attribute keys。

**替代方案**：全部前端硬編碼 → 無法反映 tenant 自訂欄位，放棄。

**回傳格式**：
```json
[
  {
    "category": "聯絡人",
    "variables": [
      { "key": "contact.name", "label": "姓名", "example": "陳小明" },
      { "key": "contact.phone", "label": "電話", "example": "0912-345-678" },
      { "key": "contact.email", "label": "Email", "example": "demo@example.com" }
    ]
  },
  {
    "category": "案件",
    "variables": [
      { "key": "case.id", "label": "案件編號", "example": "CASE-20240101-001" },
      { "key": "case.title", "label": "案件標題", "example": "冰箱維修申請" },
      { "key": "case.status", "label": "案件狀態", "example": "處理中" },
      { "key": "case.priority", "label": "優先級", "example": "高" }
    ]
  },
  {
    "category": "自訂屬性",
    "variables": [
      { "key": "attribute.membership", "label": "membership", "example": "" }
    ]
  }
]
```

### 2. 前端使用 Popover + 分類清單

**決定**：在 textarea label 旁新增「插入變數」小按鈕，點開 Popover 顯示分類 + 搜尋框，點擊後插入游標位置。

**替代方案**：下拉 Select → 無法搜尋也無法分類，UX 較差，放棄。

### 3. 插入後自動補齊 variables 陣列

**決定**：插入 `{{key}}` 後，檢查 variables 陣列是否已有該 key；若無，自動 append `{ key, label, defaultValue: example, required: false }`。

**理由**：減少使用者重複操作，variables 定義應跟隨插入行為自動維護。

## Risks / Trade-offs

- **attribute.* 讀取效能**：每次開啟 picker 需查一次 DB，但 contact attribute keys 數量有限，影響可忽略。可加 `stale-while-revalidate` 快取。→ 短期不處理，量大時再加 cache。
- **textarea 游標位置**：在 React controlled textarea 中插入文字需正確使用 `selectionStart`/`selectionEnd`，需小心 React 重繪導致游標跳動。→ 使用 `document.execCommand('insertText')` 或手動維護 ref。
