## ADDED Requirements

### Requirement: Merge Rejects Same-Channel Identities
The merge engine SHALL reject a merge when the survivor and the merged contact both have an identity on the same channel, on every merge path. The check SHALL run after both contacts are locked. A rejected merge SHALL respond 409 with code `SAME_CHANNEL_CONFLICT`, list the conflicting channels in `details.channels`, and change nothing.

#### Scenario: Agent merges two contacts on the same LINE channel
- **WHEN** an agent with `contact.merge` merges contact A into contact B, and both have an identity on the same LINE channel
- **THEN** the system SHALL respond 409 with code `SAME_CHANNEL_CONFLICT`, `details.channels` SHALL contain that LINE channel's id and display name, A SHALL stay active, and no merge log SHALL be written

#### Scenario: Approving a suggestion for two contacts on the same channel
- **WHEN** a reviewer approves a merge suggestion whose two contacts both have an identity on the same FB channel
- **THEN** the system SHALL respond 409 with code `SAME_CHANNEL_CONFLICT` and the suggestion SHALL stay `PENDING`

#### Scenario: Two merges into the same survivor at the same time
- **WHEN** contact B has only a FB identity, contacts A1 and A2 each have an identity on the same LINE channel, and A1 and A2 are merged into B at the same time
- **THEN** exactly one merge SHALL succeed, the other SHALL be rejected with `SAME_CHANNEL_CONFLICT`, and B SHALL have exactly one identity on that LINE channel

#### Scenario: Contacts on different channels
- **WHEN** contact A has only a LINE identity and contact B has only a FB identity
- **THEN** the merge SHALL succeed

#### Scenario: Merge window shows the reason
- **WHEN** a manual merge from the contact merge window is rejected with `SAME_CHANNEL_CONFLICT`
- **THEN** the window SHALL show the message returned by the API, which names the conflicting channel, and SHALL stay open
