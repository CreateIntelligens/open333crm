## ADDED Requirements

### Requirement: Instagram Comment Parsing
Instagram 外掛的 `extensions.comments.parseCommentEvents` SHALL 對 `object` 為 `instagram`、`changes[].field` 為 `comments` 的每一筆變更回傳一則留言事件：留言 ID、留言者 IGSID 與 `username`、media ID、文字、`parent_id` 與廣告的 `ad_id`。事件沒有留言時間，SHALL 以 `entry.time` 作為留言時間並標示來源為 `notification`。留言者等於 `entry.id` 或帶 `self_ig_scoped_id` 時 SHALL NOT 回傳；`live_comments` SHALL NOT 回傳。

#### Scenario: 一般貼文留言
- **WHEN** payload 的 `field` 是 `comments`，`value` 有 `id: 'IC1'`、`text: '+1'`、`from: { id: 'IGSID-1', username: 'amy' }`、`media: { id: 'M1' }`，`entry.time` 是 1731470000000
- **THEN** 回傳一則事件：`commentId` 是 `IC1`、`postId` 是 `M1`、`commenterId` 是 `IGSID-1`、`commenterUsername` 是 `amy`、`createdAtSource` 是 `notification`

#### Scenario: 自己帳號的留言
- **WHEN** 留言的 `from.id` 等於 `entry.id`，或 `from` 帶 `self_ig_scoped_id`
- **THEN** 不回傳事件

#### Scenario: 廣告貼文留言
- **WHEN** 留言的 `media` 帶 `ad_id: 'AD1'`
- **THEN** 事件的 `adId` 是 `AD1`

#### Scenario: 直播留言
- **WHEN** 變更的 `field` 是 `live_comments`
- **THEN** 不回傳事件

### Requirement: Instagram Comment Private Reply
Instagram 外掛的 `sendPrivateReply` SHALL 以 `POST https://graph.instagram.com/v21.0/me/messages` 送 `{ recipient: { comment_id }, message: { text } }`，回傳 Meta 的 `recipient_id` 與 `message_id`。內容不是文字時 SHALL 不呼叫 Meta，回傳原因 `MATERIAL_UNSUPPORTED`。`replyToComment` SHALL 以 `POST /{comment-id}/replies` 公開回覆。外掛宣告的私訊類型只有 `text`、沒有素材類型。

#### Scenario: 文字私訊
- **WHEN** 以留言 `IC1`、文字「感謝」呼叫 `sendPrivateReply`，Graph API 回 `{ recipient_id: 'IGSID-1', message_id: 'm1' }`
- **THEN** 送出的 body 是 `{ recipient: { comment_id: 'IC1' }, message: { text: '感謝' } }`，回傳 `recipientId` 是 `IGSID-1`

#### Scenario: 非文字內容
- **WHEN** 以圖片內容呼叫 `sendPrivateReply`
- **THEN** 沒有呼叫 Graph API，回傳 `ok: false`、原因 `MATERIAL_UNSUPPORTED`
