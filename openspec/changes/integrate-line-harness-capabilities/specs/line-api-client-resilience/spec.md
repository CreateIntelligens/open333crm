# Spec Delta

## Purpose

Provides duplicate-safe outbound LINE delivery behavior when network failures, timeouts, or worker retries make the result of a previous API request uncertain.

## ADDED Requirements

### Requirement: Retry-safe supported LINE sends

The system SHALL assign one stable retry key to each logical Push, Multicast, Narrowcast, or Broadcast operation before its first LINE API request. Retries of that logical operation SHALL reuse the same key and SHALL preserve the original recipient and message payload.

#### Scenario: Timeout after a push request
- **WHEN** a Push request times out after the LINE API may have accepted it
- **THEN** a retry SHALL use the same retry key and the original recipient and message payload

#### Scenario: Reply delivery
- **WHEN** a Reply message is sent using a reply token
- **THEN** the system SHALL preserve the existing safe-reply rules and SHALL not attach a Push/Multicast/Narrowcast/Broadcast retry key to the Reply API request

### Requirement: Accepted retry result is idempotent

The system SHALL treat a LINE response indicating that a retry key was already accepted as an idempotent success, and SHALL expose the accepted request identifier from `x-line-accepted-request-id` (falling back to `x-line-request-id`).

#### Scenario: LINE returns retry conflict
- **WHEN** a repeated request receives HTTP 409 for a previously accepted retry key
- **THEN** the delivery operation SHALL finish as accepted without sending another message and SHALL retain the LINE request identifier extracted from `x-line-accepted-request-id` or `x-line-request-id`

#### Scenario: Expired retry key boundary
- **WHEN** an unconfirmed delivery attempt is older than LINE's 24-hour idempotency retention window
- **THEN** the system SHALL require operator review rather than automatically resending with the expired key

### Requirement: Typed outbound LINE failure

The system SHALL expose the LINE HTTP status, status text, response body, and request identifier when an outbound LINE API request fails without an accepted retry result.

#### Scenario: Invalid LINE payload
- **WHEN** LINE rejects an outbound request with a non-success response other than an accepted retry result
- **THEN** the caller SHALL receive a structured delivery failure containing the upstream status and response details

### Requirement: Delivery metadata is persisted consistently

The system SHALL associate the retry key, LINE request identifier, and final delivery status with the existing message or broadcast result when the operation is persisted. A retry SHALL update the existing logical operation rather than create a second CRM message record.

#### Scenario: Successful retry after an uncertain first attempt
- **WHEN** a retry succeeds after the first attempt has an unknown outcome
- **THEN** the system SHALL retain one logical CRM delivery record with the final accepted status and retry metadata
