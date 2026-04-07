## ADDED Requirements

### Requirement: 可用變數清單 API
系統 SHALL 提供 `GET /marketing/templates/available-variables` 端點，回傳依分類整理的可用變數清單，包含靜態變數（contact.*、case.*、storage.*）與該 tenant 的動態 contact attribute 變數（attribute.*）。

#### Scenario: 取得可用變數清單
- **WHEN** 已登入使用者呼叫 `GET /marketing/templates/available-variables`
- **THEN** 系統回傳分類陣列，每個分類含 `category`（顯示名稱）及 `variables` 陣列（每項含 `key`、`label`、`example`）

#### Scenario: attribute.* 動態欄位依 tenant 回傳
- **WHEN** 該 tenant 有 contact attribute key `vip_level`
- **THEN** 回傳清單中的「自訂屬性」分類包含 `attribute.vip_level`

#### Scenario: 無自訂屬性時回傳空分類
- **WHEN** 該 tenant 沒有任何 contact attribute 定義
- **THEN** 回傳清單中不包含「自訂屬性」分類（或該分類的 variables 為空陣列）

### Requirement: 範本編輯器 Variable Picker UI
訊息範本編輯器 SHALL 在「訊息內容」textarea 旁提供「插入變數」入口，讓使用者透過分類清單選擇並插入 `{{key}}` 佔位符，無需手動記憶 key 名稱。

#### Scenario: 開啟 Variable Picker
- **WHEN** 使用者點擊「插入變數」按鈕
- **THEN** 系統顯示 Popover，列出所有可用變數分類與項目，並提供搜尋框

#### Scenario: 插入變數到游標位置
- **WHEN** 使用者在 Popover 中點擊某個變數項目（如「姓名 (contact.name)」）
- **THEN** 系統在 textarea 當前游標位置插入 `{{contact.name}}`，並關閉 Popover

#### Scenario: 無游標選取時插入至末尾
- **WHEN** 使用者點擊變數項目，但 textarea 未曾聚焦
- **THEN** 系統將 `{{key}}` 附加至訊息內容末尾

### Requirement: 插入後自動同步 variables 陣列
當使用者透過 Variable Picker 插入變數時，系統 SHALL 自動在「變數定義」陣列中補上對應的變數定義（若該 key 尚未存在）。

#### Scenario: 插入新變數時自動新增定義
- **WHEN** 使用者插入 `{{contact.name}}`，且 variables 陣列中尚無 `contact.name`
- **THEN** 系統自動在 variables 陣列 append `{ key: "contact.name", label: "姓名", defaultValue: "陳小明", required: false }`

#### Scenario: 插入已存在變數時不重複新增
- **WHEN** 使用者插入 `{{contact.name}}`，且 variables 陣列中已有 `contact.name`
- **THEN** variables 陣列不變，不重複新增
