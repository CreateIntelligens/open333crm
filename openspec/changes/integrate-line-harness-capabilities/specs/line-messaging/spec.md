# Spec Delta

## MODIFIED Requirements

### Requirement: Five sending strategies

The system SHALL support Reply, Push, Multicast, Broadcast, and Narrowcast sending strategies for LINE. Push, Multicast, Broadcast, and Narrowcast operations SHALL use the retry-safe behavior defined by `line-api-client-resilience`; Reply operations SHALL continue to follow `line-safe-reply`.

| Strategy | API | Limit |
|----------|-----|-------|
| Reply | `POST /v2/bot/message/reply` | replyToken required, 30s TTL |
| Push | `POST /v2/bot/message/push` | 1 recipient; retry key supported |
| Multicast | `POST /v2/bot/message/multicast` | max 500 userIds/request; retry key supported |
| Broadcast | `POST /v2/bot/message/broadcast` | all followers; retry key supported |
| Narrowcast | `POST /v2/bot/message/narrowcast` | depends on audience group; retry key supported |

#### Scenario: Multicast batching
- **WHEN** Multicast is requested for more than 500 recipients
- **THEN** the system SHALL split recipients into batches of up to 500, assign one stable retry key per logical batch chunk, record the batch delivery attempt, and reuse that key on batch retry

#### Scenario: Narrowcast with audience
- **WHEN** a Narrowcast is sent with an `audienceGroupId`
- **THEN** the system SHALL post to `/v2/bot/message/narrowcast` with the `recipient` object, use one retry key for the logical operation, and store the returned request identifier for progress tracking

#### Scenario: Broadcast retry after uncertain result
- **WHEN** a Broadcast or batch multicast attempt times out or returns a retryable upstream failure
- **THEN** the system SHALL retry with the original payload and retry key, and SHALL update the existing delivery attempt and recipient records
