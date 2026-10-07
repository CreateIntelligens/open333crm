# Spec Delta

## ADDED Requirements

### Requirement: Semantic intent is available to automation rules
The automation contract SHALL expose a tenant-scoped `intent.detected` event with the inbound message, conversation, contact, intent key, confidence, and decision feature context required by compatible rule conditions.

#### Scenario: Inbound intent matches an active rule
- **WHEN** Clef returns an allowed intent above the configured confidence threshold and an active `intent.detected` rule matches
- **THEN** the worker enqueues and evaluates that rule through the existing automation queue and action contract

#### Scenario: Intent is below the confidence threshold
- **WHEN** Clef returns an intent below the configured confidence threshold
- **THEN** the worker does not publish `intent.detected` for that result and does not execute an intent-based rule

#### Scenario: Clef is unavailable for semantic automation
- **WHEN** the decision service returns unavailable while evaluating an inbound message
- **THEN** the worker continues existing keyword triggers and the existing Agent/KB reply path without publishing a guessed intent or failing message processing

### Requirement: Semantic automation does not duplicate a reply
The inbound reply path SHALL yield to an eligible semantic automation rule before sending an Agent or KB auto-reply, using the same single-reply behavior as existing keyword rules.

#### Scenario: Semantic rule handles the message
- **WHEN** a confident intent matches an active rule that handles the inbound message
- **THEN** the Agent and KB auto-reply paths do not send an additional reply for that message

#### Scenario: No semantic rule handles the message
- **WHEN** Clef returns a valid intent but no active matching rule handles it
- **THEN** the existing Agent and KB auto-reply eligibility rules continue to decide whether to reply

#### Scenario: Intent selects the knowledge-base route
- **WHEN** Clef returns a confident FAQ or information-seeking intent and KB auto-reply is enabled for the conversation
- **THEN** the existing grounded KB retrieval path handles the message and the system sends at most one reply

#### Scenario: Intent selects the general Agent route
- **WHEN** Clef returns a confident general-assistance intent and the channel bot mode allows Agent replies
- **THEN** the existing Agent reply path handles the message and the system sends at most one reply

### Requirement: Automation editor authors semantic intent rules
The automation editor and API SHALL compose and validate `intent.detected` rules from the shared event and fact contract, including the allowed intent keys and confidence conditions.

#### Scenario: Author a semantic intent rule
- **WHEN** an administrator creates an `intent.detected` rule with an allowed intent and valid conditions/actions
- **THEN** the editor presents the contract labels and the API accepts the rule

#### Scenario: Reject an unknown semantic intent
- **WHEN** an administrator submits an `intent.detected` rule with an intent key outside the configured allowed set
- **THEN** the API rejects the rule with a validation error and does not activate it

### Requirement: Clef sentiment results feed existing sentiment automation
For eligible inbound text, the system SHALL use a valid Clef sentiment decision to persist the existing sentiment message fact and publish the existing negative-sentiment event when its confidence threshold is met.

#### Scenario: Confident negative sentiment
- **WHEN** Clef returns a valid negative sentiment decision at or above the configured threshold
- **THEN** the message stores the sentiment result and the system publishes `sentiment.negative` for existing automation and notifications

#### Scenario: Clef sentiment is unavailable
- **WHEN** Clef is unavailable or returns an invalid or below-threshold sentiment decision
- **THEN** the system continues using the existing sentiment-analysis provider and keyword fallback without failing message processing
