## MODIFIED Requirements

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

`line_imagemap` is supported only with the structure defined in this spec. `line_flex_template` is supported only with imported LINE Flex Message JSON and the field-hole structure defined by the `line-flex-material-import` capability.

#### Scenario: Reject deprecated contentType
- **WHEN** a user POSTs a Material with `contentType: "line_flex_restaurant"` or `contentType: "universal_card"`
- **THEN** the API returns HTTP 400 with `error.code="DEPRECATED_CONTENT_TYPE"` or `INVALID_CONTENT_TYPE`

#### Scenario: Accept new LINE-specific contentType
- **WHEN** a user POSTs `{ channelType: "line", contentType: "line_carousel", body: {...} }`
- **THEN** the Material is created successfully

#### Scenario: Accept imported LINE Flex template contentType
- **WHEN** a user POSTs `{ channelType: "line", contentType: "line_flex_template", body: { altText, contents, fields, editableContainers } }`
- **THEN** the Material is created successfully after import-template validation passes

#### Scenario: Reject LINE Flex template with FB channel
- **WHEN** a user POSTs `{ channelType: "fb", contentType: "line_flex_template", body: {...} }`
- **THEN** the API returns HTTP 400 with `error.code="INVALID_CHANNEL_CONTENT_TYPE"`
