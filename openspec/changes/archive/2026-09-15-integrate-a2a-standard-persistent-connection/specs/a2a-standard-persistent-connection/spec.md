## Purpose

讓 Open333CRM 透過官方 a2a-bridge 接入 888a2a-lite，使用 bridge 維持可自動恢復的長駐串流，並可靠地處理及回傳標準 A2A 任務結果。

## ADDED Requirements

### Requirement: Official A2A bridge transport boundary

The system SHALL use the official `a2a-bridge` / `a2a bridge` as the transport boundary for Hub registration, inbox SSE, durable receipt, reconnect, ACK, and A2A task/result correlation. Open333CRM SHALL receive a local bridge prompt contract and SHALL NOT implement a competing Hub HTTP/SSE transport.

#### Scenario: Official bridge starts
- **WHEN** the official bridge starts with valid Hub configuration and credentials
- **THEN** the bridge SHALL own the persistent Hub connection and Open333CRM SHALL only receive bridge-local prompt invocations

#### Scenario: Bridge transport is unavailable
- **WHEN** the official bridge is missing, stopped, or cannot authenticate to the Hub
- **THEN** Open333CRM SHALL report the A2A integration as unavailable and SHALL not attempt to open a second Hub transport

### Requirement: A2A registration and credential lifecycle

The integration SHALL support an explicit bridge registration bootstrap. The configured `A2A_HUB_KEY` environment secret SHALL be consumed by the official bridge only for registration or key rotation. Open333CRM SHALL not receive or persist the Hub key as part of a prompt invocation.

#### Scenario: First registration
- **WHEN** no valid Agent ID and Agent Token are available
- **THEN** the controlled bridge bootstrap SHALL read `A2A_HUB_KEY`, register an idempotent Agent identity, and provide the returned credentials for storage as `A2A_AGENT_ID` and `A2A_AGENT_TOKEN` through the deployment secret mechanism

#### Scenario: Ordinary bridge operation
- **WHEN** the bridge sends Hub requests after registration
- **THEN** the bridge SHALL use its issued Agent credentials and SHALL not use the Hub key as ordinary authentication

#### Scenario: Credential rejected or expired
- **WHEN** the Gateway rejects the Agent Token as invalid or expired
- **THEN** the bridge SHALL stop processing new tasks, report an authentication error, and require controlled credential rotation or re-registration

#### Scenario: Hub key rotation
- **WHEN** the operator replaces `A2A_HUB_KEY`
- **THEN** the bridge SHALL continue using the existing Agent Token until the controlled rotation operation completes, and SHALL not send the new Hub key on ordinary A2A requests

### Requirement: Long-lived bridge connection

The official bridge SHALL maintain the long-lived Hub inbox connection for the registered Agent. A network disconnect SHALL be treated as recoverable and SHALL not require Open333CRM to open a replacement transport.

#### Scenario: Persistent connection established
- **WHEN** the official bridge accepts the Agent credentials and opens its inbox stream
- **THEN** the bridge SHALL remain connected, consume task/message updates, process keepalive events, and expose connection health to the CRM adapter

#### Scenario: Keepalive received
- **WHEN** the stream returns a keepalive or comment event
- **THEN** the bridge SHALL treat the connection as healthy and SHALL NOT create an application task

#### Scenario: Connection interrupted
- **WHEN** the stream ends, times out, or the underlying connection fails
- **THEN** the bridge SHALL preserve uncompleted work, close the old stream, and reconnect using bounded exponential backoff with jitter

### Requirement: Reconnect and task resumption

The official bridge SHALL resume task observation after reconnect without losing tasks accepted by the Hub. Open333CRM SHALL rely on the bridge's durable local task state and SHALL make prompt execution idempotent for repeated bridge delivery.

#### Scenario: Reconnect after a partial stream failure
- **WHEN** the official bridge reconnects after receiving some but not all updates for an in-flight task
- **THEN** the bridge SHALL reconcile its durable local task state before invoking the CRM adapter again

#### Scenario: Bridge process restarts
- **WHEN** the bridge process restarts with unfinished local task records
- **THEN** it SHALL reload those records, reconnect to the Hub, and resume or safely finalize each task without creating a duplicate CRM reply

### Requirement: Durable bridge-to-CRM handoff

The official bridge SHALL durably record an inbound A2A task and SHALL complete its receipt protocol before invoking Open333CRM. The CRM adapter SHALL use task identity and context identity for idempotency, and duplicate bridge invocations SHALL not start more than one active Agent execution for the same logical task.

#### Scenario: New inbound task
- **WHEN** a valid text task arrives through the official bridge
- **THEN** the bridge SHALL persist its bounded receipt metadata and enqueue exactly one processable prompt before invoking the CRM adapter

#### Scenario: Duplicate inbound task
- **WHEN** the same standard A2A task is observed again after reconnect or retry
- **THEN** the bridge SHALL reuse the existing task state and SHALL NOT invoke a second concurrent Agent execution

### Requirement: Standard A2A result delivery through bridge

The official bridge SHALL deliver completed, failed, or cancelled outcomes through the standard A2A contract using text-only parts. The CRM adapter SHALL return a bounded text or failure result and SHALL not construct an unrelated reply task.

#### Scenario: Agent produces a final answer
- **WHEN** the bounded Agent execution completes successfully
- **THEN** the bridge SHALL submit one standard A2A text result associated with the originating task and mark local delivery complete

#### Scenario: Agent execution fails
- **WHEN** the Agent runtime fails, times out, or reaches a guard limit
- **THEN** the bridge SHALL submit a bounded standard A2A failure outcome, retain a redacted diagnostic record, and SHALL not expose stack traces or credentials

#### Scenario: Result submission is interrupted
- **WHEN** the Gateway is unavailable while submitting a task result
- **THEN** the bridge SHALL retain the result for retry and SHALL not rerun the completed Agent execution

### Requirement: Graceful shutdown and supervision

The long-lived bridge SHALL support graceful shutdown. It SHALL stop accepting new stream items, allow bounded in-flight work to reach a recoverable state, close active standard A2A streams, and return a non-success process status when it cannot establish or maintain required credentials.

#### Scenario: Controlled shutdown
- **WHEN** the process receives a termination signal
- **THEN** the bridge SHALL stop new work, persist in-flight task state, close the stream and queue resources, and exit without deleting recoverable task records

#### Scenario: Repeated upstream outage
- **WHEN** the standard Gateway remains unavailable across the backoff window
- **THEN** the bridge SHALL remain supervised and retry within configured limits while reporting degraded health, without busy-looping or flooding the Gateway
