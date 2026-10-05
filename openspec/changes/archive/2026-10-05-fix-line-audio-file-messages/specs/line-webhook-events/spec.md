## MODIFIED Requirements

### Requirement: Immediate media download on receipt
The system SHALL parse LINE `image`, `video`, `audio` and `file` messages and download LINE-hosted content immediately upon webhook receipt. The download SHALL run asynchronously in the API process after the message is stored, without delaying the webhook response. The system SHALL call `GET /v2/bot/message/{messageId}/content`, upload the content to the Storage Layer, and write the Storage URL to both `content.url` and `content.mediaUrl` of the message. When `contentProvider.type` is `external`, the system SHALL use `contentProvider.originalContentUrl` and SHALL NOT download. Until the download finishes, `content.contentId` marks the media as pending and `content.mediaUrl` SHALL NOT hold a placeholder. The system SHALL NOT download content larger than 25 MB, SHALL keep the stored MIME type only for images other than SVG, video and audio and store everything else as `application/octet-stream`, and SHALL keep the extension of a file's name. When the download fails, the system SHALL write the reason in Traditional Chinese to `content.mediaError` and notify the inbox.

#### Scenario: Image downloaded on receive
- **WHEN** a Webhook `message` event of type `image` with `contentProvider.type` `line` arrives
- **THEN** the system downloads the content and writes the Storage URL to `content.url` and `content.mediaUrl`

#### Scenario: Media URL never expires
- **WHEN** the Storage URL is written to the message
- **THEN** `content.mediaUrl` holds the Storage URL, and before that it holds no placeholder

#### Scenario: Audio downloaded and stored
- **WHEN** a Webhook `message` event of type `audio` with `contentProvider.type` `line` arrives
- **THEN** the message has `contentType` `audio`, text「[語音]」and the `duration`, and the system downloads and stores the content

#### Scenario: File downloaded and stored
- **WHEN** a Webhook `message` event of type `file` with `fileName`「報價單.pdf」arrives
- **THEN** the message has `contentType` `file`, text「[檔案] 報價單.pdf」, `fileName` and `fileSize`, and the system stores the content with the extension `.pdf` as `application/octet-stream`

#### Scenario: External-provider audio used directly
- **WHEN** a Webhook `message` event of type `audio` with `contentProvider.type` `external` arrives
- **THEN** `content.url` is `contentProvider.originalContentUrl` and the system does not call the content API

#### Scenario: File larger than 25 MB
- **WHEN** a Webhook `message` event of type `file` with `fileSize` 26 MB arrives
- **THEN** the system does not call the content API and writes「檔案超過 25 MB，未下載」to `content.mediaError`

#### Scenario: Media download failed
- **WHEN** the content API returns HTTP 404 for a LINE-hosted message
- **THEN** the system writes「LINE 內容下載失敗（404）」to `content.mediaError` and sends `message.new` to the inbox
