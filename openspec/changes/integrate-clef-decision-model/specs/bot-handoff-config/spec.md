# Spec Delta

## ADDED Requirements

### Requirement: Detect semantic requests for a human agent
For eligible inbound text in a `BOT_HANDLED` conversation, the system SHALL use the Clef `noul` probability for a human-agent request and hand off through the existing idempotent handoff behavior only when that probability meets the configured threshold.

#### Scenario: Customer requests a human agent by paraphrase
- **WHEN** inbound text expresses a request for a human agent, Clef returns `noul` at or above the configured probability threshold, and the conversation is `BOT_HANDLED`
- **THEN** the conversation changes to `AGENT_HANDLED`, records a semantic handoff reason, sends the configured handoff message, and publishes `conversation.handoff`

#### Scenario: Explicit handoff keyword remains available
- **WHEN** Clef is disabled or unavailable and inbound text matches a configured `handoffKeyword`
- **THEN** the existing keyword handoff path continues to hand off the conversation without surfacing a Clef error

#### Scenario: Clef does not detect a handoff request
- **WHEN** Clef returns a valid negative or below-threshold result
- **THEN** the system does not hand off based on that result and continues the existing Agent/KB reply flow

#### Scenario: Handoff decision does not apply to agent-handled conversation
- **WHEN** an inbound message belongs to an `AGENT_HANDLED` conversation
- **THEN** a Clef handoff result does not change the conversation status or send a duplicate handoff message

#### Scenario: Existing explicit handoff mechanisms remain active
- **WHEN** the user selects the existing handoff postback or matches a configured handoff keyword
- **THEN** the existing explicit handoff behavior remains available regardless of Clef confidence or availability
