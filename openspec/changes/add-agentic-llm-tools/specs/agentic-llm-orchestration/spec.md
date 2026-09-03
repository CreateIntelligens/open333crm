## Purpose

讓 Open333CRM 的 LLM 能在客服對話中自主決定是否使用外部工具，吸收工具結果後繼續推理，最後產生可追溯且可安全發送的回答。

## ADDED Requirements

### Requirement: Agent chooses tools through a typed contract

The system SHALL expose a typed tool declaration to the configured chat provider and SHALL execute only tools present in the tenant-scoped allowlist. A provider response without tool calls SHALL be treated as the final answer.

#### Scenario: Direct answer without a tool
- **WHEN** the model returns text and no tool call
- **THEN** the system SHALL persist the final answer and SHALL NOT invoke an external tool

#### Scenario: Unknown tool call
- **WHEN** the model requests a tool name that is not in the allowlist
- **THEN** the system SHALL record a failed tool call and return a safe error result to the model without executing arbitrary code

### Requirement: Bounded multi-turn agent loop

The system SHALL repeat model and tool execution turns until the model returns a final answer or a guard stops the run. The hard maximum SHALL be 100 turns, regardless of model output or tenant configuration.

#### Scenario: Tool result is incorporated
- **WHEN** the model requests a valid tool and the tool returns successfully
- **THEN** the system SHALL send the tool result back to the model in the provider's tool-result format before continuing

#### Scenario: Maximum turn limit
- **WHEN** the run reaches 100 turns without a final answer
- **THEN** the system SHALL stop the loop, mark the run as failed or limit-reached, and SHALL return a bounded fallback response

#### Scenario: Other guard stops the run
- **WHEN** the timeout, token budget, tool-call budget, or repeated-call guard is reached
- **THEN** the system SHALL stop execution, persist the stop reason, and SHALL not execute another tool call

### Requirement: Tenant-safe inbound Agent reply

The system SHALL support Agent execution for eligible BOT_HANDLED text messages and SHALL fall back to the existing KB auto-reply path when Agent execution is disabled, unavailable, or fails before a final answer. All reads and writes SHALL be tenant scoped.

#### Scenario: Eligible inbound message
- **WHEN** Agent mode is enabled and a text message arrives in a BOT_HANDLED conversation
- **THEN** the system SHALL run one Agent request and deliver at most one Bot reply for that inbound message

#### Scenario: Agent failure fallback
- **WHEN** Agent execution fails or expires before producing a final answer
- **THEN** the system SHALL use the existing KB auto-reply behavior and SHALL record the Agent failure for diagnosis

### Requirement: Auditable Agent run

The system SHALL persist run status, provider/model, turn count, tool count, stop reason, tool names, sanitized arguments, result status, and final public URLs without storing secrets or unrestricted external payloads.

#### Scenario: Run trace is available
- **WHEN** an Agent run completes or fails
- **THEN** an authorized tenant user SHALL be able to inspect its status and bounded execution trace
