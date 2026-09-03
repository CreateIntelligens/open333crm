## 1. Baseline and rollout controls

- [x] 1.1 Capture current legacy WebChat, secure Chatbox, visitor Socket.IO, and authenticated Socket.IO contracts in regression tests; verify the baseline tests reproduce the current compatibility behavior
- [x] 1.2 Add configuration and metrics for secure-session adoption, legacy-route use, rejected room subscriptions, public rate limits, suppressed downstream work, and security correlation IDs; verify startup and structured logs do not expose raw session secrets
- [x] 1.3 Define the staged rollout flag and documented deprecation response for legacy WebChat routes; verify the flag has a safe strict default in production configuration

## 2. Authenticated Socket.IO room authorization

- [x] 2.1 Define and validate the subscription request and acknowledgement error contract for tenant, agent, team, channel, and conversation targets; verify malformed and unknown targets never reach room-join logic
- [x] 2.2 Implement server-side authorization for canonical tenant and agent rooms using the socket identity and role; verify an agent cannot join another tenant or another agent's private room
- [x] 2.3 Implement tenant-scoped authorization for team, channel, and conversation subscriptions using the authenticated agent's access scope; verify authorized resources join their canonical rooms and unauthorized resources return the same safe denial contract
- [x] 2.4 Apply the same target validation to unsubscribe and enforce the per-connection subscription-attempt limit; verify denied or rate-limited requests leave existing authorized memberships unchanged
- [x] 2.5 Add Socket.IO integration tests covering cross-tenant, cross-team, malformed, repeated, and successful subscriptions; verify the dedicated Socket.IO security tests and visitor namespace regression tests pass

## 3. Secure embedded WebChat migration

- [x] 3.1 Update the embedded widget bootstrap to obtain and claim a server-issued Chatbox session per browser tab, keeping the claim only in page memory; verify two tabs cannot reuse each other's session
- [x] 3.2 Route widget text and media sends through the verified session and claim contract while preserving typed message, greeting, media, and inbox behavior; verify widget contract tests cover missing, expired, revoked, and mismatched claims
- [x] 3.3 Update visitor Socket.IO authentication and room selection so the widget joins only the server-derived session/channel room; verify a visitor cannot select a room by changing client input
- [x] 3.4 Enforce a maximum public WebChat session lifetime of three days and verify expired or revoked sessions cannot bootstrap, send, upload, or receive messages
- [ ] 3.5 Run a staging or canary migration with secure-session and legacy-route telemetry; verify the current widget bundle uses only the secure contract before strict legacy enforcement is enabled

## 4. Legacy WebChat abuse controls

- [x] 4.1 Gate legacy session, message, and media routes behind the verified session/claim contract or the strict deprecation response; verify arbitrary UUID visitor tokens cannot create contacts, conversations, messages, uploads, or downstream jobs
- [x] 4.2 Add route-bound limits for text length, JSON and multipart size, media type and size, and upload buffering; verify invalid or oversized payloads are rejected before persistence or durable storage
- [x] 4.3 Add IP-, channel-, and session-scoped rate limits with retry metadata and non-secret keys; verify requests above each limit do not invoke inbound processing
- [x] 4.4 Add per-session and per-channel quotas for automation, embeddings, and AI auto-replies; verify quota rejection prevents queue dispatch while valid bounded requests preserve the existing inbound pipeline
- [x] 4.5 Add public WebChat abuse regression tests and verify rejected requests do not create durable CRM records or BullMQ/AI work

## 5. Dependency vulnerability remediation

- [x] 5.1 Produce a resolved dependency reachability matrix for high-severity advisories, including upload parsing and Socket.IO transport paths; verify each entry has evidence, owner, and remediation or compensating-control status
- [x] 5.2 Upgrade or replace the reachable upload-parser dependency with the smallest compatible change; verify knowledge-base upload parsing, malformed input rejection, and size limits pass
- [x] 5.3 Upgrade reachable Socket.IO or transport dependencies without changing the Redis socket bridge contract; verify authenticated connection, authorized room subscription, and worker event delivery tests pass
- [x] 5.4 Re-run the package-manager advisory scan against the regenerated lockfile and record accepted non-reachable findings; verify no unresolved high-severity reachable advisory is silently ignored

## 6. Credential and webhook egress hardening

- [x] 6.1 Remove the hardcoded credential-encryption fallback and require `CREDENTIAL_ENCRYPTION_KEY` in startup validation; verify missing configuration fails closed and configured encryption/decryption round-trips
- [x] 6.2 Validate webhook subscription URLs with HTTPS and DNS/IP private-network blocking on create and update; verify private, metadata, malformed, and DNS-failure destinations are rejected before persistence
- [x] 6.3 Revalidate stored webhook destinations at dispatch and disable redirect following; verify unsafe rows produce a blocked delivery without an outbound request
- [x] 6.4 Add security regression tests for credential fallback removal and webhook SSRF protections; verify the tests pass without exposing secrets

## 7. Integration, documentation, and release verification

- [x] 7.1 Run API, worker, widget, and relevant workspace typecheck/lint/build checks; verify the full security remediation test set and existing WebChat tests pass
- [ ] 7.2 Run the Cloudflare security-audit workflow again against the patched repository; verify the arbitrary-room and unauthenticated-legacy-WebChat findings are closed or have explicit evidence for any residual risk
- [x] 7.3 Update `CHANGELOG.md` under the dated `## [2026-09-02]` section with the user-facing security fixes and migration notes; verify no `## [Unreleased]` section is added or restored
- [ ] 7.4 Deploy in the documented order, monitor rejection/error/latency metrics, and verify rollback controls preserve the no-arbitrary-room-join invariant
