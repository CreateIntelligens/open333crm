## Why

部分外部 LINE 素材已經是 Flex Message JSON 格式，重新用現有 LINE 多頁訊息或圖文訊息表單重建成本太高。需要一個進階匯入流程，把外部 Flex JSON 轉成可重用素材，並用「挖洞」欄位讓業務使用者只填可變值，不需要直接改整份 JSON。

## What Changes

- 新增 LINE Flex Message 外部素材匯入入口，接受 `flex_message` JSON 或 LINE message payload，匯入後建立 tenant-scoped Material。
- 新增 `line_flex_template` contentType，用於「匯入型 Flex 素材」，避免恢復已淘汰的 `line_flex_*` 系統範本。
- 新增 Flex JSON 驗證、正規化與預覽能力，支援 bubble / carousel Flex Message。
- 新增「挖洞」設定，使用者可在匯入後把 Flex JSON 內的文字、圖片網址、連結、postback data、顏色、數字等 leaf value 標記成可填欄位。
- 新增可填欄位 schema，包含欄位 key、label、資料型別、JSON path、預設值、必填、限制條件與範例值。
- 新增 runtime render 流程，發送前以欄位值套回 Flex JSON，產出合法 LINE Flex Message payload。
- 新增受控的「樹狀結構新增元件」能力，只允許在白名單節點新增安全子元件，例如 body/footer contents 新增 box/text/image/button/spacer/separator，或 carousel contents 新增 bubble。
- 新增前端匯入與設定畫面，包含 JSON 貼上/檔案匯入、Flex 樹狀檢視、可挖洞欄位面板、允許新增元件的節點操作與預覽。
- API 新增匯入、驗證、欄位偵測、渲染預覽端點；一般 Material CRUD 保持既有 tenant、RBAC、contentType 驗證規則。
- 不恢復舊版 `line_flex_*` 12 個系統範本，不恢復通用 universal 素材，也不把一般使用者導回硬核 JSON 編輯器。

## Capabilities

### New Capabilities
- `line-flex-material-import`: Covers importing external LINE Flex Message JSON, marking fillable holes, rendering values back into Flex payloads, and controlled tree-node component insertion.

### Modified Capabilities
- `material-system`: Adds `line_flex_template` to the supported LINE contentType catalog and defines how imported Flex Materials fit into the existing Material lifecycle.

## Impact

- **Database**: likely adds JSON metadata fields or companion tables for Flex template fields and editable node policies; keeps tenant scoping on all persisted records.
- **API**: adds marketing material import/validate/render endpoints and updates material contentType validation.
- **Channel plugins**: LINE builder must render `line_flex_template` by applying provided field values to the stored Flex JSON and sending a Flex Message payload.
- **Web**: adds an advanced import flow under marketing materials, including JSON import, field-hole editor, controlled tree editor, and preview.
- **Validation**: requires Flex JSON schema validation, JSON path handling, safe mutation rules, and tests for invalid payloads, missing required fields, and disallowed node insertions.
- **Non-goals**: no broadcast/inbox dispatch changes, no FB Flex support, no universal converter, no automatic AI mapping of arbitrary external assets in this change.
