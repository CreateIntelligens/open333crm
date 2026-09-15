## Purpose

Protect stored channel credentials and outbound webhook delivery by requiring deployment secrets and rejecting destinations that resolve to private, local, link-local, or otherwise unsafe network addresses.

## ADDED Requirements

### Requirement: Credential encryption fails closed
The system SHALL require a deployment-provided credential encryption secret of at least 32 characters before starting services that encrypt or decrypt channel credentials. It SHALL NOT use a source-controlled fallback secret.

#### Scenario: Encryption secret is absent
- **WHEN** the API starts without `CREDENTIAL_ENCRYPTION_KEY`
- **THEN** environment validation or the first credential operation fails clearly and no deterministic fallback key is used

#### Scenario: Encryption secret is configured
- **WHEN** a deployment provides a valid encryption secret
- **THEN** channel credential encryption and decryption round-trip successfully without exposing the plaintext in logs or responses

### Requirement: Webhook destinations are public HTTPS hosts
The system SHALL accept webhook subscription URLs only when they use HTTPS and DNS resolution confirms that every resolved address is public and routable. It SHALL reject loopback, private, link-local, metadata, multicast, reserved, malformed, and DNS-failure destinations.

#### Scenario: Private webhook URL is submitted
- **WHEN** an authorized user creates or updates a webhook subscription targeting a private or metadata address
- **THEN** the API rejects the request before persisting the subscription

#### Scenario: Public HTTPS webhook URL is submitted
- **WHEN** an authorized user creates or updates a webhook subscription targeting a valid public HTTPS host
- **THEN** the API accepts the subscription after URL and address validation

### Requirement: Delivery revalidates the destination and forbids redirects
Before every webhook dispatch, the system SHALL revalidate the stored destination against the public HTTPS policy and SHALL fail closed without sending when validation fails. Delivery requests SHALL not follow redirects to a destination that was not validated.

#### Scenario: Stored destination becomes unsafe
- **WHEN** a previously accepted hostname resolves to a private address at dispatch time
- **THEN** the delivery is recorded as blocked and no outbound request is sent

#### Scenario: Destination responds with a redirect
- **WHEN** a validated webhook endpoint returns a redirect
- **THEN** the dispatcher does not follow the redirect and records the delivery outcome safely
