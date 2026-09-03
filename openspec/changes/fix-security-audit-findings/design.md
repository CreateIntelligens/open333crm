## Context

The audit evidence is recorded in the external security-audit run and the proposal. The current authenticated Socket.IO plugin auto-joins tenant and agent rooms, then accepts a raw client-supplied string for `subscribe` and `unsubscribe`. The current legacy WebChat routes validate UUID shape and active channel state, but resolve contacts and conversations from an attacker-controlled visitor token before invoking the inbound and automation pipelines. The repository already contains a server-side Chatbox session, Redis claim, fingerprint, and visitor-socket verifier that can be reused.

The change crosses API authorization, public WebChat routes and widget code, Redis/session state, automation entry points, dependency manifests, and tests. It must be deployed without allowing an old widget bundle to silently regain the insecure behavior.

## Goals / Non-Goals

**Goals:**

- Make room membership an authorization decision over canonical resource identifiers, with tenant and RBAC checks before every join.
- Move embedded visitor traffic onto the existing verified Chatbox session and page-claim lifecycle.
- Prevent invalid or excessive public traffic from creating durable CRM records, uploads, automation jobs, or AI work.
- Establish a bounded, evidence-based dependency remediation workflow for reachable production advisories.
- Provide staged rollout, observability, regression tests, and a reversible legacy-route migration.

**Non-Goals:**

- Redesigning Socket.IO event names, worker Redis pub/sub routing, or the existing inbox RBAC model.
- Adding a second visitor identity or session store.
- Treating every development-only advisory as a reason for an unrelated production dependency upgrade.
- Replacing the existing AI, automation, or inbound-message business logic once a request has passed the new security boundary.

## Decisions

### 1. Authorize canonical subscription targets on the server

The subscription protocol will accept a small, validated target shape (for example, a target type plus resource ID) and resolve it to a canonical room internally. Tenant rooms are limited to the socket's authenticated tenant; agent rooms are limited to the authenticated agent unless an explicit administrative rule permits otherwise. Conversation, team, and channel targets are queried with the socket tenant and agent access scope before joining.

The server will use acknowledgement callbacks with stable validation or authorization error codes. Unknown resources and unauthorized resources will share a safe response so the endpoint does not become a resource-existence oracle. Subscription attempts will have a per-connection limit and security logging will use IDs or digests rather than credentials.

Alternative considered: continue accepting strings but allow only a regular-expression allowlist. Rejected because a syntactically valid conversation or tenant room can still belong to another tenant or unauthorized team; authorization requires a database-backed scope check.

### 2. Reuse Chatbox session verification for the embedded widget

The widget will establish a server-issued Chatbox session, claim it once for the page, and retain only the claim token in memory. HTTP message and media requests, visitor Socket.IO authentication, and room selection will all use the same verifier and session-bound channel/conversation data.

The widget migration will be deployed before legacy route retirement. A feature flag or equivalent rollout control will allow operators to observe secure traffic, then disable the old visitor-token contract. During the overlap, legacy endpoints will either invoke the same verifier or return a documented deprecation response; they will never accept an arbitrary UUID as authorization.

Alternative considered: sign the existing `visitorToken` and keep the old routes. Rejected because it preserves a second authorization contract, does not naturally bind a page claim to a session, and increases the chance that the old widget path remains reachable after migration.

### 3. Apply limits before contact resolution and downstream work

Request size and payload limits will be enforced at the route boundary, followed by IP and session rate limits. Session and channel quotas will be checked before contact/conversation resolution, storage, event publication, automation dispatch, or AI/embedding work. Media validation will occur before durable upload and the media reference will be bound to the verified session.

The initial limits will be configuration-driven, with a maximum public session lifetime of three days. Raw session IDs and claim tokens will not be used as log or rate-limit keys; stable digests plus IP/channel dimensions will be used instead. Limits will return retry metadata and a safe public error response.

Alternative considered: rely only on a reverse-proxy rate limit. Rejected because the proxy cannot enforce session ownership, per-channel quotas, media semantics, or AI/automation budgets.

### 4. Treat dependency scanning as a reachability-gated remediation phase

