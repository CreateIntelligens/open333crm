# channel-visibility-defaults Specification

## Purpose
定義成員可見哪些渠道，以及預設的綁定：沒有綁定的渠道只有持有 `channel.view_all` 的成員看得到；既有渠道的回填；新增渠道與新增成員時指定可見範圍；自動派案只派給看得到渠道的成員。

## Requirements

### Requirement: Unbound Channel Is Not Visible
A member without `channel.view_all` SHALL see only the active channels that are bound to the member directly (`AgentChannelAccess`) or through a team the member belongs to (`ChannelTeamAccess`). The accessible channel set SHALL be the union of both sources. A channel with no binding at all SHALL NOT be visible to such a member, in lists or in single-channel access checks. A member with `channel.view_all` SHALL see every channel.

#### Scenario: Unbound channel hidden from a member
- **WHEN** a channel has no team binding and no member binding, and a member without `channel.view_all` lists accessible channels
- **THEN** the channel is not in the list, and the member's access level to it is none

#### Scenario: Member without any binding
- **WHEN** a member without `channel.view_all` has no direct binding and no team binding
- **THEN** the accessible channel set is empty

#### Scenario: Head office sees every channel
- **WHEN** a member with `channel.view_all` resolves accessible channels
- **THEN** the result covers all channels, including unbound ones

#### Scenario: Inactive channel hidden
- **WHEN** a channel is bound to a member directly, and the channel is deactivated
- **THEN** the channel is not in the member's accessible channel set

#### Scenario: Direct and team bindings combined
- **WHEN** a member is bound to channel CH-C directly, and a team the member belongs to is bound to channel CH-A
- **THEN** the member's accessible channel set is {CH-A, CH-C}

#### Scenario: Several teams combined
- **WHEN** a member belongs to team A, which is bound to channel CH-A, and to team B, which is bound to channel CH-B
- **THEN** the member's accessible channel set is {CH-A, CH-B}

### Requirement: Existing Unbound Channels Are Backfilled
A migration SHALL bind every channel that has no team binding and no member binding, including inactive channels, to every active member of the same tenant, with `accessLevel` `full`. Channels that already have a binding SHALL NOT change. Inactive members SHALL NOT be bound. Running the backfill again SHALL NOT create duplicates. When the executing database role can neither bypass row-level security nor is a superuser, the migration SHALL abort with an error instead of writing nothing.

#### Scenario: Unbound channel bound to all active members
- **WHEN** a tenant has an unbound channel, two active members and one inactive member, and the migration runs
- **THEN** the channel is bound to the two active members with `full`, and not to the inactive member

#### Scenario: Bound channel unchanged
- **WHEN** a channel is bound to one member and the migration runs
- **THEN** the channel still has exactly that one binding

#### Scenario: Backfill runs twice
- **WHEN** the backfill statement runs a second time
- **THEN** no binding is added

### Requirement: New Channel Is Visible To Chosen Members
`POST /channels` SHALL accept `visibleAgentIds` and bind the new channel to those members with `full`, in the same transaction that creates the channel. When `visibleAgentIds` is omitted, the channel SHALL be bound to every active member of the tenant. When an ID is not an active member of the tenant, the API SHALL return HTTP 400 and SHALL NOT create the channel. When the creator does not hold `channel.view_all` and is not in `visibleAgentIds`, the creator SHALL be added. A channel connected through Meta SHALL be bound to every active member. When writing the bindings fails, the new channel SHALL be removed. The channel form SHALL send `visibleAgentIds` only when not every member is selected. The channel form SHALL list the tenant's active members with all of them selected by default.

#### Scenario: Channel created for chosen members
- **WHEN** an administrator creates a channel with `visibleAgentIds` of one member
- **THEN** the channel is bound only to that member

#### Scenario: Channel created without choosing members
- **WHEN** an API client creates a channel without `visibleAgentIds`
- **THEN** the channel is bound to every active member of the tenant

#### Scenario: Creator without head-office access stays visible
- **WHEN** a creator without `channel.view_all` creates a channel with `visibleAgentIds` that does not include the creator
- **THEN** the channel is also bound to the creator

#### Scenario: Unknown member rejected
- **WHEN** `visibleAgentIds` contains an ID that is not an active member of the tenant
- **THEN** the API returns HTTP 400 and no channel is created

### Requirement: New Member Sees Chosen Channels
`POST /agents` SHALL accept `channelIds` and bind the new member to those channels with `full`, in the same transaction that creates the member. When `channelIds` is omitted, the member SHALL be bound to every channel the creator can see; for a creator with `channel.view_all`, that is every channel of the tenant. A creator with neither `channel.view_all` nor `channel.assign_team` SHALL only choose channels the creator can see, and each binding SHALL NOT exceed the creator's own access level on that channel; otherwise the API SHALL return HTTP 403 and SHALL NOT create the member. The new-member form SHALL send `channelIds` only when not every channel is selected. The new-member form SHALL list the channels the creator can choose, all selected by default.

#### Scenario: Member created with chosen channels
- **WHEN** an administrator creates a member with `channelIds` of one channel
- **THEN** the member is bound only to that channel

#### Scenario: Member created without choosing channels
- **WHEN** an administrator with `channel.view_all` creates a member without `channelIds`
- **THEN** the member is bound to every channel of the tenant

#### Scenario: New member's level capped at the creator's level
- **WHEN** a creator without `channel.view_all` and without `channel.assign_team` has `read_only` on a channel and creates a member with that channel
- **THEN** the new member's binding is `read_only`

#### Scenario: Creator cannot grant a channel they cannot see
- **WHEN** a creator without `channel.view_all` and without `channel.assign_team` sends a channel the creator cannot see
- **THEN** the API returns HTTP 403 and no member is created

### Requirement: Automatic Case Assignment Respects Channel Visibility
Round-robin case assignment SHALL only pick a member who is bound to the case's channel, directly or through a team, at level `reply_only` or `full`. When no such member exists, the case SHALL stay unassigned.

#### Scenario: Assignment skips members who cannot see the channel
- **WHEN** a case is created on a channel bound to one member, and another member with fewer open cases is not bound to it
- **THEN** the case is assigned to the bound member

#### Scenario: Nobody can see the channel
- **WHEN** no member is bound to the case's channel at `reply_only` or `full`
- **THEN** the case stays unassigned

