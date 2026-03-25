## ADDED Requirements

### Requirement: Fact-based Rule Evaluation
The automation engine SHALL support a fact-based rule evaluation system similar to Drools, where JSON facts are matched against defined logic.

#### Scenario: Successful rule match
- **WHEN** a message event is received as a fact
- **THEN** the engine evaluates it against JSON-defined conditions and returns matching actions

### Requirement: JSON Rule Definition
Rules SHALL be defined in a JSON format that supports complex logical operations (AND, OR, NOT) and various operators.

#### Scenario: Rule parsing
- **WHEN** the system loads an `AutomationRule` from the database
- **THEN** the JSON `conditions` and `actions` are correctly parsed and ready for the engine