The implementation will record the resolved dependency path and runtime reachability for each high-severity advisory. Reachable upload-parser and realtime transport dependencies will be upgraded or replaced with the smallest compatible change, followed by package-specific tests and a full lockfile scan. Development-only or unreachable findings will remain documented with evidence and an owner rather than triggering broad overrides.

Alternative considered: add blanket package-manager overrides immediately. Rejected because overrides can create incompatible transitive versions and can conceal which runtime path is actually fixed.

### 5. Preserve the existing event-routing boundaries

API-originated events continue to use the direct Socket.IO path when the room is already known and authorized. Worker-originated events continue through Redis pub/sub. The remediation changes room admission and visitor authentication; it does not let workers access `fastify.io` or move authorization into an untrusted event producer.

### 6. Fail closed for credential encryption and webhook egress

Credential encryption will require `CREDENTIAL_ENCRYPTION_KEY` at least 32 characters long and will stop using the source-controlled fallback. Deployment templates provide a placeholder only; real environments must provision a unique secret and rotate stored credentials as an operational follow-up.

Webhook create/update validation and dispatch validation will reuse the existing DNS/IP guard. Both layers require HTTPS, reject private and metadata destinations, block DNS failures, and disable redirect following so a public URL cannot redirect the dispatcher into an unvalidated network. Revalidating at dispatch covers existing database rows and DNS changes after creation.

Alternative considered: validate only when a subscription is saved. Rejected because DNS can change after validation and existing rows can predate the guard.

## Risks / Trade-offs

- **[Risk]** Existing clients send raw room strings or visitor tokens and will fail after enforcement. → **Mitigation:** deploy the secure widget first, emit deprecation telemetry, provide a short feature-flagged overlap, then retire the old contract with a documented response.
- **[Risk]** Conversation authorization queries add latency to Socket.IO subscriptions. → **Mitigation:** validate identifiers early, index the tenant/resource access paths, cache only short-lived positive authorization results if profiling proves necessary, and measure subscription latency.
- **[Risk]** Aggressive public limits can reject legitimate long messages or media. → **Mitigation:** make limits configurable, expose retry information, monitor rejection rates by channel, and tune with tenant-level overrides only after access control is enforced.
- **[Risk]** Dependency upgrades can break file parsing or realtime compatibility. → **Mitigation:** isolate upgrades, run focused contract tests and the full workspace checks, and keep each dependency change independently revertible.
- **[Risk]** Existing database records created by legacy traffic remain visible to agents. → **Mitigation:** do not delete historical data; stop new unauthorized creation and include a separate cleanup/reporting decision if the audit owner requests it.

## Migration Plan

1. Add metrics and feature controls for secure widget sessions, legacy-route use, rejected subscriptions, rate-limit decisions, and downstream work suppressed by quota.
2. Implement and test server-authorized Socket.IO subscriptions independently of the widget migration.
3. Release the widget and secure session flow while accepting only verified session/claim requests in the new path. Confirm secure session success, visitor delivery, and inbox behavior in staging and a canary tenant.
4. Enable strict legacy-route enforcement: either route through the secure verifier or return the documented deprecation status. Keep the flag available for rollback only during the migration window.
5. Apply configured limits and the three-day maximum session lifetime, then verify no rejected request creates contacts, conversations, media, automation jobs, or AI work.
6. Remediate reachable dependency advisories, run the resolved-lockfile scan, and complete application compatibility checks.
7. After telemetry shows no supported client depends on the old contract, remove the legacy compatibility code and turn the strict mode into the permanent default. Update `CHANGELOG.md` under a dated `## [2026-09-02]` section as required by `AGENTS.md`.

Rollback is staged: disable strict legacy retirement only while the secure widget remains available, or redeploy the previous widget/API pair if the secure flow is unavailable. The room authorization fix is not rolled back for compatibility; any rollback must preserve the no-arbitrary-room-join invariant. Dependency changes can be reverted independently after confirming the security findings and compensating controls are recorded.

## Open Questions

None. The remaining values (rate windows, payload limits, and canary duration) are configuration and rollout tuning, not changes to the specified security contract or architecture.
