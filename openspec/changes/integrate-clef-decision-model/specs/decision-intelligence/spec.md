# Spec Delta

## Purpose

Define a shared, tenant-safe decision capability that calls Clef-Flash for bounded structured decisions and gives CRM workflows validated outcomes or an explicit unavailable result.

## ADDED Requirements

### Requirement: Typed Clef decision requests
The system SHALL send Clef requests using the documented `model`, `state`, and keyed `questions` object, and SHALL support `choice`, `noul`, and ordered `score` questions.

#### Scenario: Multiple decisions in one request
- **WHEN** a workflow submits multiple valid questions for one state
- **THEN** the system sends them in one `POST /v1/systemone` request and returns an answer for each question key

#### Scenario: Invalid decision definition
- **WHEN** a caller submits a `choice` without a criteria map, a `score` without ordered criteria, or an unsupported question type
- **THEN** the decision service returns an unavailable result with a validation reason and does not call Clef

### Requirement: Validate Clef decision responses
The system SHALL validate each Clef response against the requested question type and the allowed criteria before exposing a decision to a workflow.

#### Scenario: Valid choice response
- **WHEN** Clef returns a choice contained in the requested criteria with a valid probability distribution
- **THEN** the service returns the choice, confidence, and probabilities as a typed decision

#### Scenario: Invalid or incomplete response
- **WHEN** Clef returns malformed JSON, an unknown choice, a missing answer, an out-of-range probability, or a response incompatible with the requested type
- **THEN** the service returns an unavailable result and the workflow does not apply that answer

### Requirement: Clef failures produce bounded unavailable results
The system SHALL convert connection failures, non-success HTTP responses, timeouts, and invalid responses into an explicit unavailable result without throwing an error into customer-facing message processing.

#### Scenario: Clef is unreachable
- **WHEN** the Clef endpoint cannot be reached or returns a non-success HTTP status
- **THEN** the caller receives an unavailable result and the message workflow continues through its configured fallback

#### Scenario: Clef times out
- **WHEN** Clef does not respond within the configured request timeout
- **THEN** the caller receives an unavailable result within the timeout bound and the workflow continues through its configured fallback

#### Scenario: No fallback exists for a decision
- **WHEN** Clef returns unavailable and that decision has no existing deterministic or provider fallback
- **THEN** the result remains unavailable, no model-selected action is executed, and the customer-facing workflow continues without a decision error

### Requirement: Bound decision inputs and preserve tenant context
The system SHALL send only the message and tenant-scoped context required for the requested decision, and SHALL validate any returned entity identifier against the tenant-scoped candidates supplied in the request.

#### Scenario: Team recommendation is outside tenant candidates
- **WHEN** Clef returns a team identifier that was not included in the tenant's candidate set
- **THEN** the service rejects that recommendation as unavailable and does not assign the case to that team

#### Scenario: Decision context belongs to another tenant
- **WHEN** a workflow cannot establish that its message, case, or candidate entities belong to the active tenant
- **THEN** it does not send that context to Clef and does not apply a decision

### Requirement: Record decision usage and latency
The system SHALL record each Clef decision attempt with tenant, feature, model, success or failure, input-token count when returned, inference latency when returned, and a bounded error code, without recording raw customer text in the usage record.

#### Scenario: Successful decision is recorded
- **WHEN** Clef returns a valid response with usage and latency metadata
- **THEN** the system records the decision feature, model, input-token count, latency, and successful outcome for the active tenant

#### Scenario: Failed decision is recorded
- **WHEN** a Clef request fails or returns an invalid response
- **THEN** the system records a failed attempt with a bounded error code and does not store the raw request state in the usage record

### Requirement: Clef provider health is inspectable
An authorized administrator SHALL be able to request Clef provider health and receive the provider status and response latency without making CRM-wide health depend on Clef availability.

#### Scenario: Clef provider is healthy
- **WHEN** an authorized administrator requests Clef health and the provider responds successfully
- **THEN** the response reports the provider as healthy with measured latency

#### Scenario: Clef provider is unavailable
- **WHEN** an authorized administrator requests Clef health and the provider times out or fails
- **THEN** the response reports the provider as unavailable and the CRM remains operational through configured fallbacks
