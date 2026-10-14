## Purpose

Define the tenant-scoped reusable Material system for LINE and Facebook native message content. This spec fixes the supported content type catalog, direct Material authoring model, channel-specific rich content structures, and removed legacy universal/template-driven paths.

## Requirements

### Requirement: ContentType Catalog

The system SHALL recognize a fixed enumeration of `contentType` values, organized into two channel-specific categories. Universal cross-channel content types are not supported.

| Category | Values |
|---|---|
| LINE | `line_text`, `line_image`, `line_carousel`, `line_imagemap`, `line_video`, `line_flex_template` |
| FB | `fb_text`, `fb_image`, `fb_video`, `fb_generic`, `fb_button`, `fb_media`, `fb_coupon`, `fb_receipt`, `fb_feedback` |

A Material's `channelType` MUST match its `contentType` prefix:
- `line_*` -> `channelType=line`
- `fb_*` -> `channelType=fb`

The following legacy contentTypes are no longer supported:
- `text`, `image`, `video`
- `universal_text`, `universal_image`, `universal_video`, `universal_card`, `universal_carousel`, `universal_buttons`
- `line_flex_restaurant`, `line_flex_apparel`, `line_flex_hotel`, `line_flex_local_search`, `line_flex_real_estate`, `line_flex_social`, `line_flex_todo`, `line_flex_transit`, `line_flex_receipt`, `line_flex_shopping`, `line_flex_menu`, `line_flex_ticket`
- legacy fallbacks `flex`, `quick_reply`, `fb_carousel`, `template`

`line_imagemap` is supported only with the structure defined in this spec. `line_flex_template` is supported only as imported LINE Flex Message JSON using the `line-flex-material-import` capability.

#### Scenario: Reject deprecated contentType
- **WHEN** a user POSTs a Material with `contentType: "line_flex_restaurant"` or `contentType: "universal_card"`
- **THEN** the API returns HTTP 400 with `error.code="DEPRECATED_CONTENT_TYPE"` or `INVALID_CONTENT_TYPE`

#### Scenario: Accept new LINE-specific contentType
- **WHEN** a user POSTs `{ channelType: "line", contentType: "line_carousel", body: {...} }`
- **THEN** the Material is created successfully

#### Scenario: Accept imported LINE Flex template contentType
- **WHEN** a user POSTs `{ channelType: "line", contentType: "line_flex_template", body: { "type": "flex", "altText": "Sale", "contents": {...} } }`
- **THEN** the Material is created successfully after LINE Flex import validation passes

#### Scenario: Reject LINE Flex template with FB channel
- **WHEN** a user POSTs `{ channelType: "fb", contentType: "line_flex_template", body: {...} }`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_CHANNEL_CONTENT_TYPE"`

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

### Requirement: Legacy Preset Flex Editors Are Removed

The system SHALL NOT expose legacy preset structure-tree editors for `line_flex_*` contentTypes. Users build predefined LINE rich content via `line_carousel` or `line_imagemap`, or import finished LINE Flex Simulator JSON via `line_flex_template`.

#### Scenario: legacy line_flex preset editors unavailable
- **WHEN** a user opens the Material creation flow
- **THEN** legacy preset content types such as `line_flex_restaurant` and `line_flex_apparel` are not offered
- **AND** `line_flex_template` remains available for imported Flex JSON

### Requirement: Nested Material Categories

The system SHALL provide tenant-scoped, hierarchical material categories via a `MaterialCategory` entity supporting a single parent (`parentId`, nullable) so categories form a tree. Materials reference a category via `categoryId` (nullable). Categories and materials SHALL be freely re-assignable (movable) between categories. Moving a category under one of its own descendants SHALL be rejected to prevent cycles.

#### Scenario: Create a child category

- **WHEN** a user with `marketing.manage` creates a category "雙11檔期" with parent "行銷活動"
- **THEN** the category is created tenant-scoped with `parentId` set to the parent category
- **AND** it appears nested under its parent in the category tree

#### Scenario: Move a material to another category

- **WHEN** a user changes a material's `categoryId` to a different category
- **THEN** the material is re-assigned and appears under the new category in the list

#### Scenario: Reject moving a category into its own descendant

- **WHEN** a user attempts to set a category's `parentId` to one of its own descendant categories
- **THEN** the system rejects the move with a validation error and the tree is unchanged

#### Scenario: Deleting a category does not delete its materials

- **WHEN** a category containing materials is deleted
- **THEN** the category is removed and each affected material's `categoryId` is set to null (materials are retained, not deleted)

#### Scenario: Category is tenant-isolated

