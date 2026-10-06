## MODIFIED Requirements

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
