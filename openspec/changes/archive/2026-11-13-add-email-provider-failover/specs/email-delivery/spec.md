## ADDED Requirements

### Requirement: SMTP failover to Resend

When explicitly enabled, the email service MUST use Resend when SMTP rejects a message before acceptance or is unavailable before message submission. The fallback MUST use its configured verified sender and preserve the recipient, subject and content.

#### Scenario: SMTP connection fails before submission
- **WHEN** SMTP cannot connect before sending a message and failover is enabled
- **THEN** the service sends the message through Resend with the configured fallback sender.

#### Scenario: SMTP temporarily rejects submission
- **WHEN** SMTP explicitly returns a temporary service rejection before accepting the message
- **THEN** the service sends the message through Resend.

#### Scenario: SMTP acceptance is uncertain
- **WHEN** SMTP fails after message submission has begun and acceptance cannot be determined
- **THEN** the service reports failure without sending the same message through Resend.

#### Scenario: Resend rejects the fallback message
- **WHEN** SMTP fails before submission and Resend rejects the fallback message
- **THEN** the service reports a delivery failure to its caller.

#### Scenario: Failover is disabled
- **WHEN** SMTP fails and failover is not enabled
- **THEN** the service reports the SMTP failure without calling Resend.

### Requirement: Coordinated provider recovery

The service MUST coordinate SMTP circuit state and recovery probes across API instances, limit concurrent provider requests, and use a cooldown before permitting a single recovery probe. Requests exceeding the configured concurrency limit MUST fail promptly rather than accumulate without bound.

#### Scenario: Concurrent requests during SMTP outage
- **WHEN** SMTP is unavailable and multiple instances send messages concurrently
- **THEN** SMTP attempts are bounded and messages eligible for failover use Resend within the concurrency limit.

#### Scenario: Cooldown expires under load
- **WHEN** SMTP cooldown expires while multiple instances send messages
- **THEN** at most one instance probes SMTP and other requests continue using Resend until the probe completes.

#### Scenario: SMTP recovery succeeds
- **WHEN** the single SMTP recovery probe sends a message successfully
- **THEN** subsequent messages use SMTP.

#### Scenario: Coordination is unavailable
- **WHEN** failover is enabled and coordination is unavailable
- **THEN** the service fails promptly rather than starting uncoordinated provider requests.

### Requirement: Failover configuration

The service MUST require the SMTP sender, a Resend API key and fallback sender when SMTP failover is enabled. Logs MUST identify provider transitions without recording credentials or message bodies.

#### Scenario: Missing fallback credentials
- **WHEN** SMTP failover is enabled without a Resend API key or fallback sender
- **THEN** configuration validation fails before the API accepts requests.

#### Scenario: Missing SMTP sender
- **WHEN** SMTP failover is enabled without an SMTP sender
- **THEN** configuration validation fails before the API accepts requests.
