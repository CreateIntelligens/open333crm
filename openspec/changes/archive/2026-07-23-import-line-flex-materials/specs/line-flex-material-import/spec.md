## ADDED Requirements

### Requirement: LINE Flex JSON Import
The system SHALL allow authenticated users to import external LINE Flex Message JSON as a tenant-scoped Material by pasting JSON produced by LINE Flex Simulator or uploading a `.json` file.

The import input MUST accept either:
- a complete LINE Flex message payload with `type="flex"`, `altText`, and `contents`
- a raw Flex contents object with `type="bubble"` or `type="carousel"`

The system MUST normalize the saved Material body to a pure LINE Flex message shape:

```json
{
  "type": "flex",
  "altText": "新品優惠",
  "contents": {
    "type": "bubble"
  }
}
```

The saved `line_flex_template` Material body MUST NOT include editor metadata such as `fields`, `editableContainers`, `source`, fillable-field definitions, or tree-editing metadata.

#### Scenario: Import complete flex message payload
- **WHEN** an authenticated user imports `{ "type": "flex", "altText": "Sale", "contents": { "type": "bubble", ... } }`
- **THEN** the system validates the payload
- **AND** creates a Material with `channelType="line"` and `contentType="line_flex_template"`
- **AND** stores `body.type="flex"`, `body.altText="Sale"`, and `body.contents.type="bubble"`
- **AND** stores no `fields`, `editableContainers`, or `source` metadata on the Material body

#### Scenario: Import raw flex contents
- **WHEN** an authenticated user imports `{ "type": "carousel", "contents": [{ "type": "bubble", ... }] }`
- **THEN** the system normalizes it to `{ "type": "flex", "altText": <provided or default>, "contents": <raw contents> }`
- **AND** creates a Material with `contentType="line_flex_template"`

#### Scenario: Reject unsupported flex root
- **WHEN** an authenticated user imports a JSON object whose normalized contents root is not `bubble` or `carousel`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_LINE_FLEX_PAYLOAD"`

### Requirement: LINE Validate API Draft Validation
The system SHALL validate imported Flex drafts against the LINE Messaging API before accepting the draft into the editor.

Draft validation MUST normalize the pasted JSON, then call LINE's reply message validation endpoint using an active tenant LINE channel access token:

`POST https://api.line.me/v2/bot/message/validate/reply`

The request body MUST contain a `messages` array with the normalized Flex message object. The endpoint MUST surface LINE validation failures to the frontend as an API error message so users can correct their pasted JSON.

#### Scenario: Validate draft with LINE API
- **WHEN** a user clicks "驗證並匯入" after pasting a Flex JSON payload
- **THEN** the API normalizes the payload into a LINE Flex message
- **AND** calls LINE `/v2/bot/message/validate/reply` with `{ "messages": [<normalized flex message>] }`
- **AND** returns the normalized body when LINE validation succeeds

#### Scenario: Surface LINE validation error
- **WHEN** LINE validation returns an error body with `message` and `details`
- **THEN** the API returns HTTP 400 with `error.code="LINE_FLEX_VALIDATE_FAILED"`
- **AND** the frontend displays the returned error message in the import workflow

#### Scenario: Missing active LINE channel
- **WHEN** a tenant has no active LINE channel or no `channelAccessToken`
- **THEN** the API returns HTTP 400 and explains that LINE validation cannot run

### Requirement: Renderer-Based Flex Preview
The system SHALL render imported LINE Flex materials in the frontend using `line-flex-message-renderer`.

The preview UI MUST wrap `FlexMessagePreview` in `LineChatFrame` and render the current normalized Flex contents. The preview MUST accept both saved full Flex message bodies and legacy raw `bubble` / `carousel` shapes for compatibility.

#### Scenario: Preview imported Flex draft
- **WHEN** the user validates and imports a Flex JSON payload in the Material editor
- **THEN** the editor updates the current Material draft
- **AND** the preview renders with `LineChatFrame` and `FlexMessagePreview`

#### Scenario: Preview saved Flex material
- **WHEN** a user opens an existing `line_flex_template` Material
- **THEN** the editor displays the saved custom Flex JSON, not `DEFAULT_IMPORT_JSON`
- **AND** the preview renders the saved `body.contents`

### Requirement: Direct Simulator JSON Workflow
The system SHALL direct users to edit Flex structure in LINE Flex Simulator and paste the finished JSON into the CRM.

The CRM import workflow MUST provide a link to `https://developers.line.biz/flex-simulator/`. It MUST NOT expose fillable-field editing, tree-structure component insertion, or rendered-variable preview controls for `line_flex_template`.

#### Scenario: Import workflow links to simulator
- **WHEN** the user opens the `line_flex_template` editor
- **THEN** the UI shows a LINE Flex Simulator link
- **AND** provides JSON paste and `.json` upload controls

#### Scenario: Advanced local editing controls are absent
- **WHEN** the user opens the `line_flex_template` editor
- **THEN** the UI does not show "可填欄位", tree-structure add-component controls, or rendered-variable preview controls

### Requirement: Send Pure Flex Payload
The system SHALL send `line_flex_template` materials to LINE as the saved normalized Flex message body.

The LINE channel plugin MUST send only LINE message fields such as `type`, `altText`, `contents`, and optional `quickReply`. Delivery-control fields such as `strategy`, `replyToken`, `recipientUids`, and `audienceGroupId` MUST NOT be included inside the Flex message object sent to LINE.

#### Scenario: Send imported Flex material
- **WHEN** the LINE channel plugin builds a message from a `line_flex_template` Material
- **THEN** the outbound message has `type="flex"`, `altText`, and `contents`
- **AND** the outbound message does not include editor metadata or delivery-control fields
