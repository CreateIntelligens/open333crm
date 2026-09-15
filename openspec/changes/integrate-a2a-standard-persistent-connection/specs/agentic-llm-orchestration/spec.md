## MODIFIED Requirements

### Requirement: Tenant-safe inbound Agent reply

The system SHALL support Agent execution for eligible BOT_HANDLED text messages and for text prompts delivered by the authenticated official A2A bridge under an explicitly mapped active tenant. CRM-originated execution SHALL fall back to the existing KB auto-reply path when Agent execution is disabled, unavailable, or fails before a final answer. Bridge-originated execution SHALL return a bounded result to the bridge when it cannot produce a final answer and SHALL NOT silently inject a CRM-channel reply; the bridge owns standard A2A task/result transport. All reads and writes SHALL be tenant scoped.

#### Scenario: Eligible inbound message
- **WHEN** Agent mode is enabled and a text message arrives in a BOT_HANDLED conversation
- **THEN** the system SHALL run one Agent request and deliver at most one Bot reply for that inbound message

#### Scenario: Agent failure fallback
- **WHEN** CRM Agent execution fails or expires before producing a final answer
- **THEN** the system SHALL use the existing KB auto-reply behavior and SHALL record the Agent failure for diagnosis

#### Scenario: Eligible bridge prompt
- **WHEN** an authenticated official A2A bridge invokes the CRM adapter for an active explicitly mapped tenant and supplies a supported text prompt
- **THEN** the system SHALL run one bounded Agent request under that tenant context and SHALL return at most one text result to the bridge for correlated A2A delivery

#### Scenario: Bridge Agent failure
- **WHEN** bridge-originated Agent execution fails, expires, or reaches a guard limit before producing a final answer
- **THEN** the system SHALL return one bounded failure result to the bridge, SHALL record the failure for diagnosis, and SHALL not send a fallback message to a CRM customer channel

#### Scenario: Unsupported bridge content
- **WHEN** the bridge supplies a file, URL, data part, or unsupported media mode outside the configured text-only contract
- **THEN** the system SHALL reject the prompt with a bounded validation outcome before LLM execution
