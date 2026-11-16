# Design

## Context

The API currently selects one provider in `email.service.ts`. Multiple callers can send concurrently and multiple API instances can run. SMTP errors after DATA may not establish whether SES accepted the message.

## Goals / Non-Goals

**Goals:** Bound provider calls across instances, route eligible failures to Resend, and restore SMTP with one real-message probe.

**Non-Goals:** Exactly-once delivery across providers; an ambiguous SMTP outcome cannot be resolved safely by sending the message again.

## Decisions

- Explicitly configure SMTP failover and a separate Resend sender; the Resend key must be authorized for that sender.
- Coordinate circuit state, cooldown, one half-open probe, and bounded provider concurrency in Redis with atomic operations and expiring leases. Fail promptly if Redis is unavailable or capacity is exhausted; do not queue unbounded messages.
- Only switch the current message when the SMTP failure establishes that SES did not accept it. An ambiguous failure reports an error, while later messages may use the open circuit.
- Before each SMTP submission, verify the SMTP connection and authentication. Failure during this preflight is safe to send through Resend; errors after submission starts are only retried when non-acceptance is established.
- A real message tests recovery after cooldown; other messages continue through Resend until the probe succeeds or fails. Active operations renew their leases; after a crashed instance stops renewing, the leases expire in five minutes.
- Preserve existing non-failover delivery modes and call-site error handling. Never log content or credentials.

## Risks / Trade-offs

- A message with an ambiguous SMTP outcome can require operator review; retrying it automatically may duplicate delivery.
- The current UAT Resend key only permits sending and cannot list verified domains. Verify the fallback sender and API key before enabling failover.
- Both providers being unavailable or the coordination store being unavailable causes an explicit delivery failure; existing callers have differing retry behavior.
