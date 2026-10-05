## ADDED Requirements

### Requirement: Inbox Shows Inbound Media
The inbox message bubble SHALL show image, video, audio and file messages with their media. It SHALL use only a URL that a browser can open safely: `http:`, `https:`, a path that starts with `/`, or a `data:` URI of a PNG, JPEG, GIF or WebP image. A file link SHALL NOT use a `data:` URI, whatever the case of the scheme. The bubble SHALL try `content.url` before `content.mediaUrl`, in the same order as `getMediaUrl` in `@open333crm/shared`. When no such URL exists, it SHALL show the message text, followed by `content.mediaError` when the download failed. The inbox SHALL refetch messages after the last `message.new` event of a burst, so that the event sent when a download finishes is not dropped.

#### Scenario: Audio message
- **WHEN** an audio message has a Storage URL
- **THEN** the bubble shows an audio player for that URL

#### Scenario: File message
- **WHEN** a file message with `fileName`「報價單.pdf」and `fileSize` 20480 has a Storage URL
- **THEN** the bubble shows a download link with the text「報價單.pdf」and the size「20 KB」

#### Scenario: Stored LINE message still holds the placeholder
- **WHEN** a message has `content.mediaUrl`「line-content:123」and `content.url`「https://cdn.example.com/a.jpg」
- **THEN** the bubble uses「https://cdn.example.com/a.jpg」

#### Scenario: Media not downloaded yet
- **WHEN** a file message has only `content.mediaUrl`「line-content:123」
- **THEN** the bubble shows the message text and no link

#### Scenario: Media download failed
- **WHEN** a file message has `content.mediaError`「檔案超過 25 MB，未下載」and no Storage URL
- **THEN** the bubble shows the message text and「檔案超過 25 MB，未下載」

#### Scenario: Download finishes right after the message arrives
- **WHEN** two `message.new` events for the conversation arrive 300 ms apart
- **THEN** the inbox refetches messages once immediately and once more after 500 ms

#### Scenario: Unsafe data URI
- **WHEN** a message has `content.url`「data:image/svg+xml,<svg>」or「data:text/html,<p>」
- **THEN** the bubble shows the message text and no media
