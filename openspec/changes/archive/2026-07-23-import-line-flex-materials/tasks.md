## 1. Shared Flex Template Utilities

- [x] 1.1 Add shared TypeScript types for `LineFlexTemplateBody`, `FlexTemplateField`, and `FlexEditableContainer`
- [x] 1.2 Implement Flex JSON normalization for complete `type=flex` payloads and raw `bubble` / `carousel` contents
- [x] 1.3 Implement Flex template validation for root type, payload size, `altText`, field keys, field paths, and editable container paths
- [x] 1.4 Implement JSON Pointer get/set helpers with tests for arrays, escaped segments, missing paths, and immutable updates
- [x] 1.5 Implement field-hole creation that replaces supported leaf values with `{{key}}` placeholders
- [x] 1.6 Implement editable-container extraction for `box.contents` and `carousel.contents`
- [x] 1.7 Implement controlled component insertion for `text`, `image`, `button`, `box`, `spacer`, `separator`, and `bubble`
- [x] 1.8 Recompute or invalidate field/container metadata after structural mutations

## 2. API Material Import

- [x] 2.1 Add `line_flex_template` to material content type constants and Zod validation
- [x] 2.2 Add API schemas for import, validate, field-hole update, tree insertion, and render-preview payloads
- [x] 2.3 Add a service function to import normalized Flex JSON into a tenant-scoped Material
- [x] 2.4 Add a service function to validate a draft imported Flex template without saving
- [x] 2.5 Add a service function to update `body.fields` and placeholder values by JSON Pointer
- [x] 2.6 Add a service function to insert allowed components into approved Flex tree containers
- [x] 2.7 Enforce required field values before explicit render preview or send-helper output
- [x] 2.8 Wire routes under marketing materials with existing authentication and tenant scoping

## 3. LINE Channel Plugin

- [x] 3.1 Add `line_flex_template` handling to `buildLineMessage()`
- [x] 3.2 Ensure outbound LINE payload includes only `type`, `altText`, `contents`, and optional quick reply
- [x] 3.3 Add channel plugin tests for bubble and carousel imported templates
- [x] 3.4 Add tests proving metadata fields are not sent to LINE

## 4. Web Import Workflow

- [x] 4.1 Add a LINE advanced import entry from the Material creation flow
- [x] 4.2 Build JSON paste and `.json` file import UI with API validation feedback
- [x] 4.3 Build Flex tree/field list UI that lets users mark supported values as fillable holes
- [x] 4.4 Build field settings UI for key, label, kind, required, default value, constraints, and sample value
- [x] 4.5 Build controlled component insertion controls for allowed tree containers
- [x] 4.6 Add imported Flex preview using rendered `altText` and `contents`
- [x] 4.7 Add `line_flex_template` support to MaterialEditor dispatch, default bodies, labels, thumbnails, and MaterialPreview
- [x] 4.8 Ensure invalid JSON, duplicate keys, missing required values, and disallowed insertion states are visible in the UI

## 5. Tests And Validation

- [x] 5.1 Add API tests for importing complete Flex message payloads and raw Flex contents
- [x] 5.2 Add API tests for invalid root type, duplicate field keys, invalid paths, and unsupported insertions
- [x] 5.3 Add render tests for required fields, default values, and provided value override
- [x] 5.4 Add web type coverage for the import workflow components
- [x] 5.5 Run `pnpm --filter @open333crm/api exec tsx` for the relevant material import tests
- [x] 5.6 Run `pnpm --filter @open333crm/channel-plugins build`
- [x] 5.7 Run `pnpm --filter @open333crm/web exec tsc --noEmit`
- [x] 5.8 Run `openspec validate import-line-flex-materials --strict`

## 6. Documentation And Archive Prep

- [x] 6.1 Document the accepted external Flex JSON shapes and example import payloads
- [x] 6.2 Document the supported field kinds and editable component insertion rules
- [x] 6.3 Add archive notes for syncing `line-flex-material-import` and `material-system` specs
