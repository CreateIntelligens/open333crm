## ADDED Requirements

### Requirement: Conversation Route Access Is Open to All Authenticated Roles
Conversation and message routes SHALL allow access for all authenticated roles: `AGENT`, `SUPERVISOR`, and `ADMIN`. No RBAC guard restricting conversation access by role SHALL be introduced in this change.

Data-level filtering — such as restricting an AGENT to only their own assigned conversations — is explicitly deferred to a future change and is outside the scope of this RBAC guard rollout.

#### Scenario: AGENT accesses conversation routes
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** any conversation or message route is called (e.g., `GET /conversations`, `GET /conversations/:id/messages`)
- **THEN** the request SHALL reach the route handler without a 403 response from an RBAC guard

#### Scenario: SUPERVISOR accesses conversation routes
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** any conversation or message route is called
- **THEN** the request SHALL reach the route handler

#### Scenario: ADMIN accesses conversation routes
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** any conversation or message route is called
- **THEN** the request SHALL reach the route handler
