## ADDED Requirements

### Requirement: Issue Account Link Token
The system SHALL issue a one-time LINE Account Link Token to initiate the identity binding process.

#### Scenario: Issue link token
- **WHEN** a Contact requests to link their LINE account with their member account
- **THEN** the system calls `POST /v2/bot/user/{userId}/linkToken` and returns the `linkToken` (valid 10 minutes, single use)
- **THEN** the user is redirected to the enterprise login page with the token as a query parameter

---

### Requirement: Complete Account Link on Webhook
The system SHALL handle the `accountLink` Webhook event to finalize identity binding.

#### Scenario: Successful account link
- **WHEN** a `accountLink` event is received with `result: 'ok'` and a valid `nonce`
- **THEN** the system matches the `nonce` to the pending link request
- **THEN** the Contact's external member ID is merged with their `lineUserId`
- **THEN** a `contact.account_linked` system event is emitted for Automation Engine

#### Scenario: Failed account link
- **WHEN** a `accountLink` event is received with `result: 'failed'`
- **THEN** the pending link request is marked as failed and the Contact is notified
