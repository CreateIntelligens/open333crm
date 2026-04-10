## MODIFIED Requirements

### Requirement: Agent Management Access
Creating, updating, and deleting Agents SHALL require the `ADMIN` or `SUPERVISOR` role. A `SUPERVISOR` SHALL NOT be permitted to create or assign agents with the `ADMIN` role. Listing and viewing Agents is allowed for all authenticated roles (`AGENT`, `SUPERVISOR`, `ADMIN`).

#### Scenario: AGENT attempts to create an Agent
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `POST /agents` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: AGENT attempts to delete an Agent
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `DELETE /agents/:id` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR creates an Agent with AGENT role
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /agents` is called with `{ role: "AGENT" }` and a valid body
- **THEN** the request SHALL reach the route handler (guard allows it)

#### Scenario: SUPERVISOR attempts to create an ADMIN agent
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /agents` is called with `{ role: "ADMIN" }`
- **THEN** the response SHALL be HTTP 403

#### Scenario: ADMIN creates an Agent
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `POST /agents` is called with a valid body
- **THEN** the request SHALL reach the route handler (guard allows it)

#### Scenario: AGENT lists Agents
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `GET /agents` is called
- **THEN** the request SHALL reach the route handler (no role restriction on read)
