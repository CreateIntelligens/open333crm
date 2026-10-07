# Spec Delta

## ADDED Requirements

### Requirement: Clef inference is recorded in AI usage history
Each Clef inference attempt SHALL be recorded for its tenant and decision feature, including model, success, input-token count when available, latency when available, and a bounded error code on failure.

#### Scenario: Clef success usage is recorded
- **WHEN** Clef returns a valid answer with `usage.input_tokens` and `latency_seconds`
- **THEN** the usage history records provider `clef`, model `clef-flash`, the decision feature, input tokens, zero generated tokens, latency, and success

#### Scenario: Clef failure usage is recorded
- **WHEN** a Clef request times out, fails, or returns an invalid answer
- **THEN** the usage history records a failed Clef attempt and bounded error code without changing the fallback result

#### Scenario: Clef request state is private
- **WHEN** a Clef inference attempt is recorded
- **THEN** the usage history does not store the raw customer message or full request state
