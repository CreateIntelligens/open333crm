# Tasks

## 1. Configuration and safety

- [x] 1.1 Add tests in `apps/api/tests/unit/modules/email/email-delivery.test.ts` and `email-failover.test.ts` for missing fallback credentials, disabled failover, and Resend rejection.
- [x] 1.2 Implement explicit failover configuration and validate the fallback sender and API key.
- [x] 1.3 Add failing tests in `apps/api/tests/unit/modules/email/email-failover.test.ts` for connection failure before submission and ambiguous SMTP acceptance.
- [x] 1.4 Implement SMTP error classification and fallback without duplicating ambiguous sends.

## 2. Coordination

- [x] 2.1 Add tests in `apps/api/tests/unit/modules/email/email-failover.test.ts` and `apps/api/tests/feature/modules/email/email-failover.test.ts` for concurrent outage requests, one recovery probe, recovery success, and coordination failure. Mutation: raising the SMTP limit from 3 to 4 makes the concurrency test fail.
- [x] 2.2 Implement Redis-backed circuit state, bounded concurrency, expiring leases, lease renewal for active operations, and cooldown with one recovery probe.
- [x] 2.3 Verify concurrency and crash recovery using isolated Redis-backed feature tests.

## 3. Delivery

- [x] 3.1 Update deployment and email documentation and `CHANGELOG.md`; verify the Resend sender and credentials before enabling fallback.
- [x] 3.2 Run relevant unit and feature tests, tenant checks, feature impact review, and OpenSpec validation; run build where required.
- [x] 3.3 Complete all tasks and archive this change with the OpenSpec CLI.
