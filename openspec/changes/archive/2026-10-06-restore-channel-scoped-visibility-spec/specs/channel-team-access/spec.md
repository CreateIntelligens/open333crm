## MODIFIED Requirements

### Requirement: Channel Multi-Team Authorization
A Channel SHALL be shareable across multiple Teams via the `ChannelTeamAccess` relationship. Each grant SHALL carry an `accessLevel` of `read_only`, `reply_only` or `full`. The grant, revoke and list endpoints SHALL require the `channel.assign_team` permission. The channel and the team SHALL belong to the caller's tenant.

#### Scenario: Grant Channel to Team
- **WHEN** a member with `channel.assign_team` calls `POST /api/v1/channels/{channelId}/teams` with `teamId` and `accessLevel`
- **THEN** a `ChannelTeamAccess` record SHALL be created with that `accessLevel`, and the API SHALL return HTTP 201

#### Scenario: Channel Already Granted
- **WHEN** a member with `channel.assign_team` grants a channel to a team that already has access, with a different `accessLevel`
- **THEN** the existing record SHALL be updated to the new `accessLevel`, and no second record SHALL be created

#### Scenario: Revoke Channel Access
- **WHEN** a member with `channel.assign_team` calls `DELETE /api/v1/channels/{channelId}/teams/{teamId}` for an existing grant
- **THEN** the `ChannelTeamAccess` record SHALL be removed, the team SHALL lose access to the channel, and the API SHALL return HTTP 204

#### Scenario: List Teams for Channel
- **WHEN** a member with `channel.assign_team` calls `GET /api/v1/channels/{channelId}/teams`
- **THEN** it SHALL return all teams that have access to that channel, including their `accessLevel`

#### Scenario: List Channels for Team
- **WHEN** a member with `channel.assign_team` calls `GET /api/v1/channels/teams/{teamId}/channels`
- **THEN** it SHALL return all channels the team has been granted access to, including their `accessLevel`

#### Scenario: Team of another tenant
- **WHEN** the `teamId` or the `channelId` in a grant request does not belong to the caller's tenant
- **THEN** the API SHALL return HTTP 404 and SHALL NOT create a record

#### Scenario: Revoke a grant that does not exist
- **WHEN** a member with `channel.assign_team` revokes a team that has no grant on the channel
- **THEN** the API SHALL return HTTP 404

#### Scenario: Missing permission
- **WHEN** a member without `channel.assign_team` calls any of these endpoints
- **THEN** the API SHALL return HTTP 403 and SHALL NOT change any grant

## REMOVED Requirements

### Requirement: Access Level Enforcement

**Reason**: The access levels apply to members bound directly (`AgentChannelAccess`) as well as through teams, and they control conversation and case operations, not broadcasts. Issue #217 decided that broadcasts are controlled by the `marketing.broadcast` permission and not by the channel access level. The scenario names of this requirement describe broadcast limits, so the requirement cannot be kept as a MODIFIED requirement.

**Migration**: The access level rules are in the "存取層級" requirement of `channel-scoped-visibility`. The error code is `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`.

### Requirement: Fee Attribution for Shared Channels

**Reason**: The requirement depends on `ChannelUsage` and per-team credits from the license design. PR #224 removed the main specs `channel-billing` and `team-license` that described that design, and no code records `ChannelUsage` or deducts team credits.

**Migration**: None. Plan limits and usage are in `tenant-plan`, `plan-limits-core` and `granular-plan-entitlement`.
