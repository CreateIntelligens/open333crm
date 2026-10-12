# Spec Delta

## ADDED Requirements

### Requirement: Decision provider attempts are recorded in AI usage history
Each decision-provider attempt SHALL be recorded for its tenant and decision feature, including provider instance, model, success, input-token count when available, latency when available, and a bounded error code on failure.

#### Scenario: Provider success usage is recorded
- **WHEN** a provider returns a valid answer with input-token and latency metadata
- **THEN** the usage history records its provider family and instance, model, decision feature, input tokens, zero generated tokens, latency, and success

#### Scenario: Fallback provider failure usage is recorded
- **WHEN** a provider request times out, fails, or returns an invalid answer before the next provider is tried
- **THEN** the usage history records that failed attempt and bounded error code without changing the fallback result

#### Scenario: Provider request state is private
- **WHEN** a decision-provider attempt is recorded
- **THEN** the usage history does not store the raw customer message or full request state
