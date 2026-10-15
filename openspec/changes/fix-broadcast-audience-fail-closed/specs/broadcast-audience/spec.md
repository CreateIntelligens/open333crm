## Purpose

規定廣播受眾一定要能解析成明確的名單：沒選分群、標籤或聯絡人，分群沒有有效條件，或分群已被刪除時，一律拒絕發送，絕不退化成發給渠道全部聯絡人；同一則廣播同時只能有一個發送程序。

## ADDED Requirements

### Requirement: Broadcast Audience Selection Is Required
When a broadcast is created with `targetType` `segment`, `tags` or `contacts`, the system SHALL require a segment ID, at least one tag ID, or at least one contact ID respectively. Otherwise it SHALL respond 400 with code `INVALID_AUDIENCE` naming the missing field, and SHALL NOT create the broadcast. This applies to the REST API and MCP tools.

#### Scenario: Tags target without tags
- **WHEN** a user creates a broadcast with `targetType = tags` and no `targetConfig.tagIds`
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `targetConfig.tagIds` and no broadcast SHALL be created

#### Scenario: Contacts target without contacts
- **WHEN** a user creates a broadcast with `targetType = contacts` and an empty `targetConfig.contactIds`
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `targetConfig.contactIds`

#### Scenario: Segment target without segment
- **WHEN** a user creates a broadcast with `targetType = segment` and no `segmentId`
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `segmentId`

#### Scenario: Segment without conditions
- **WHEN** a user creates a broadcast for a segment that has no condition with a value
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `segmentId`

#### Scenario: Tags target with tags
- **WHEN** a user creates a broadcast with `targetType = tags` and one tag ID
- **THEN** the broadcast SHALL be created

### Requirement: Broadcast Send Stops When The Audience Cannot Be Resolved
When a broadcast is sent, manually or by the scheduler, and its audience cannot be resolved, the system SHALL send no message, SHALL mark the broadcast `failed`, and SHALL throw an error with a reason in Chinese. The audience cannot be resolved when the segment is missing or deleted, the segment has no condition with a value, or the tag or contact list is empty. The system SHALL NOT fall back to all contacts of the channel.

#### Scenario: Segment deleted before a scheduled send
- **WHEN** a scheduled broadcast targets a segment that was deleted
- **THEN** no message SHALL be sent, the broadcast SHALL be `failed`, and the error code SHALL be `INVALID_AUDIENCE`

#### Scenario: Legacy broadcast with an empty tag list
- **WHEN** a draft broadcast created before this rule has `targetType = tags` and no tag IDs, and a user sends it
- **THEN** no message SHALL be sent and the broadcast SHALL be `failed`

#### Scenario: Segment without conditions at send time
- **WHEN** a broadcast targets a segment whose conditions all have empty values
- **THEN** no message SHALL be sent and the broadcast SHALL be `failed`

### Requirement: Segment Conditions Have Values
When a segment is created or its rules are updated, the system SHALL require at least one condition, and every condition SHALL have a non-empty value. Otherwise it SHALL respond 400 with code `INVALID_SEGMENT_RULES`. When the system counts the contacts of rules that have no condition with a value, the count SHALL be 0, not all contacts.

#### Scenario: Create a segment with an empty condition value
- **WHEN** a user creates a segment whose only condition is `channelType` with an empty value
- **THEN** the system SHALL respond 400 with code `INVALID_SEGMENT_RULES` and no segment SHALL be created

#### Scenario: Create a segment with no conditions
- **WHEN** a user creates a segment with an empty `conditions` array
- **THEN** the system SHALL respond 400 with code `INVALID_SEGMENT_RULES`

#### Scenario: Preview rules without conditions
- **WHEN** a user previews the count of rules with no condition that has a value
- **THEN** the count SHALL be 0

### Requirement: A Broadcast Is Sent Once At A Time
The system SHALL start sending a broadcast only from status `draft`, `scheduled` or `failed`, and SHALL change the status to `sending` with one conditional update. If the update changes no row, because the broadcast is already `sending` or another request started it first, the system SHALL respond 409 with code `BROADCAST_ALREADY_SENDING` and SHALL send no message. The send button in the web console SHALL be disabled while its request runs.

#### Scenario: Send a broadcast that is sending
- **WHEN** a user sends a broadcast whose status is `sending`
- **THEN** the system SHALL respond 409 with code `BROADCAST_ALREADY_SENDING` and no message SHALL be sent

#### Scenario: Two send requests at the same time
- **WHEN** two requests send the same draft broadcast and the second conditional update changes no row
- **THEN** the second request SHALL respond 409 and only the first request SHALL send messages

#### Scenario: Retry a failed broadcast
- **WHEN** a user sends a broadcast whose status is `failed`
- **THEN** the system SHALL send it again

#### Scenario: Send button while sending
- **WHEN** a user clicks the send button of a draft broadcast and the request has not finished
- **THEN** the send button of that broadcast SHALL be disabled

### Requirement: Broadcast Material Matches The Channel
When a broadcast is created with a material, the material's channel type SHALL match the broadcast channel (`line` for `LINE`, `fb` for `FB`). Otherwise the system SHALL respond 400 with code `MATERIAL_CHANNEL_MISMATCH` naming `materialId`. The web console SHALL list only the materials of the selected channel type.

#### Scenario: FB material on a LINE channel
- **WHEN** a user creates a broadcast on a `LINE` channel with a material whose channel type is `fb`
- **THEN** the system SHALL respond 400 with code `MATERIAL_CHANNEL_MISMATCH` and no broadcast SHALL be created

#### Scenario: Material list follows the channel
- **WHEN** a user selects a `LINE` channel in the create-broadcast dialog
- **THEN** the material list SHALL request only materials with channel type `line`
