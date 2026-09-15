## Purpose

讓 Open333CRM 以標準 A2A HTTP+JSON agent 身分連接 888a2a-lite，維持可自動恢復的長駐串流，並可靠地接收、處理及回傳跨 Agent 任務結果。

## ADDED Requirements

### Requirement: Standard A2A Gateway discovery

The system SHALL discover the A2A Gateway from the configured Hub Agent Card and SHALL use the advertised standard HTTP+JSON interface for data-plane operations. The system SHALL NOT use `llms.txt` as runtime configuration and SHALL NOT silently downgrade standard data-plane traffic to legacy Hub task routes.

#### Scenario: Gateway advertises a supported standard interface
- **WHEN** the bridge starts and the Hub Agent Card contains a supported HTTP+JSON A2A interface
- **THEN** the bridge SHALL validate the interface URL and protocol version before opening the persistent connection

#### Scenario: Standard interface is unavailable or fails its capability gate
- **WHEN** discovery does not advertise a usable standard A2A interface
- **THEN** the bridge SHALL remain disconnected, expose a clear health error, and SHALL NOT send tasks through legacy `/hub/v1` data-plane routes

### Requirement: A2A registration and credential lifecycle

The system SHALL support an explicit registration bootstrap against the Hub registration endpoint. The configured `A2A_HUB_KEY` environment secret SHALL be sent as `X-Hub-Key` only for registration or key rotation. After successful registration, standard A2A requests SHALL use the issued Agent ID and Bearer Agent Token loaded from runtime secrets.

#### Scenario: First registration
- **WHEN** no valid Agent ID and Agent Token are available
- **THEN** the controlled bootstrap operation SHALL read `A2A_HUB_KEY`, register an idempotent Agent identity, and provide the returned credentials for storage as `A2A_AGENT_ID` and `A2A_AGENT_TOKEN` through the deployment secret mechanism

#### Scenario: Ordinary standard A2A request
- **WHEN** the bridge sends a discovery, message, task, or stream request after registration
- **THEN** the request SHALL include the Agent Token as a Bearer credential and SHALL NOT include the Hub key as ordinary authentication

#### Scenario: Credential rejected or expired
- **WHEN** the Gateway rejects the Agent Token as invalid or expired
- **THEN** the bridge SHALL stop processing new tasks, report an authentication error, and require controlled credential rotation or re-registration

#### Scenario: Hub key rotation
- **WHEN** the operator replaces `A2A_HUB_KEY`
- **THEN** the bridge SHALL continue using the existing Agent Token until the controlled rotation operation completes, and SHALL not send the new Hub key on ordinary A2A requests

### Requirement: Long-lived standard A2A streaming connection

The system SHALL maintain a long-lived connection to the standard A2A streaming or task-subscription operation for the registered Agent. A network disconnect SHALL be treated as a recoverable connection state, not as permanent bridge termination.

#### Scenario: Persistent connection established
- **WHEN** the standard Gateway accepts the Agent credentials and stream subscription
- **THEN** the bridge SHALL remain connected, consume task/message updates, process keepalive events, and publish connection health

#### Scenario: Keepalive received
- **WHEN** the stream returns a keepalive or comment event
- **THEN** the bridge SHALL treat the connection as healthy and SHALL NOT create an application task

#### Scenario: Connection interrupted
- **WHEN** the stream ends, times out, or the underlying connection fails
- **THEN** the bridge SHALL preserve uncompleted work, close the old stream, and reconnect using bounded exponential backoff with jitter

### Requirement: Reconnect and task resumption

The system SHALL resume standard A2A task observation after reconnect without losing tasks that were accepted by the Gateway. The bridge SHALL use the standard task get/list/subscribe operations and locally retained task state to reconcile in-flight work.

#### Scenario: Reconnect after a partial stream failure
- **WHEN** the bridge reconnects after receiving some but not all updates for an in-flight task
- **THEN** the bridge SHALL query or resubscribe to the task through the standard A2A interface and SHALL reconcile the task before acknowledging completion locally

#### Scenario: Bridge process restarts
- **WHEN** the bridge process restarts with unfinished local task records
- **THEN** it SHALL reload those records, reconnect to the standard Gateway, and resume or safely finalize each task without creating a duplicate reply

### Requirement: Durable inbound task handoff

The bridge SHALL durably record an inbound standard A2A task or enqueue it into a durable processing queue before beginning LLM execution. Task identity and context identity SHALL be used for idempotency, and duplicate deliveries SHALL not start more than one active execution for the same logical task.

#### Scenario: New inbound task
- **WHEN** a valid text task arrives from the standard A2A stream
- **THEN** the bridge SHALL persist its bounded receipt metadata and enqueue exactly one processable task before invoking the Agent runtime

#### Scenario: Duplicate inbound task
- **WHEN** the same standard A2A task is observed again after reconnect or retry
- **THEN** the bridge SHALL reuse the existing task state and SHALL NOT invoke a second concurrent Agent execution

### Requirement: Standard A2A result delivery

The system SHALL deliver completed, failed, or cancelled task outcomes through the standard A2A HTTP+JSON contract using text-only parts supported by the Gateway. The bridge SHALL preserve the Gateway task identity and SHALL make result submission idempotent.

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
