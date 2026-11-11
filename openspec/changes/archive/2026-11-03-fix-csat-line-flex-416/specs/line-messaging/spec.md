## MODIFIED Requirements

### Requirement: LINE outbound message types
The LINE plugin SHALL build outbound messages for these content types: `text`, `quick_reply` (sent as a text message), `flex`, `image`, `video`, `file` (sent as text with the link), `audio`, `location`, `sticker`, and the material types `line_text`, `line_image`, `line_video`, `line_carousel`, `line_imagemap`, `line_flex_showcase`, `line_flex_template`. For any other content type, or for content that lacks a field LINE requires, the plugin SHALL NOT call the LINE API and SHALL return `{ success: false }` with an error that names the reason. If one message of a multi-message push cannot be built, the plugin SHALL NOT send any message of that push.

#### Scenario: Text message sent
- **WHEN** an outbound message with `contentType: 'text'` or `contentType: 'quick_reply'` is dispatched to a LINE channel
- **THEN** the system calls `POST /v2/bot/message/push` (or reply/multicast/broadcast/narrowcast per strategy) with a `TextMessage` object that carries `content.text`, and quick reply items when `content.quickReplies` is present

#### Scenario: Flex message sent
- **WHEN** an outbound message with `contentType: 'flex'`, `content.altText` and `content.contents` is dispatched (legacy content with `content.text` and `content.flexJson` is also accepted)
- **THEN** the system sends `{ type: 'flex', altText, contents }` to the LINE API, without internal fields such as `strategy` or `replyToken`

#### Scenario: Flex 訊息缺少 altText
- **WHEN** an outbound message with `contentType: 'flex'` has `contents` but no `altText` and no `text`
- **THEN** the plugin does not call the LINE API and returns `{ success: false }` with an error that names the missing alternative text

#### Scenario: 不認得的訊息類型
- **WHEN** an outbound message with a content type that the LINE plugin does not support (for example `fb_generic`) is dispatched, either as the main message or as an extra message of the same push
- **THEN** the plugin does not call the LINE API and returns `{ success: false }` with an error that contains that content type
