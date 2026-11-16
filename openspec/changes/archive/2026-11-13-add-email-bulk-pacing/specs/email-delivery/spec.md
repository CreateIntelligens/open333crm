## MODIFIED Requirements

### Requirement: SMTP failover to Resend

When explicitly enabled, the email service MUST use Resend when SMTP rejects a message before acceptance or is unavailable before message submission, except when SMTP signals temporary per-second rate throttling (`454` maximum sending rate exceeded). Rate throttling MUST release the SMTP lease and signal a retryable capacity backoff without opening the Resend circuit. The fallback MUST use its configured verified sender and preserve the recipient, subject and content.

#### Scenario: SMTP connection fails before submission
- **WHEN** SMTP cannot connect before sending a message and failover is enabled
- **THEN** the service sends the message through Resend with the configured fallback sender.

#### Scenario: SMTP temporarily rejects submission
- **WHEN** SMTP explicitly returns a temporary service rejection before accepting the message (such as `421` or daily quota exceeded)
- **THEN** the service sends the message through Resend.

#### Scenario: SMTP rate throttling backs off without opening circuit
- **WHEN** SMTP returns `454` maximum sending rate exceeded
- **THEN** the service releases the lease without opening the Resend circuit and signals a retryable throttling error.

#### Scenario: SMTP acceptance is uncertain
- **WHEN** SMTP fails after message submission has begun and acceptance cannot be determined
- **THEN** the service reports failure without sending the same message through Resend.

#### Scenario: Resend rejects the fallback message
- **WHEN** SMTP fails before submission and Resend rejects the fallback message
- **THEN** the service reports a delivery failure to its caller.

#### Scenario: Failover is disabled
- **WHEN** SMTP fails and failover is not enabled
- **THEN** the service reports the SMTP failure without calling Resend.

## ADDED Requirements

### Requirement: Configurable provider rate and batching parameters

The service MUST support configuring SMTP and Resend concurrency limits, per-second rate limits, bulk rate limits, failover cooldown, and batch chunk size via environment variables, and MUST validate that the configured bulk rate does not exceed the total SMTP rate.

#### Scenario: Bulk rate exceeds total SMTP rate
- **WHEN** `EMAIL_SMTP_BULK_RATE_PER_SEC` is configured higher than `EMAIL_SMTP_RATE_PER_SEC`
- **THEN** configuration validation fails before the API accepts requests.

#### Scenario: Bulk rate scales from total SMTP rate
- **WHEN** `EMAIL_SMTP_RATE_PER_SEC` is adjusted and `EMAIL_SMTP_BULK_RATE_PER_SEC` is omitted
- **THEN** the effective bulk rate scales proportionally under the total SMTP rate to preserve transactional headroom.

### Requirement: Cross-instance sliding-window rate pacing and priority reservation

The coordinator MUST enforce a cross-instance 1-second sliding-window rate limit per provider in Redis alongside concurrency limits, returning a retry delay when capacity is temporarily saturated, and MUST reserve headroom above `EMAIL_SMTP_BULK_RATE_PER_SEC` for transactional emails.

#### Scenario: Bulk traffic reaches bulk rate cap while transactional traffic succeeds
- **WHEN** bulk sends saturate `EMAIL_SMTP_BULK_RATE_PER_SEC` within a 1-second window
- **THEN** additional bulk requests receive a rate-limit error with a positive retry delay while transactional requests within `EMAIL_SMTP_RATE_PER_SEC` still acquire SMTP.

#### Scenario: Burst exceeds Resend rate limit during failover
- **WHEN** the SMTP circuit is open and requests exceed `EMAIL_RESEND_RATE_PER_SEC`
- **THEN** excess requests receive a rate-limit error with a positive retry delay without overwhelming Resend.

### Requirement: Automatic batching and queued email dispatch

The service MUST provide a monitored BullMQ queue (`email-dispatch`) and batch enqueueing helper that splits large sends into chunks of `EMAIL_BATCH_SIZE` with staggered initial delays, delays jobs cleanly when rate-limited or throttled, and routes Canvas email sends through the queue.

#### Scenario: Enqueueing a 5000-email batch chunks and staggers delivery
- **WHEN** a batch of 5000 emails is enqueued with `EMAIL_BATCH_SIZE=100` and bulk rate `8/sec`
- **THEN** jobs are added in 50 chunks with staggered delays proportional to index divided by bulk rate.

#### Scenario: Queued email job reschedules on capacity or throttling error
- **WHEN** an `email-dispatch` job encounters a rate-limit or throttling error
- **THEN** the worker moves the job to delayed state for the retry delay without exhausting job retry attempts.
