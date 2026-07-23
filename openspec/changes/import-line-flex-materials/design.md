## Context

`add-line-fb-split-materials` 之後，Material 系統已改成 LINE / FB 分開建立，並移除舊的 `line_flex_*` 系統範本與通用素材。現在的 LINE 編輯器適合從系統表單建立素材，但外部廠商、設計師或既有 LINE OA 素材常直接提供 Flex Message JSON；若要人工重建成多頁訊息或圖文訊息，成本高且容易失真。

目前程式碼已有 `line_flex_showcase` 的前端展示型 Flex 編輯基礎，包含掃描 text/image/button 欄位與在 container 新增元件。這次 change 把這類能力產品化為外部匯入流程：匯入任意合法 Flex JSON，標記可填欄位，限制可編輯樹狀結構，最後仍透過 Material / LINE channel plugin 發送。

## Goals / Non-Goals

**Goals:**
- 支援貼上或上傳外部 LINE Flex Message JSON，包含完整 message payload 或 `contents` 物件。
- 建立新的 `line_flex_template` Material contentType，專門表示匯入型 Flex 素材。
- 匯入後用欄位洞描述可填值位置，不要求業務使用者直接編輯整份 JSON。
- 支援在白名單樹狀節點新增特定元件，讓外部素材可以延展商品列、文字段落、圖片、按鈕或 carousel bubble。
- 使用既有 Material preview/send 變數流程，並在 LINE plugin 送出合法 Flex Message。
- 保留現有 LINE 多頁訊息、圖文訊息、進階影片流程，不改它們的使用體驗。

**Non-Goals:**
- 不恢復舊的 12 個 `line_flex_*` 系統範本。
- 不恢復 universal / LINE-FB 共用素材。
- 不提供任意 JSON path 的自由插入或任意元件類型新增。
- 不在這個 change 做 Broadcast / Inbox 的發送入口整合。
- 不做 AI 自動理解素材語意或自動命名欄位；先做 deterministic import/editor。

## Decisions

### 1. 新 contentType 使用 `line_flex_template`

`line_flex_template` 表示「從外部 Flex JSON 匯入，並帶欄位洞與可編輯節點 policy 的素材」。它和 `line_flex_showcase` 的差異：

| Type | 用途 | 來源 | 是否本 change 核心 |
|---|---|---|---|
| `line_flex_showcase` | 系統內建精選 Flex 範例 | repo sample | 否，作為可復用基礎 |
| `line_flex_template` | 外部 Flex JSON 匯入素材 | 使用者貼上/上傳 | 是 |

不命名為 `line_flex_*` 舊範本系列，避免和已移除的 `line_flex_restaurant` 等 legacy catalog 混淆。

### 2. 先不新增 Prisma model，資料放在 Material JSON

使用現有 `Material.body` 與 `Material.variables`：

```ts
type LineFlexTemplateBody = {
  altText: string;
  contents: Record<string, unknown>;       // LINE Flex contents: bubble or carousel
  fields: FlexTemplateField[];             // 挖洞欄位
  editableContainers: FlexEditableContainer[];
  source?: {
    importedAt: string;
    format: 'message' | 'contents';
    hash: string;
  };
};
```

理由：
- Material 已是 tenant-scoped reusable content unit，不需要新 aggregate root。
- `body` 本來就是 JSON，適合保存 Flex 結構與欄位 metadata。
- 現有 preview/send helper 已有變數替換流程，可先沿用 `{{key}}` placeholder。
- 降低 migration 風險；若之後需要版本控管或批次匯入，再拆 companion table。

### 3. 挖洞以 JSON Pointer + placeholder 共同表示

欄位洞 schema：

```ts
type FlexTemplateField = {
  key: string;
  label: string;
  path: string; // JSON Pointer, e.g. /body/contents/0/text or /contents/0/body/contents/1/text
  kind: 'text' | 'image_url' | 'uri' | 'postback_data' | 'color' | 'number' | 'alt_text';
  defaultValue?: string;
  required: boolean;
  constraints?: {
    maxLength?: number;
    pattern?: string;
    enum?: string[];
    min?: number;
    max?: number;
  };
  sampleValue?: string;
};
```