- **WHEN** tenant A queries the category tree
- **THEN** only tenant A's categories are returned and tenant B's categories are never visible

### Requirement: Material Tags

The system SHALL support multiple free-form tags per material stored as `Material.tags` (string array). The set of available tenant tags SHALL be derived by aggregating distinct tags across that tenant's materials (no separate tag table). Tags are tenant-scoped and orthogonal to categories.

#### Scenario: Tag a material

- **WHEN** a user with `marketing.manage` adds tags ["促銷", "會員"] to a material
- **THEN** the material stores both tags and they become selectable filters for that tenant

#### Scenario: Aggregate tenant tag list

- **WHEN** the tag list endpoint is queried
- **THEN** it returns the distinct union of tags across the tenant's materials

### Requirement: Material List Filtering and Sorting

The list endpoint SHALL support composite filtering by `categoryId`, `tags` (match materials having any of the given tags), `channelType`, `status`, and a name/description keyword, combinable in a single query. It SHALL support a `sort` selection among: most-recently-used (`lastUsedAt`), most-used (`usageCount`), recently-updated (`updatedAt`), and name.

#### Scenario: Filter by category and tag together

- **WHEN** a user filters by category "行銷活動" and tag "促銷"
- **THEN** only materials in that category (or its subtree, per implementation) that carry the tag are returned

#### Scenario: Sort by most-recently-used

- **WHEN** a user selects the "最近使用" sort
- **THEN** materials are ordered by `lastUsedAt` descending, with never-used materials ordered last

### Requirement: Material Last-Used Display

The material list SHALL surface each material's existing `lastUsedAt` value. Materials never used SHALL display an explicit "—" (not a fabricated timestamp).

#### Scenario: Show last-used time

- **WHEN** a material was last sent 2 hours ago
- **THEN** the list row shows a relative "2 小時前" (or equivalent) for that material

#### Scenario: Never-used material

- **WHEN** a material has null `lastUsedAt`
- **THEN** the list row shows "—" in the last-used column

### Requirement: Material Version History

The system SHALL retain a version snapshot each time a material is created or updated, via a `MaterialVersion` entity storing a monotonically increasing `versionNo`, a snapshot of `name` and `body`, the editing agent, and a timestamp. Users SHALL be able to view the version history and restore a prior version. Restoring SHALL write the selected version's `name`/`body` back onto the material AND create a new version entry (restore is itself an edit; linear history is preserved).

#### Scenario: Snapshot on update

- **WHEN** a user updates a material's body
- **THEN** a new `MaterialVersion` is written with the next `versionNo` capturing the submitted `name`/`body`

#### Scenario: View version history

- **WHEN** a user opens a material's version history
- **THEN** all versions are listed newest-first with `versionNo`, editor, and timestamp

#### Scenario: Restore a prior version

- **WHEN** a user restores version 2 of a material currently at version 5
- **THEN** the material's `name`/`body` are set to version 2's snapshot
- **AND** a new version 6 is created recording the restore

#### Scenario: Version history is tenant-isolated

- **WHEN** tenant A queries a material's versions
- **THEN** only versions belonging to tenant A's material are returned

### Requirement: Material-Level Performance Attribution

The system SHALL attribute usage and, where available, interaction outcomes to individual materials. Usage count and last-used time SHALL be surfaced per material. Interaction outcomes (e.g. reply count, cases opened) SHALL be derived by attributing broadcast recipient outcomes back to the source material. Where an interaction metric has no attributable data (e.g. no shortlink for click-through), the system SHALL display "暫無資料" rather than a fabricated zero.

#### Scenario: Show usage in list

- **WHEN** the material list renders
- **THEN** each row shows the material's usage count with a bar normalized against the tenant's maximum usage

#### Scenario: Attribute replies to a material

- **WHEN** a broadcast built from material M receives replies
- **THEN** material M's stats reflect the attributed reply count

#### Scenario: No attributable click data

- **WHEN** a material has no shortlink-based click attribution
- **THEN** the click-through metric displays "暫無資料", not 0

### Requirement: Material Display Status

The system SHALL provide a `Material.status` field (default `draft`) used for display and manual setting by `marketing.manage` users, with values `draft` and `approved` at minimum. This requirement covers display and manual state only; it does NOT define a submission/approval workflow (reviewer assignment, notifications, approve/reject actions), which is deferred to a separate change.

#### Scenario: Manually mark a material approved

- **WHEN** a user with `marketing.manage` sets a material's status to `approved`
- **THEN** the material's status is updated and the list shows an "已核准" badge

#### Scenario: Default status on creation

- **WHEN** a material is created without an explicit status
- **THEN** its status defaults to `draft` and the list shows a "草稿" badge

