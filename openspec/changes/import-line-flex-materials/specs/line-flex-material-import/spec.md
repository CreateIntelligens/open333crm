## ADDED Requirements

### Requirement: LINE Flex JSON Import
The system SHALL allow authenticated users to import external LINE Flex Message JSON as a tenant-scoped Material.

The import input MUST accept either a complete LINE message payload with `type="flex"` and `contents`, or a raw Flex `contents` object with `type="bubble"` or `type="carousel"`. The system MUST normalize the saved Material body to contain `altText`, `contents`, `fields`, and `editableContainers`.

#### Scenario: Import complete flex message payload
- **WHEN** an authenticated user imports `{ "type": "flex", "altText": "Sale", "contents": { "type": "bubble", ... } }`
- **THEN** the system validates the payload
- **AND** creates a Material with `channelType="line"` and `contentType="line_flex_template"`
- **AND** stores `body.altText="Sale"` and `body.contents.type="bubble"`

#### Scenario: Import raw flex contents
- **WHEN** an authenticated user imports `{ "type": "carousel", "contents": [{ "type": "bubble", ... }] }`
- **THEN** the system normalizes it as Flex contents
- **AND** requires or defaults an `altText` value before the Material is saved

#### Scenario: Reject unsupported flex root
- **WHEN** an authenticated user imports a JSON object whose normalized contents root is not `bubble` or `carousel`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_LINE_FLEX_PAYLOAD"`

### Requirement: Fillable Field Holes
The system SHALL allow users to mark supported Flex JSON values as fillable field holes.

Each field hole MUST include a unique `key`, display `label`, JSON Pointer `path`, field `kind`, `required` flag, and optional default/sample/constraint metadata. Creating a field hole MUST replace the value at the referenced path with a `{{key}}` placeholder in the stored Flex template.

Supported field kinds MUST include `text`, `image_url`, `uri`, `postback_data`, `color`, `number`, and `alt_text`.

#### Scenario: Create text field hole
- **WHEN** a user marks `/body/contents/0/text` as a fillable field with key `product_name`
- **THEN** `body.fields` contains a field with `key="product_name"` and `path="/body/contents/0/text"`
- **AND** the value at `/body/contents/0/text` in `body.contents` becomes `{{product_name}}`

#### Scenario: Reject duplicate field key
- **WHEN** a user attempts to save two field holes with the same `key`
- **THEN** the API returns HTTP 400 with `error.code="DUPLICATE_TEMPLATE_FIELD"`

#### Scenario: Reject unsupported field path
- **WHEN** a user marks a path that does not exist or points to an unsupported object node
- **THEN** the API returns HTTP 400 with `error.code="INVALID_TEMPLATE_FIELD_PATH"`

### Requirement: Render Imported Flex Template
The system SHALL render imported Flex template Materials by applying provided variable values to `body.altText` and `body.contents`.

Required fields MUST be validated before a send or explicit render preview succeeds. The outbound LINE payload MUST include only LINE message fields and MUST NOT include editor metadata such as `fields`, `editableContainers`, or `source`.

#### Scenario: Render preview with provided field values
- **WHEN** a user previews a `line_flex_template` Material with `{ "product_name": "Red Shirt" }`
- **THEN** the rendered preview replaces `{{product_name}}` inside `body.contents`
- **AND** the rendered payload remains a LINE Flex Message with `type="flex"`

#### Scenario: Reject missing required value
- **WHEN** a `line_flex_template` Material has a required field `product_name`
- **AND** the user renders it without a provided value or default value
- **THEN** the API returns HTTP 400 with `error.code="MISSING_TEMPLATE_FIELD_VALUE"`

#### Scenario: Send only flex payload fields
- **WHEN** the LINE channel plugin builds a message from a rendered `line_flex_template` Material
- **THEN** the outbound message has `type="flex"`, `altText`, and `contents`
- **AND** the outbound message does not include `fields`, `editableContainers`, or `source`

### Requirement: Controlled Flex Tree Component Insertion
The system SHALL allow users to add components only under approved Flex tree container paths.

The system MUST compute editable containers from the Flex tree and MUST restrict insertion by container type. `box.contents` containers MAY accept `text`, `image`, `button`, `box`, `spacer`, and `separator`. `carousel.contents` containers MAY accept `bubble`. The system MUST reject arbitrary JSON insertion and unsupported component types.

#### Scenario: Add text component to box contents
- **WHEN** a user adds a `text` component to an editable `box.contents` path
- **THEN** the system appends a valid default LINE Flex text component at that path
- **AND** recomputes the field and editable-container lists for the updated tree

#### Scenario: Add bubble to carousel contents
- **WHEN** a user adds a `bubble` component to an editable `carousel.contents` path
- **THEN** the system appends a valid default bubble to the carousel
- **AND** the rendered Flex contents root remains `carousel`

#### Scenario: Reject unsupported insertion
- **WHEN** a user attempts to add a `bubble` under a `box.contents` path
- **THEN** the API returns HTTP 400 with `error.code="DISALLOWED_FLEX_TREE_INSERTION"`

### Requirement: Import UI Workflow
The system SHALL provide a LINE Flex import workflow in the Material management UI.

The workflow MUST let users paste JSON or import a `.json` file, preview validation errors, configure field holes, configure allowed tree insertions through UI controls, preview the rendered Flex Material, and save it as a Material.

#### Scenario: Create imported material from UI
- **WHEN** a user opens the LINE Flex import workflow, pastes valid Flex JSON, marks fields, and saves
- **THEN** the user is returned to the Material detail or edit view for the created `line_flex_template` Material

#### Scenario: Show validation errors before save
- **WHEN** a user pastes invalid Flex JSON in the import workflow
- **THEN** the UI displays the validation error returned by the API
- **AND** the save action remains unavailable until the payload is valid
