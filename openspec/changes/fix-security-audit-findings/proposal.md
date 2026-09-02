## Why

The security audit found two exploitable public paths: authenticated Socket.IO clients can currently subscribe to arbitrary room names, and legacy WebChat endpoints accept attacker-controlled visitor identifiers without a server-bound session or sufficient abuse controls. This change closes the immediate tenant-isolation and resource-exhaustion risks before the next production rollout, while separately resolving reachable dependency advisories.

## What Changes

- Authorize every Socket.IO room subscription against the authenticated tenant, agent role, team/channel membership, and requested resource; reject arbitrary or unknown room names.
- Migrate the embedded WebChat widget from client-generated `visitorToken` access to the existing server-issued, claimed chatbox session lifecycle.
- Retire or gate the legacy public WebChat message and media routes after widget migration; require an active server-side session/claim for visitor traffic.
- Add bounded text, JSON, media, per-IP, per-session, and AI-trigger controls for public WebChat traffic, with safe rate-limit responses.
- Triage and upgrade or replace production-reachable high-severity dependency advisories, including upload-parser and realtime transport dependencies, with compatibility tests.
- Add regression, authorization, abuse-control, migration, and dependency verification coverage.

## Capabilities

### New Capabilities

- `security/socket-room-authorization`: Tenant- and resource-scoped authorization for Socket.IO room subscriptions.
- `security/legacy-webchat-abuse-controls`: Server-bound public WebChat access, bounded request handling, and abuse controls for legacy routes during migration and retirement.
- `security/dependency-vulnerability-management`: Repeatable triage, remediation, and verification rules for production-reachable dependency advisories.

### Modified Capabilities

- `webchat-widget`: Change the embedded widget from arbitrary client-generated visitor tokens to the verified chatbox session and claim contract.

## Impact

- API Socket.IO authentication and subscription handling in `apps/api`.
- Public WebChat routes, session/message/media services, automation/AI entry points, and the embedded widget client.
- Authorization queries involving tenants, agents, teams, channels, and conversations.
- Workspace dependency manifests and lockfile, especially packages used by upload parsing and Socket.IO.
- New automated security regression tests and deployment configuration for feature flags, limits, and staged legacy-route retirement.
