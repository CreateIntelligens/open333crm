## MODIFIED Requirements

### Requirement: Tenant-safe inbound Agent reply

The system SHALL support Agent execution for eligible BOT_HANDLED text messages and for authenticated A2A-originated text tasks associated with an explicitly mapped active tenant. CRM-originated execution SHALL fall back to the existing KB auto-reply path when Agent execution is disabled, unavailable, or fails before a final answer. A2A-originated execution SHALL return a bounded standard A2A failure outcome when it cannot produce a final answer and SHALL NOT silently inject a CRM-channel reply. All reads and writes SHALL be tenant scoped.

#### Scenario: Eligible inbound message
- **WHEN** Agent mode is enabled and a text message arrives in a BOT_HANDLED conversation
- **THEN** the system SHALL run one Agent request and deliver at most one Bot reply for that inbound message

#### Scenario: Agent failure fallback
- **WHEN** CRM Agent execution fails or expires before producing a final answer
- **THEN** the system SHALL use the existing KB auto-reply behavior and SHALL record the Agent failure for diagnosis

#### Scenario: Eligible A2A inbound task
- **WHEN** an authenticated standard A2A task is received for an active explicitly mapped tenant and contains a supported text part
- **THEN** the system SHALL run one bounded Agent request under that tenant context and SHALL return at most one standard A2A text result for the task

#### Scenario: A2A Agent failure
- **WHEN** A2A Agent execution fails, expires, or reaches a guard limit before producing a final answer
- **THEN** the system SHALL return one bounded standard A2A failure outcome, SHALL record the failure for diagnosis, and SHALL not send a fallback message to a CRM customer channel

#### Scenario: Unsupported A2A content
- **WHEN** an A2A task contains a file, URL, data part, or unsupported media mode outside the configured text-only contract
- **THEN** the system SHALL reject the task with a bounded validation outcome before LLM execution