### Requirement: Material-Level Click Attribution

The system SHALL attribute short-link clicks back to the material that produced them, via a `materialId` reference on short links. `getMaterialStats` SHALL report click count and click-through rate for a material, derived from `ClickLog` records whose short link carries that material's id. When a material has no attributable click data (no material-tagged short links, or zero sends), the click-through rate SHALL be `null` (displayed as "暫無資料"), never a fabricated `0`.

#### Scenario: Clicks attributed to a material

- **WHEN** a broadcast built from material M sends a message whose URL was converted to a material-tagged short link, and a recipient clicks it
- **THEN** material M's stats reflect the click count

#### Scenario: Click-through rate computed from sends

- **WHEN** material M has 100 sends and 24 attributed clicks
- **THEN** its click-through rate is reported as 24%

#### Scenario: No attributable clicks returns null

- **WHEN** material M has no material-tagged short links or zero sends
- **THEN** click-through rate is `null`, shown as "暫無資料", not 0

### Requirement: Send-Time URL-to-Short-Link Conversion

When a broadcast sends a material, the system SHALL convert external action URLs in the material body into short links carrying the material's id, so clicks are attributable. Conversion SHALL be at the material level (one short link per material+URL, shared across recipients), SHALL reuse an existing short link for the same material+target URL rather than creating a new one each broadcast, and SHALL skip URLs that are already this system's short links (no double-wrapping). Materials without external URLs SHALL be unaffected.

#### Scenario: URL converted to material short link on broadcast

- **WHEN** a broadcast sends a material whose button action points to an external URL
- **THEN** the sent message's URL is a short link tagged with the material's id

#### Scenario: Existing short link reused

- **WHEN** the same material+target URL already has a short link
- **THEN** the broadcast reuses it rather than creating a duplicate

#### Scenario: Already-short URL not double-wrapped

- **WHEN** a material URL is already this system's short link
- **THEN** it is sent as-is, not wrapped again

### Requirement: LINE Imagemap Postback Limitation Is Explicit

The system SHALL make explicit (in the imagemap editor UI) that LINE imagemap actions support only uri / message / clipboard action types, not postback. When a postback-type action is configured on an imagemap area, the system currently degrades it to a message action; this degradation SHALL be surfaced to the user rather than applied silently.

#### Scenario: Imagemap editor states postback is unsupported

- **WHEN** a user edits an imagemap area's action
- **THEN** the editor indicates postback is not available for imagemap (only uri / message / clipboard)

### Requirement: LINE Video End-Card Is Documented Best-Effort

The system SHALL document that LINE native video messages do not include CTA buttons, and that the `line_video` end-card CTA is delivered as a best-effort wrapper (an additional message following the video). This behavior SHALL be preserved; the requirement only clarifies the documented intent so future maintainers do not treat it as a native video capability.

#### Scenario: End-card behavior is documented

- **WHEN** a maintainer reads the line_video send-conversion code
- **THEN** a comment explains the end-card is a best-effort wrapper, not native LINE video CTA

### Requirement: FB Material Required Fields And Lengths
When an `fb_*` material is created, or updated with a new body, the system SHALL reject with 400 naming the field a body that leaves a required field empty after trimming or exceeds a length limit: `fb_text` text (1–2000), `fb_button` text (1–640), card and coupon `title` (1–80), `subtitle` (≤80), button `title` (1–20), `fb_receipt` `recipient_name` and `order_number`.

#### Scenario: Empty required field
- **WHEN** a user saves an `fb_coupon` material whose `title` is empty
- **THEN** the system SHALL respond 400 naming `body.title` and SHALL NOT save the material

#### Scenario: Valid default content
- **WHEN** a user saves any `fb_*` material with the editor's default content
- **THEN** the material SHALL be saved

### Requirement: FB Material Card And Button Counts
An `fb_generic` material SHALL have 1 to 10 cards, each with at most 3 buttons; an `fb_button` material SHALL have 1 to 3 buttons; an `fb_media` material SHALL have at most 1 button. Otherwise the system SHALL respond 400 naming the field instead of letting the FB plugin silently drop the extra items when sending.

#### Scenario: Too many buttons
- **WHEN** a user saves an `fb_button` material with 4 buttons
- **THEN** the system SHALL respond 400 naming `body.buttons`

#### Scenario: No cards
- **WHEN** a user saves an `fb_generic` material with no cards
- **THEN** the system SHALL respond 400 naming `body.elements`

### Requirement: FB Material Button Types
Every button of an `fb_*` material SHALL have `type` `web_url` or `postback`; a `postback` button SHALL have a non-empty `payload`. Otherwise the system SHALL respond 400 naming the button field.

