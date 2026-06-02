## Purpose

Define the tenant-scoped reusable Material system for LINE and Facebook native message content. This spec fixes the supported content type catalog, direct Material authoring model, channel-specific rich content structures, and removed legacy universal/template-driven paths.

## Requirements

### Requirement: ContentType Catalog

The system SHALL recognize a fixed enumeration of `contentType` values, organized into two channel-specific categories. Universal cross-channel content types are not supported.

| Category | Values |
|---|---|
| LINE | `line_text`, `line_image`, `line_carousel`, `line_imagemap`, `line_video` |
| FB | `fb_text`, `fb_image`, `fb_video`, `fb_generic`, `fb_button`, `fb_media`, `fb_coupon`, `fb_receipt`, `fb_feedback` |

A Material's `channelType` MUST match its `contentType` prefix:
- `line_*` -> `channelType=line`
- `fb_*` -> `channelType=fb`

The following legacy contentTypes are no longer supported:
- `text`, `image`, `video`
- `universal_text`, `universal_image`, `universal_video`, `universal_card`, `universal_carousel`, `universal_buttons`
- `line_flex_restaurant`, `line_flex_apparel`, `line_flex_hotel`, `line_flex_local_search`, `line_flex_real_estate`, `line_flex_social`, `line_flex_todo`, `line_flex_transit`, `line_flex_receipt`, `line_flex_shopping`, `line_flex_menu`, `line_flex_ticket`
- legacy fallbacks `flex`, `quick_reply`, `fb_carousel`, `template`

`line_imagemap` is supported only with the structure defined in this spec.

#### Scenario: Reject deprecated contentType
- **WHEN** a user POSTs a Material with `contentType: "line_flex_restaurant"` or `contentType: "universal_card"`
- **THEN** the API returns HTTP 400 with `error.code="DEPRECATED_CONTENT_TYPE"` or `INVALID_CONTENT_TYPE`

#### Scenario: Accept new LINE-specific contentType
- **WHEN** a user POSTs `{ channelType: "line", contentType: "line_carousel", body: {...} }`
- **THEN** the Material is created successfully

### Requirement: Material as Reusable Sendable Content Unit

The system SHALL provide a `Material` entity that represents a tenant-scoped, named, reusable sendable content unit. Material no longer requires a source template; users build Material directly by selecting a content type.

A Material MUST contain:
- `tenantId`
- `name`
- `channelType` in { `line`, `fb` }
- `contentType` from the ContentType Catalog
- `body` as JSON, with structure depending on `contentType`

A Material MAY contain:
- `templateId` as an optional FK to source `MessageTemplate`
- `variables` as a retained data-layer JSON array
- `description`, `category`, `previewImageUrl`, `isActive`, `usageCount`, `lastUsedAt`, `createdById`

The `targetChannels` field on Material is deprecated.

#### Scenario: Create Material without templateId
- **WHEN** an authenticated user POSTs `/api/v1/marketing/materials` with `{ channelType: "line", contentType: "line_text", body: { text: "Hello" }, name: "Greeting" }` and no `templateId`
- **THEN** a new Material is created with `templateId=null`
- **AND** the response is HTTP 201

#### Scenario: Reject Material with universal channelType
- **WHEN** a user POSTs a Material with `channelType: "universal"`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_CHANNEL_TYPE"`

### Requirement: LINE Multi-Page Message

The system SHALL support `line_carousel` contentType, which represents LINE's multi-page carousel message. Each carousel has one or more pages of a single `pageType`.

Supported `pageType` values:
- `product`
- `location`
- `person`
- `image_text`

Each pageType has a fixed schema. All pageTypes share:
- `imageUrl`, optional but recommended
- `action1` and optional `action2`

The carousel MAY include an optional `endPage` with image and action.

#### Scenario: Create line_carousel with product pages
- **WHEN** a user POSTs a Material with `contentType=line_carousel`, `body.pageType="product"`, `body.pages=[{ imageUrl, title, price, action1 }, ...]`
- **THEN** the Material is created and stored with the page list intact

