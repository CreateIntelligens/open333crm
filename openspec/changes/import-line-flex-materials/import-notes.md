## LINE Flex Material Import Notes

### Accepted Input Shapes

The importer accepts a complete LINE Flex message payload:

```json
{
  "type": "flex",
  "altText": "Sale",
  "contents": {
    "type": "bubble",
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [{ "type": "text", "text": "Sale" }]
    }
  }
}
```

It also accepts raw Flex contents:

```json
{
  "type": "carousel",
  "contents": [
    {
      "type": "bubble",
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [{ "type": "text", "text": "Page 1" }]
      }
    }
  ]
}
```

Both shapes are normalized into a `line_flex_template` Material body:

```ts
{
  altText: string;
  contents: { type: 'bubble' | 'carousel'; ... };
  fields: FlexTemplateField[];
  editableContainers: FlexEditableContainer[];
  source?: { importedAt: string; format: 'message' | 'contents'; hash: string };
}
```

### Field Holes

Supported field kinds:

- `text`
- `image_url`
- `uri`
- `postback_data`
- `color`
- `number`
- `alt_text`

Each field stores a unique `key`, display `label`, JSON Pointer `path`, `kind`, `required`, optional `defaultValue`, optional `sampleValue`, and optional constraints. Creating a field replaces the target value with a `{{key}}` placeholder. Required fields are enforced before explicit render preview or send-helper output unless a default value is available.

### Editable Containers

Supported insertion rules:

- `box.contents` can add `text`, `image`, `button`, `box`, `spacer`, and `separator`.
- `carousel.contents` can add `bubble`.
- Arbitrary object insertion and unsupported child kinds are rejected.
- After insertion, editable containers are recomputed and existing fields are marked invalid if their JSON Pointer no longer points to a supported leaf value.

### API Surface

- `POST /marketing/materials/line-flex/validate`
- `POST /marketing/materials/line-flex/import`
- `PATCH /marketing/materials/:id/line-flex/fields`
- `POST /marketing/materials/:id/line-flex/insert`
- `POST /marketing/materials/:id/line-flex/render-preview`

### Archive Sync Notes

When archiving this change:

- Sync `line-flex-material-import` into the permanent specs with accepted JSON shapes, field-hole behavior, render requirements, and controlled insertion rules.
- Sync `material-system` so the fixed LINE content type catalog includes `line_flex_template`.
- Keep `line_flex_showcase` as an existing editor/sample type and `line_flex_template` as the imported external Flex JSON type.