#### Scenario: Unsupported button type
- **WHEN** a user saves an `fb_button` material whose first button has `type = "phone_number"`
- **THEN** the system SHALL respond 400 naming `body.buttons.0.type`

### Requirement: FB Material URLs Use Safe Schemes
Every URL field of an `fb_*` material that is sent to FB (image and video `url`, card `image_url`, `web_url` button `url`, coupon `image_url`) SHALL be an `http://` or `https://` URL or a site path starting with a single `/`. Other values SHALL be rejected with 400 naming the field. `fb_image` and `fb_video` SHALL require a URL; `fb_media` SHALL require a URL or an `attachment_id`.

#### Scenario: javascript scheme
- **WHEN** a user saves an `fb_image` material with `url = "javascript:alert(1)"`
- **THEN** the system SHALL respond 400 naming `body.url`

#### Scenario: http URL without a host
- **WHEN** a user saves an `fb_image` material with `url = "http:///a.jpg"`
- **THEN** the system SHALL respond 400 naming `body.url` with a message saying a host must follow `http(s)://`

#### Scenario: Sample image path
- **WHEN** a user saves an `fb_generic` card whose `image_url` is `/material-samples/product.jpeg`
- **THEN** the material SHALL be saved

### Requirement: FB Material Numbers And Enumerations
When present, these `fb_*` fields SHALL use only these values, otherwise the system SHALL respond 400 naming the field: `fb_media` `media_type` is `image` or `video`; `fb_receipt` `currency` is three uppercase letters; `fb_feedback` `question_type` is `csat`, `nps` or `ces`, and `expires_in_days` is an integer from 1 to 7. `fb_receipt` `summary.total_cost` SHALL always be a number not less than 0.

#### Scenario: Negative total
- **WHEN** a user saves an `fb_receipt` material with `summary.total_cost = -1`
- **THEN** the system SHALL respond 400 naming `body.summary.total_cost`

#### Scenario: Feedback expiry out of range
- **WHEN** a user saves an `fb_feedback` material with `expires_in_days = 9999`
- **THEN** the system SHALL respond 400 naming `body.expires_in_days`

#### Scenario: Free-text media type
- **WHEN** a user saves an `fb_media` material with `media_type = "abc"`
- **THEN** the system SHALL respond 400 naming `body.media_type`

#### Scenario: Missing field shown with an editor default
- **WHEN** a user saves an `fb_receipt` material without `currency`, which the editor shows as `TWD`
- **THEN** the material SHALL be saved

### Requirement: Restoring An FB Material Version Is Validated
When a user restores an `fb_*` material to an earlier version, the system SHALL apply the FB content rules to that version's body and SHALL respond 400 without changing the material when the body does not comply.

#### Scenario: Restore a version saved before validation
- **WHEN** a user restores an `fb_coupon` material to a version whose `image_url` is `javascript:alert(1)`
- **THEN** the system SHALL respond 400 naming `body.image_url` and the material SHALL not change

### Requirement: LINE Form Material Errors Use Editor Field Names
When LINE rejects a `line_text`, `line_image`, `line_video`, `line_carousel` or `line_imagemap` material on save, the system SHALL respond 400 with a message that names the field by its editor label and states common LINE errors in Chinese, keeping the original text for fields or errors it cannot map. `line_flex_*` materials SHALL keep the LINE property path and original text. The raw LINE response SHALL stay in `details.line`.

#### Scenario: Empty text
- **WHEN** LINE rejects a `line_text` material with `messages[0].text: May not be empty`
- **THEN** the message SHALL be `素材格式不符合 LINE 規範：訊息內容不可空白`

#### Scenario: Carousel button link
- **WHEN** LINE rejects a `line_carousel` material with `/contents/0/footer/contents/0/action/uri: invalid uri scheme`
- **THEN** the message SHALL name `第 1 頁第 1 個按鈕的連結` and SHALL NOT contain `/contents/`

#### Scenario: Flex material keeps the property path
- **WHEN** LINE rejects a `line_flex_template` material with `/contents/0/hero/url: invalid uri scheme`
- **THEN** the message SHALL contain `/contents/0/hero/url`

### Requirement: LINE Carousel Page Limit Is Enforced On Save
A `line_carousel` material SHALL have at most 12 bubbles, counting its pages and its end page. Otherwise the system SHALL respond 400 naming `body.pages` instead of sending only the first 12.

#### Scenario: Thirteen bubbles
- **WHEN** a user saves a `line_carousel` material with 12 pages and an end page
- **THEN** the system SHALL respond 400 naming `body.pages` and SHALL NOT save the material