#### Scenario: Channel plugin converts line_carousel to LINE Flex Carousel
- **GIVEN** a Material with `contentType=line_carousel` and 3 product pages
- **WHEN** the LINE channel plugin's `buildLineMessage()` is called
- **THEN** the output is a LINE Flex Message of type=flex / contents.type=carousel with 3 bubbles
- **AND** each bubble reflects the product page's fields

### Requirement: LINE Imagemap Message

The system SHALL support `line_imagemap` contentType for LINE imagemap messages. The base image is fixed-width 1040px; height varies by selected layout.

A Material body MUST contain:
- `baseImageUrl`
- `layoutId`, one of the preset layouts or `custom`
- `width`, always 1040
- `height`, matching layout
- `areas`, an array of clickable regions with `x`, `y`, `width`, `height`, and `action`

The preset layouts are categorized as square, horizontal, vertical, or custom. Each preset has fixed default area coordinates that the user can adjust.

#### Scenario: Create line_imagemap with preset layout
- **WHEN** a user selects layout `sq_4grid` and configures 4 area actions
- **THEN** the Material body contains `layoutId="sq_4grid"`, `width=1040`, `height=1040`, and `areas` with 4 entries

#### Scenario: Create line_imagemap with custom layout
- **WHEN** a user uploads a custom-height image and defines 3 areas
- **THEN** the Material body contains `layoutId="custom"`, matching dimensions, and 3 user-defined area entries

#### Scenario: Channel plugin converts line_imagemap to LINE imagemap message
- **GIVEN** a Material with `contentType=line_imagemap` and a baseImageUrl plus areas
- **WHEN** the LINE channel plugin sends the message
- **THEN** the outbound LINE API payload has type=imagemap with baseUrl, baseSize, and actions per area

### Requirement: LINE Advanced Video Message

The system SHALL support `line_video` contentType for LINE advanced video messages.

Body MUST contain:
- `videoUrl`
- `previewImageUrl`
- `endCard.imageUrl`
- `endCard.action`
- `endCard.label`

Body MAY contain `trackingId` for LINE analytics.

#### Scenario: Channel plugin converts line_video to LINE video message
- **GIVEN** a Material with `contentType=line_video`
- **WHEN** sent via LINE plugin
- **THEN** the outbound message has type=video with originalContentUrl, previewImageUrl, and trackingId

### Requirement: Action Configuration

The system SHALL support 3 action types in carousel, imagemap, and video UI editors.

| Action type | Required fields | Limits |
|---|---|---|
| `message` | `text` | text <= 300 |
| `uri` | `uri` | uri <= 1000; scheme in {http, https, line, tel} |
| `postback` | `data` | data <= 300; displayText <= 300 optional |

The `datetimepicker` and `clipboard` action types are not exposed by these UI editors. The schema may still accept them for forward compatibility.

#### Scenario: Reject uri action with invalid scheme
- **WHEN** the body contains `{ type: "uri", uri: "ftp://x", label: "go" }`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_URI_SCHEME"`

### Requirement: Universal Card Converter Is Removed

The universal converter SHALL NOT be used for Material delivery. Universal contentTypes are no longer supported. Channel plugins SHALL handle only their own native content types.

#### Scenario: Universal contentType is rejected
- **WHEN** a user creates or sends a Material with `contentType="universal_card"`
- **THEN** the request is rejected before channel plugin dispatch

### Requirement: No System Templates Seeded on Database Bootstrap

The system SHALL seed zero system templates for the Material flow. Materials are created directly by content type selection, without forking from a template.

The `MessageTemplate` model and `materials.templateId` FK remain in the schema for legacy compatibility.

#### Scenario: Material creation starts from content type
- **WHEN** a user opens the Material creation flow
- **THEN** the user selects channel and content type directly
- **AND** no system template is required

### Requirement: Visual Material Editor for line_flex Types Is Removed

The system SHALL NOT expose the structure-tree editor for `line_flex_*` contentTypes. Users build LINE rich content via `line_carousel` or `line_imagemap`.

#### Scenario: line_flex editor unavailable
- **WHEN** a user opens the Material creation flow
- **THEN** no `line_flex_*` content type is offered
