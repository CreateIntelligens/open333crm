## MODIFIED Requirements

### Requirement: Unified channel plugin interface
The system SHALL provide a unified adapter interface for all external IM channels through a single `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`. The interface SHALL use `ParsedWebhookMessage[]` as the return type for `parseWebhook`, and `registerChannelPlugin`/`getChannelPlugin` as registry functions. Both `apps/api` and `apps/workers` SHALL import from `@open333crm/channel-plugins` only.

A plugin MAY provide the optional `extensions.comments` extension (`ChannelCommentExtension`) to parse post comment events and to send private replies and public replies to comments. Callers SHALL decide whether a channel supports comments by checking that `extensions.comments` exists and by reading its declared `capabilities`, not by comparing the channel type.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into `ParsedWebhookMessage[]` and passes it to the Core Inbox through the runtime initialized from `apps/api/src/index.ts`

#### Scenario: Plugin resolved from single package registry
- **WHEN** any service in `apps/api` or `apps/workers` calls `getChannelPlugin(channelType)`
- **THEN** the registry returns the plugin instance from `@open333crm/channel-plugins` (no `/webhook` sub-path)

#### Scenario: Comment extension available in both registries
- **WHEN** the API registry and the workers registry each resolve the FB and Instagram plugins
- **THEN** both plugins SHALL have `extensions.comments`, and the LINE and WebChat plugins SHALL NOT have it

## ADDED Requirements

### Requirement: Facebook plugin parses page feed comments
The FB plugin's `extensions.comments.parseCommentEvents` SHALL return one event for each `feed` change with `item` `comment` and `verb` `add` or `remove`, carrying the page ID as `accountId`, the comment ID, the post ID, the commenter's `from.id` and `from.name`, the text, and `created_time` converted from Unix seconds. Comments by the page itself (`from.id` equals `entry.id`) and comments without `from` SHALL NOT be returned.

#### Scenario: New comment on a post
- **WHEN** the payload has `field` `feed`, `item` `comment`, `verb` `add`, `comment_id` `C1`, `post_id` `P_1`, `from: { id: 'U1', name: '王小明' }`, `message` `我要+1`, `created_time` `1731470000`
- **THEN** one event is returned with `kind` `add`, `commentId` `C1`, `postId` `P_1`, `commenterId` `U1`, `commenterName` `王小明`, text `我要+1` and `createdAt` 2024-11-13

#### Scenario: Comment by the page itself
- **WHEN** a comment's `from.id` equals `entry.id`
- **THEN** no event is returned

#### Scenario: Comment without from
- **WHEN** a comment change has no `from`
- **THEN** no event is returned

#### Scenario: Other feed changes
- **WHEN** the feed change has `item` `reaction`, `like`, `post`, `status` or `share`, or `verb` `edited`
- **THEN** no event is returned

#### Scenario: Reply to another comment
- **WHEN** a comment's `parent_id` is another comment's ID
- **THEN** the event's `parentId` is that comment ID; when `parent_id` equals `post_id`, `parentId` is empty

### Requirement: Comment extension normalizes Meta errors
`sendPrivateReply` and `replyToComment` SHALL return Meta errors as a reason code and a transient flag instead of throwing: code 190 is `TOKEN_EXPIRED`; codes 10 and 200 to 299 are `PERMISSION_MISSING`; 551 is `USER_UNAVAILABLE`; 100 with subcode 33 is `COMMENT_NOT_FOUND`; 4, 17, 32, 613 and 80001 to 80014 are `RATE_LIMITED` and transient; network errors and HTTP 5xx are `NETWORK` and transient; other errors are `UNKNOWN`. The original code, subcode, trace ID and message SHALL be kept.

#### Scenario: Token expired
- **WHEN** Graph API answers a private reply with `{ error: { code: 190, error_subcode: 463 } }`
- **THEN** the result is `{ ok: false }` with reason `TOKEN_EXPIRED`, `transient` false, code 190 and subcode 463

#### Scenario: Network failure
- **WHEN** the fetch for a private reply throws
- **THEN** the result is `{ ok: false }` with reason `NETWORK` and `transient` true

### Requirement: Facebook private reply targets the comment
The FB plugin's `sendPrivateReply` SHALL send `POST https://graph.facebook.com/v21.0/me/messages` with `recipient: { comment_id }` and the Messenger message built the same way as `sendMessage`, including converting site paths to public URLs, and SHALL return the `recipient_id` and `message_id` from the response. `sendMessage` SHALL keep sending `recipient: { id }` with its existing fields.

#### Scenario: Private reply body
- **WHEN** `sendPrivateReply('C1', { contentType: 'text', content: { text: '感謝' } }, credentials)` is called and Graph API answers `{ recipient_id: 'PSID-1', message_id: 'm_1' }`
- **THEN** the request body has `recipient.comment_id` `C1`, no `recipient.id`, and `message.text` `感謝`; the result is `{ ok: true, recipientId: 'PSID-1', messageId: 'm_1' }`

#### Scenario: Direct message unchanged
- **WHEN** `sendMessage` sends a text message to `PSID-1`
- **THEN** the request body has `recipient.id` `PSID-1` and the same other fields as before this change

### Requirement: Comment post references are normalized offline
`extensions.comments.parsePostReference` SHALL turn a post ID or URL typed by a user into the same post ID format that comment events use, without any network request, and SHALL return null when it cannot. The FB plugin SHALL accept `{pageId}_{postId}`, a numeric post ID (prefixed with the channel's page ID), and URLs containing `/posts/<number>`, `story_fbid=` or `fbid=`.

#### Scenario: Numeric post ID
- **WHEN** the FB plugin parses `123` for page `999`
- **THEN** the result is `999_123`

#### Scenario: Unrecognized input
- **WHEN** the FB plugin parses `hello`
- **THEN** the result is null
