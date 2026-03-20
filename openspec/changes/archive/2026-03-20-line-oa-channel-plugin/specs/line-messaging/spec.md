## ADDED Requirements

### Requirement: LINE outbound message types
The system SHALL support sending the following LINE message types: `text`, `image`, `video`, `audio`, `location`, `sticker`, `flex`, `imagemap`.

#### Scenario: Text message sent
- **WHEN** an outbound message with `type: 'text'` is dispatched to a LINE channel
- **THEN** the system calls `POST /v2/bot/message/push` (or reply/multicast/broadcast/narrowcast per strategy) with a `TextMessage` object

#### Scenario: Flex message sent
- **WHEN** an outbound message with `type: 'flex'` and `content.flexJson` is dispatched
- **THEN** the system wraps it in a `FlexMessage` object and sends to LINE API

---

### Requirement: Five sending strategies
The system SHALL support Reply, Push, Multicast, Broadcast, and Narrowcast sending strategies for LINE.

| Strategy | API | Limit |
|----------|-----|-------|
| Reply | `POST /v2/bot/message/reply` | replyToken required, 30s TTL |
| Push | `POST /v2/bot/message/push` | 1 recipient |
| Multicast | `POST /v2/bot/message/multicast` | max 500 userIds/request |
| Broadcast | `POST /v2/bot/message/broadcast` | all followers |
| Narrowcast | `POST /v2/bot/message/narrowcast` | depends on audience group |

#### Scenario: Multicast batching
- **WHEN** Multicast is requested for more than 500 recipients
- **THEN** the system splits recipients into batches of 500 and enqueues each batch via BullMQ

#### Scenario: Narrowcast with audience
- **WHEN** a Narrowcast is sent with an `audienceGroupId`
- **THEN** the system posts to `/v2/bot/message/narrowcast` with the `recipient` object and stores the returned `requestId` for progress tracking

---

### Requirement: Quick Reply support
The system SHALL attach Quick Reply buttons to any outbound LINE message when `content.quickReplies` is present.

#### Scenario: Quick Reply rendered
- **WHEN** an outbound message has `quickReplies` items
- **THEN** the LINE API payload includes a `quickReply.items` array mapped from the standard `QuickReply[]` type

---

### Requirement: Sending quota check
The system SHALL check the monthly sending quota before dispatching Broadcast or Narrowcast messages.

#### Scenario: Quota exceeded
- **WHEN** `GET /v2/bot/message/quota/consumption` shows usage >= quota limit
- **THEN** the Broadcast/Narrowcast is blocked and the user is notified with a `quota_exceeded` error
