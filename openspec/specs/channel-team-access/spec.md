# channel-team-access Specification

## Purpose
TBD - created by archiving change multi-channel-billing. Update Purpose after archive.
## Requirements
### Requirement: Channel Multi-Team Authorization
A Channel SHALL be shareable across multiple Teams via the `ChannelTeamAccess` relationship, enabling different departments to use the same messaging channel while maintaining independent routing and credits.

#### Scenario: Grant Channel to Team
- **WHEN** an Admin calls POST /api/v1/channels/{channelId}/teams with teamId and accessLevel
- **THEN** a ChannelTeamAccess record SHALL be created, allowing that team to use the channel

#### Scenario: Channel Already Granted
- **WHEN** an Admin attempts to grant a channel to a team that already has access
- **THEN** the request SHALL return 409 CONFLICT with error code CHANNEL_ALREADY_GRANTED

#### Scenario: Revoke Channel Access
- **WHEN** an Admin calls DELETE /api/v1/channels/{channelId}/teams/{teamId}
- **THEN** the ChannelTeamAccess record SHALL be removed and the team SHALL lose access to the channel

#### Scenario: List Teams for Channel
- **WHEN** GET /api/v1/channels/{channelId}/teams is called
- **THEN** it SHALL return all teams that have access to that channel, including their accessLevel

#### Scenario: List Channels for Team
- **WHEN** GET /api/v1/teams/{teamId}/channels is called
- **THEN** it SHALL return all channels the team has been granted access to

---

### Requirement: Access Level Enforcement
The system SHALL enforce access level restrictions when a team performs channel operations.

Access levels are defined as follows:
- `read_only` — 僅能查看入站訊息，不可回覆任何對話，不可廣播
- `reply_only` — 可回覆單一對話，不可執行廣播（Broadcast）
- `full` — 完整操作，包含回覆與廣播

#### Scenario: Full Access Team Sends Message
- **WHEN** team A has `accessLevel: 'full'` for a channel
- **THEN** agents in team A SHALL be able to send messages, reply, and broadcast via that channel

#### Scenario: Reply-Only Access Team Cannot Broadcast
- **WHEN** team A has `accessLevel: 'reply_only'` for a channel
- **AND** team A attempts to send a broadcast via that channel
- **THEN** the broadcast SHALL be rejected with 403 FORBIDDEN and error code ACCESS_LEVEL_INSUFFICIENT

#### Scenario: Read-Only Access Team Cannot Send
- **WHEN** team A has `accessLevel: 'read_only'` for a channel
- **THEN** any outbound message attempt (reply or broadcast) SHALL be rejected with 403 FORBIDDEN and error code ACCESS_LEVEL_INSUFFICIENT

---

### Requirement: Message Routing via ChannelTeamAccess
The system SHALL route inbound messages to the correct team using conversation context and team access rules.

#### Scenario: Existing Conversation Routing
- **WHEN** an inbound message arrives on a channel used by multiple teams
- **AND** a matching open Conversation already exists
- **THEN** the message SHALL be routed to the Conversation's current `teamId`

#### Scenario: New Contact Routing — Default Team
- **WHEN** an inbound message arrives from a new contact on a channel with a `defaultTeamId` set
- **THEN** the message SHALL be routed to the `defaultTeamId` and a new Conversation SHALL be created with that teamId

#### Scenario: New Contact Routing — Automation Rule
- **WHEN** an inbound message arrives from a new contact and an AutomationRule matches
- **THEN** the Automation SHALL determine the target `teamId` and override the default routing

#### Scenario: No Routing Rule — Unassigned Queue
- **WHEN** an inbound message arrives and no team routing rule matches
- **THEN** the message SHALL be placed in an unassigned queue and an admin notification SHALL be sent

---

### Requirement: Channel Creation with Default Team
During channel creation, an optional default team SHALL be assignable for initial routing.

#### Scenario: Create Channel with Default Team
- **WHEN** POST /api/v1/channels is called with `defaultTeamId` in the request body
- **THEN** the channel SHALL be created and a ChannelTeamAccess record with `accessLevel: 'full'` SHALL be auto-created for that team

#### Scenario: Create Channel without Default Team
- **WHEN** POST /api/v1/channels is called without `defaultTeamId`
- **THEN** the channel SHALL be created without any team access; an Admin MUST manually grant access before the channel can receive routed messages

---

### Requirement: Fee Attribution for Shared Channels
When a channel is shared by multiple teams, outbound message fees SHALL be attributed to the team whose conversation triggered the message.

#### Scenario: Fee Attributed to Sending Team
- **WHEN** an agent in team A sends a message on a shared WhatsApp channel with `messageFee` configured
- **THEN** the ChannelUsage record SHALL have `teamId` set to team A's ID
- **AND** the fee SHALL be deducted from team A's credits, not the global credit pool

#### Scenario: Fee with No Team Context
- **WHEN** a system-triggered outbound message has no teamId context
- **THEN** the ChannelUsage record SHALL have `teamId: null`
- **AND** the fee SHALL be deducted from the global credit pool