When a field is created, the value at `path` is replaced with `{{key}}` in `body.contents` or `body.altText`. The metadata in `body.fields` drives UI labels and validation, while existing renderer replaces placeholders at preview/send time.

Alternatives considered:
- Store original value separately and patch by path at send time. More precise for non-string values, but adds a second renderer and more failure modes.
- Use only `Material.variables` without paths. Too weak for the editor because users cannot see which Flex node each value controls.

### 4. 匯入 API 接受兩種 Flex shapes

Importer normalizes both:

```json
{ "type": "flex", "altText": "...", "contents": { "type": "bubble" } }
```

and:

```json
{ "type": "bubble" }
```

The stored body always uses `altText` plus `contents`. If `altText` is missing, default to the Material name or `Flex Message` and require the user to confirm before save.

### 5. Controlled tree editing only

新增元件只允許在 computed editable containers 中發生：

```ts
type FlexEditableContainer = {
  path: string;
  label: string;
  allowedChildren: Array<'text' | 'image' | 'button' | 'box' | 'spacer' | 'separator' | 'bubble'>;
  maxChildren?: number;
};
```

Rules:
- `box.contents` may add `text`, `image`, `button`, `box`, `spacer`, `separator`.
- `carousel.contents` may add `bubble`.
- `footer.contents` follows `box.contents` rules but should default to buttons/text.
- Header/body/footer block creation is allowed only when the target bubble lacks that block.
- Raw arbitrary JSON insertion is not exposed.

This protects LINE payload validity while still covering the user's "特定樹狀結構可以新增元件" requirement.

### 6. Validation split

API-level validation should check:
- payload is JSON object and normalized Flex contents is `bubble` or `carousel`;
- max payload size is bounded before parsing and before saving;
- field keys are unique and match the renderer key pattern;
- field paths exist and point to supported mutable leaf values;
- editable container paths exist and are known container arrays;
- rendered preview still passes Flex payload validation.

Frontend validation can provide faster feedback but API remains source of truth.

### 7. LINE plugin output

`buildLineMessage('line_flex_template', renderedBody)` returns:

```ts
{
  type: 'flex',
  altText: renderedBody.altText ?? 'Flex Message',
  contents: renderedBody.contents,
  quickReply: ...
}
```

The plugin must not send metadata fields such as `fields`, `editableContainers`, or `source` to LINE.

## Risks / Trade-offs

- **[Risk] Invalid external Flex JSON is accepted and fails only at send time.** Mitigation: normalize and validate on import, save, preview, and channel build.
- **[Risk] Existing recursive `{{key}}` renderer also renders metadata fields.** Mitigation: channel plugin uses only `renderedBody.altText` and `renderedBody.contents`; metadata is ignored for outbound payload.
- **[Risk] JSON Pointer paths can drift after users insert/delete nodes.** Mitigation: after structural mutation, recompute fields/containers where possible and mark orphaned field paths invalid until remapped.
- **[Risk] LINE Flex schema is broad and hard to fully validate locally.** Mitigation: implement pragmatic structural validation first and isolate it in a shared `line-flex-template` utility for later hardening.
- **[Trade-off] No new tables means less queryability for individual fields.** Acceptable for initial import workflow because Materials are retrieved as full documents.

## Migration Plan

- No destructive database migration is required.
- Add `line_flex_template` to API contentType validation, front-end type picker/import flow, Material preview, and LINE channel plugin.
- Existing Materials remain valid.
- Rollback can remove the import UI and reject new `line_flex_template` creation. Existing imported materials would become unsendable until the feature is restored or converted.

## Open Questions

- Should `line_flex_showcase` be formally added to the main `material-system` spec in this change, or handled as a separate spec sync?
- Should the import UI be under `/dashboard/marketing/materials/new` as an advanced LINE type card, or a separate `/dashboard/marketing/materials/import/line-flex` route?
- Should field filling at send time require all `required` fields immediately, or allow saving drafts with missing values and only enforce on preview/send?
