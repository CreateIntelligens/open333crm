# Design: CRM Core Logic

## Architecture Overview
The CRM logic resides in `packages/core` and is exposed via `apps/api`. It relies on the shared Redis Event Bus for trigger evaluation.

## Component Design

### 1. Case Lifecycle Manager (`CaseService`)
- **State Machine**: Validates status transitions (e.g., cannot move from `closed` directly to `open`).
- **SLA Worker**: A recurring BullMQ job that periodically checks for `sla_warning` or `sla_breached` events and publishes them to the Event Bus.
- **Assignment**: Implements a simple load-based assignment (assigning to the agent with the fewest open cases).

### 2. Contact Identity Resolver (`ContactService`)
- **Match Strategy**: When a new identity comes in (e.g., LINE userId), the system checks for existing contacts with the same phone/email before creating a new one.
- **Merge Engine**: Merges `Contact A` into `Contact B`, reparenting all `ChannelIdentities`, `Cases`, and `Conversations`.

### 3. Automation Runner (`AutomationEngine`)
- **Rule Loader**: Fetches active rules from the database and loads them into `json-rules-engine`.
- **Action Registry**: A mapping of action names (e.g., `send_message`) to implementation functions in the core services.
- **Execution Log**: Stores every automation run in `AutomationExecutionLog` for debugging.

## Data Model Enhancements
- Enhance `Case` model with `slaFirstResponseAt` and `slaResolutionAt`.
- Use `ContactRelation` to build the family/referrer graph.