#### Scenario: Editor maximum
- **WHEN** a user saves a `line_carousel` material with 10 pages and an end page
- **THEN** the page count SHALL NOT block the save

### Requirement: LINE Image Thumbnail Defaults To The Image
A `line_image` material whose `previewUrl` is missing or blank SHALL use `mediaUrl` as the LINE `previewImageUrl`. The editor's default content SHALL NOT set `previewUrl`, so that replacing only the image also replaces the thumbnail.

#### Scenario: Blank thumbnail
- **WHEN** a `line_image` material with `mediaUrl = "https://example.com/a.jpg"` and `previewUrl = ""` is built into a LINE message
- **THEN** `previewImageUrl` SHALL be `https://example.com/a.jpg`

#### Scenario: Replace only the image
- **WHEN** a user creates a `line_image` material from the editor's default content and replaces only the image
- **THEN** the saved body SHALL NOT keep the sample thumbnail

### Requirement: FB Material Editors Edit Every Sent Field
The FB material editors SHALL let users edit every button the FB plugin sends: each button of `fb_button` and of each `fb_generic` card SHALL have a type choice of web URL or postback, with at most 3 buttons. `fb_media` `media_type` SHALL be chosen from image or video. `fb_video` SHALL accept an uploaded video. Text previews SHALL keep line breaks, and the `fb_video` preview SHALL load the video, not an image.

#### Scenario: Postback button
- **WHEN** a user changes the first `fb_button` button type to postback
- **THEN** the body SHALL store that button as `{ type: "postback", payload }` without `url`

#### Scenario: Card buttons
- **WHEN** a user edits the title of a button on an `fb_generic` card
- **THEN** the body SHALL store the new title on that card's button

#### Scenario: Media type choice
- **WHEN** a user opens the `fb_media` editor
- **THEN** the media type SHALL offer only image and video

### Requirement: Video Upload Limits Follow Each Channel

素材編輯器上傳影片時 MUST 套用該渠道的檔案上限：LINE 影片 200 MB，FB 影片 25 MB。LINE 影片 MUST 走直傳（`line-video` 用途），不經過 API 的 multipart 上傳，並顯示上傳進度。超過上限的檔案 MUST 在選檔當下拒絕，訊息寫出檔案大小與上限。

#### Scenario: LINE video over 25 MB

- **WHEN** 使用者在 LINE 影片編輯器選擇 150 MB 的 mp4
- **THEN** 編輯器以 `line-video` 用途申請直傳並上傳，完成後把正式網址填入影片欄位

#### Scenario: LINE video over 200 MB

- **WHEN** 使用者在 LINE 影片編輯器選擇 201 MB 的 mp4
- **THEN** 編輯器顯示超過上限 200 MB，不申請直傳

#### Scenario: FB video over 25 MB

- **WHEN** 使用者在 FB 影片編輯器選擇 30 MB 的 mp4
- **THEN** 編輯器顯示超過上限 25 MB，不上傳

### Requirement: LINE Text Message Body Is Text
When a `line_text` material is created, or updated with a new body, the system SHALL reject with 400 naming `body.text` a body whose `text` is not a string. The check SHALL run before the LINE validate API is called, and SHALL apply when the tenant has no active LINE channel.

#### Scenario: Numeric text
- **WHEN** a user saves a `line_text` material through the API with `text = 12345` (a number)
- **THEN** the system SHALL respond 400 naming `body.text`, SHALL NOT call the LINE validate API and SHALL NOT save the material

#### Scenario: String text
- **WHEN** a user saves a `line_text` material with `text = "12345"` (a string)
- **THEN** the system SHALL pass the body to the LINE validate API as before

### Requirement: FB Coupon Code Has No Whitespace
When an `fb_coupon` material is created, or updated with a new body, the system SHALL reject with 400 naming `body.coupon_code` a `coupon_code` that is not a string or that contains whitespace. An empty string, `null` or missing `coupon_code` SHALL be accepted.

#### Scenario: Coupon code with a space
- **WHEN** a user saves an `fb_coupon` material through the API with `coupon_code = "AB C"`
- **THEN** the system SHALL respond 400 naming `body.coupon_code` and SHALL NOT save the material

#### Scenario: Coupon code without whitespace
- **WHEN** a user saves an `fb_coupon` material with `coupon_code = "E2E90"`
- **THEN** the material SHALL be saved

#### Scenario: Empty coupon code
- **WHEN** a user saves an `fb_coupon` material without a `coupon_code`
- **THEN** the material SHALL be saved
