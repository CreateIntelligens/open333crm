## MODIFIED Requirements

### Requirement: ContentType Catalog

The system SHALL recognize a fixed enumeration of `contentType` values, organized into two channel-specific categories (no more "universal" cross-channel types).

| Category | Values |
|---|---|
| LINE | `line_text`, `line_image`, `line_carousel`, `line_imagemap`, `line_video` |
| FB | `fb_text`, `fb_image`, `fb_video`, `fb_generic`, `fb_button`, `fb_media`, `fb_coupon`, `fb_receipt`, `fb_feedback` |

A Material's `channelType` MUST match its `contentType` prefix:
- `line_*` → `channelType=line`
- `fb_*` → `channelType=fb`

The following legacy contentTypes from the original `add-material-system` change are **NO LONGER SUPPORTED**:
- `text`, `image`, `video` (basic, channel-agnostic)
- `universal_text`, `universal_image`, `universal_video`, `universal_card`, `universal_carousel`, `universal_buttons`
- `line_flex_restaurant`, `line_flex_apparel`, `line_flex_hotel`, `line_flex_local_search`, `line_flex_real_estate`, `line_flex_social`, `line_flex_todo`, `line_flex_transit`, `line_flex_receipt`, `line_flex_shopping`, `line_flex_menu`, `line_flex_ticket`
- `line_imagemap` (re-introduced with proper structure; existing meaning replaced)
- `flex`, `quick_reply`, `fb_carousel`, `template` (legacy fallbacks)

#### Scenario: Reject deprecated contentType
- **WHEN** a user POSTs a Material with `contentType: "line_flex_restaurant"` or `contentType: "universal_card"`
- **THEN** the API returns HTTP 400 with `error.code="DEPRECATED_CONTENT_TYPE"` or `INVALID_CONTENT_TYPE`

#### Scenario: Accept new LINE-specific contentType
- **WHEN** a user POSTs `{ channelType: "line", contentType: "line_carousel", body: {...} }`
- **THEN** the Material is created successfully

### Requirement: Material as Reusable Sendable Content Unit

The system SHALL provide a `Material` entity that represents a tenant-scoped, named, reusable sendable content. Material no longer requires a source template; users build Material directly by selecting a content type.

A Material MUST contain:
- `tenantId` (required)
- `name` (required)
- `channelType` ∈ { `line`, `fb` } (universal no longer allowed)
- `contentType` (from the ContentType Catalog above)
- `body` (JSON, structure depends on contentType)

A Material MAY contain:
- `templateId` (FK to source `MessageTemplate`; **now optional** — Material can be created without referencing a template)
- `variables` (JSON array; data layer retained even though UI is removed in this change)
- `description`, `category`, `previewImageUrl`, `isActive`, `usageCount`, `lastUsedAt`, `createdById`

The `targetChannels` field on Material is **deprecated** (was only meaningful for `channelType=universal`).

#### Scenario: Create Material without templateId
- **WHEN** an authenticated user POSTs `/api/v1/marketing/materials` with `{ channelType: "line", contentType: "line_text", body: { text: "Hello" }, name: "Greeting" }` and no `templateId`
- **THEN** a new Material is created with `templateId=null`
- **AND** the response is HTTP 201

#### Scenario: Reject Material with universal channelType
- **WHEN** a user POSTs a Material with `channelType: "universal"`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_CHANNEL_TYPE"`

## ADDED Requirements

### Requirement: LINE Multi-Page Message (line_carousel)

The system SHALL support `line_carousel` contentType, which represents LINE's "多頁訊息" (Carousel). Each carousel has 1+ pages of a single `pageType`.

Supported `pageType` values:
- `product` (商品服務)
- `location` (地點)
- `person` (人物)
- `image_text` (圖文)

Each pageType has a fixed schema (see design.md for full field list). All pageTypes share:
- `imageUrl` (optional but recommended)
- `action1` and optional `action2` (ActionConfig)

The carousel MAY include an optional `endPage` (結尾頁) with image + action.

#### Scenario: Create line_carousel with product pages
- **WHEN** a user POSTs a Material with `contentType=line_carousel`, `body.pageType="product"`, `body.pages=[{ imageUrl, title, price, action1 }, ...]`
- **THEN** the Material is created and stored with the page list intact

#### Scenario: Channel plugin converts line_carousel to LINE Flex Carousel
- **GIVEN** a Material with `contentType=line_carousel` and 3 product pages
- **WHEN** the LINE channel plugin's `buildLineMessage()` is called
- **THEN** the output is a LINE Flex Message of type=flex / contents.type=carousel with 3 bubbles
- **AND** each bubble reflects the product page's fields (hero image, title, price, footer buttons)

