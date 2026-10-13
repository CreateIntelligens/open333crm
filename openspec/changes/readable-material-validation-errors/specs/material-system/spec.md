## ADDED Requirements

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
