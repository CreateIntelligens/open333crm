# Spec Delta

## Purpose

Define a shared, tenant-safe decision capability that runs bounded structured decisions through configured providers and gives CRM workflows validated outcomes or an explicit unavailable result.

## ADDED Requirements

### Requirement: Typed Clef decision requests
The system SHALL send Clef requests using the documented `model`, `state`, and keyed `questions` object, and SHALL support `choice`, `noul`, and ordered `score` questions.

#### Scenario: Multiple decisions in one request
- **WHEN** a workflow submits multiple valid questions for one state
- **THEN** the system sends them in one `POST /v1/systemone` request and returns an answer for each question key

#### Scenario: Invalid decision definition
- **WHEN** a caller submits a `choice` without a criteria map, a `score` without ordered criteria, or an unsupported question type
- **THEN** the decision service returns an unavailable result with a validation reason and does not call Clef

### Requirement: Provider adapters normalize decision answers
Each configured decision-provider adapter SHALL map the shared CRM question catalog to its provider protocol and normalize valid answers, confidence/probabilities, usage, latency, and provider errors to one common result contract.

#### Scenario: Clef provider is invoked
- **WHEN** a configured Clef instance receives a decision request
- **THEN** its adapter sends the documented SystemOne `model`, `state`, and keyed `questions` payload and normalizes the returned answers

#### Scenario: OpenAI or JEV provider is invoked
- **WHEN** a configured OpenAI or JEV instance receives a decision request
- **THEN** its provider-specific adapter uses that provider's configured endpoint, credentials, model, and documented decision protocol, then normalizes the answer to the shared result contract

#### Scenario: Provider does not support a question type
- **WHEN** a provider adapter cannot express or decode a requested question type
- **THEN** it returns an unsupported-decision result so the fallback chain can try the next provider

### Requirement: CRM decision catalog defines business choices
The system SHALL use a shared decision catalog that defines the question keys, question types, criteria, and result mappings used by CRM workflows.

#### Scenario: Inbound message decision set
- **WHEN** an eligible inbound text needs semantic evaluation
- **THEN** the catalog provides `intent` as a `choice` over `product_inquiry`, `order_issue`, `return_exchange`, `payment_issue`, `shipping_delivery`, `account_issue`, `technical_support`, `complaint_feedback`, `faq`, `general_assistance`, and `other`; `handoff_request` as a `noul`; and `sentiment` as a `choice` over `positive`, `neutral`, and `negative`

#### Scenario: Case decision set
- **WHEN** a new case needs decision assistance
- **THEN** the catalog provides `case_category` as a `choice` over `產品諮詢`, `訂單問題`, `退換貨`, `帳號問題`, `技術支援`, `投訴建議`, `付款問題`, `物流配送`, and `其他`; `case_urgency` as an ordered `score` from `LOW` to `MEDIUM` to `HIGH` to `URGENT`; and `team_recommendation` as a `choice` over eligible tenant teams

#### Scenario: Score result selects its most probable level
- **WHEN** a provider returns a valid `score` answer with a legend and probability distribution
- **THEN** the catalog maps the level with the highest probability to the corresponding CRM value and uses its confidence for threshold evaluation

#### Scenario: Decision results map to CRM behavior
- **WHEN** a valid decision passes its feature confidence threshold
- **THEN** the workflow maps the answer using the shared catalog and applies it only through the existing automation, handoff, sentiment, or case-management behavior

### Requirement: Validate provider decision responses
The system SHALL validate each normalized provider response against the requested question type and allowed criteria before exposing a decision to a workflow.

#### Scenario: Valid choice response
- **WHEN** a provider returns a choice contained in the requested criteria with a valid probability distribution
- **THEN** the service returns the choice, confidence, and probabilities as a typed decision

#### Scenario: Invalid or incomplete response
- **WHEN** a provider returns malformed data, an unknown choice, a missing answer, an out-of-range probability, or an answer incompatible with the requested type
- **THEN** the service returns an unavailable result and the workflow does not apply that answer

### Requirement: Provider failures produce bounded unavailable results
The system SHALL convert provider connection failures, non-success HTTP responses, timeouts, and invalid responses into an explicit unavailable result without throwing an error into customer-facing message processing.

#### Scenario: Provider is unreachable
- **WHEN** a configured decision provider cannot be reached or returns a non-success HTTP status
- **THEN** the caller receives an unavailable result and the message workflow continues through its configured fallback

#### Scenario: Provider times out
- **WHEN** a provider does not respond within its configured request timeout
- **THEN** the caller receives an unavailable result within the timeout bound and the workflow continues through its configured fallback

#### Scenario: No fallback exists for a decision
- **WHEN** the provider chain is exhausted and that decision has no existing deterministic or legacy CRM fallback
- **THEN** the result remains unavailable, no model-selected action is executed, and the customer-facing workflow continues without a decision error

### Requirement: Ordered provider fallback resolves each question
The decision engine SHALL try enabled provider instances in the tenant's configured order for each unresolved question and SHALL accept an answer only after schema, allowed-choice, and feature-threshold validation.

#### Scenario: First provider returns an acceptable answer
- **WHEN** the highest-priority enabled provider returns a valid answer above the feature threshold
- **THEN** the engine accepts that answer and does not call lower-priority providers for that question

#### Scenario: Provider failure falls through to the next instance
- **WHEN** a provider is unreachable, times out, returns an invalid or unsupported answer, or returns a below-threshold answer
- **THEN** the engine records the attempt and tries the next enabled provider for that unresolved question

#### Scenario: Providers resolve different questions in one decision bundle
- **WHEN** one provider returns acceptable answers for some requested questions but fails or falls below threshold for others
- **THEN** the engine keeps the accepted answers and sends only unresolved questions to the next provider

#### Scenario: Provider chain is exhausted
- **WHEN** all enabled providers have been tried and a question remains unresolved
- **THEN** the workflow uses that decision's existing CRM fallback or leaves it unavailable without surfacing an error or applying a guessed action

#### Scenario: Total decision time budget expires
- **WHEN** the configured total chain time budget expires before all providers are attempted
- **THEN** the engine stops calling providers and applies the same per-decision fallback behavior

### Requirement: Bound decision inputs and preserve tenant context
The system SHALL send only the message and tenant-scoped context required for the requested decision, and SHALL validate any returned entity identifier against the tenant-scoped candidates supplied in the request.

#### Scenario: Team recommendation is outside tenant candidates
- **WHEN** a provider returns a team identifier that was not included in the tenant's candidate set
- **THEN** the service rejects that recommendation as unavailable and does not assign the case to that team

#### Scenario: Decision context belongs to another tenant
- **WHEN** a workflow cannot establish that its message, case, or candidate entities belong to the active tenant
- **THEN** it does not send that context to any provider and does not apply a decision