### Requirement: LINE Imagemap Message (line_imagemap)

The system SHALL support `line_imagemap` contentType for LINE's "圖文訊息" (Rich Message / Imagemap). The base image is fixed-width 1040px; height varies by selected layout (350, 585, 700, 1040, 1300, 1850, or custom 520-2080).

A Material body MUST contain:
- `baseImageUrl` (required)
- `layoutId` (required; one of the 28 preset layouts OR "custom")
- `width` (always 1040)
- `height` (matches layout)
- `areas` (array of clickable regions, each with `x/y/width/height` and `action`)

The 28 preset layouts are categorized as 正方形 (12), 橫長 (7), 縱長 (8), 自訂 (1). Each preset has fixed default area coordinates that the user can adjust via cropper UI.

#### Scenario: Create line_imagemap with preset layout
- **WHEN** a user selects layout `sq_4grid` and configures 4 area actions
- **THEN** the Material body contains `layoutId="sq_4grid"`, `width=1040`, `height=1040`, and `areas` with 4 entries

#### Scenario: Create line_imagemap with custom layout
- **WHEN** a user uploads a custom-height image (e.g., 1040×1500) and uses cropper to define 3 areas
- **THEN** the Material body contains `layoutId="custom"`, the matching dimensions, and 3 user-defined area entries

#### Scenario: Channel plugin converts line_imagemap to LINE imagemap message
- **GIVEN** a Material with `contentType=line_imagemap` and a baseImageUrl + areas
- **WHEN** the LINE channel plugin sends the message
- **THEN** the outbound LINE API payload has type=imagemap with the baseUrl, baseSize, and actions per area

### Requirement: LINE Advanced Video Message (line_video)

The system SHALL support `line_video` contentType for LINE's "進階影片訊息".

Body MUST contain:
- `videoUrl` (mp4 URL)
- `previewImageUrl` (thumbnail shown before play)
- `endCard.imageUrl` (image shown after video ends)
- `endCard.action` (ActionConfig)
- `endCard.label` (CTA button text)

Body MAY contain `trackingId` for LINE analytics.

#### Scenario: Channel plugin converts line_video to LINE video message
- **GIVEN** a Material with `contentType=line_video`
- **WHEN** sent via LINE plugin
- **THEN** the outbound message has type=video with originalContentUrl, previewImageUrl, and trackingId; the endCard is embedded as a follow-up flex message OR within the video message's altText (depending on LINE API spec)

### Requirement: Action Configuration (Simplified)

The system SHALL support 3 action types in this change (down from 5 in `add-material-system`):

| Action type | Required fields | Limits |
|---|---|---|
| `message` | `text` | text ≤ 300 |
| `uri` | `uri` | uri ≤ 1000; scheme ∈ {http, https, line, tel} |
| `postback` | `data` | data ≤ 300; displayText ≤ 300 (optional) |

The `datetimepicker` and `clipboard` action types from the previous spec are **NOT** supported in carousel/imagemap/video UI editors in this change. The schema still accepts them (forward compatibility) but the UI does not expose them.

#### Scenario: Reject uri action with invalid scheme
- **WHEN** the body contains `{ type: "uri", uri: "ftp://x", label: "go" }`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_URI_SCHEME"`

## REMOVED Requirements

### Requirement: Universal Card Converter (removed)

**Removed**: The universal converter (`packages/channel-plugins/src/universal/converter.ts`) is deleted. Universal contentTypes (`universal_*`) are no longer supported. Channel plugins (`buildLineMessage()` / `buildFbMessage()`) no longer dispatch to a universal converter; each channel handles only its own native content types.

### Requirement: System Templates Seeded on Database Bootstrap (replaced)

**Replaced**: The original spec required 27 system templates (basic 3 + universal 6 + LINE Flex 12 + FB 6). This is replaced with **0 system templates**. Materials are created directly by content type selection, without forking from a template. The `MessageTemplate` model and `materials.templateId` FK remain in the schema for legacy reasons but are unused by the new UI flow.

### Requirement: Visual Material Editor for line_flex_* (removed)

**Removed**: The structure-tree editor for `line_flex_*` (Restaurant / Apparel / Hotel / ... 12 templates) is deleted. These contentTypes are no longer valid. Users build LINE rich content via `line_carousel` (form-based) or `line_imagemap` (cropper-based) instead.
