## ADDED Requirements

### Requirement: Agent can sync LINE contact profile on demand
The system SHALL expose an authenticated API endpoint that fetches a LINE contact's current `displayName` and `pictureUrl` from the LINE Messaging API and updates the corresponding `ChannelIdentity` record.

#### Scenario: Successful profile sync
- **WHEN** an authenticated agent calls `PATCH /api/channels/:channelId/contacts/:lineUid/sync-profile`
- **THEN** the system calls `GET /v2/bot/profile/{lineUid}` on the LINE Messaging API using the channel's `channelAccessToken`
- **THEN** `ChannelIdentity.profileName` is updated to the returned `displayName`
- **THEN** `ChannelIdentity.profilePic` is updated to the returned `pictureUrl`
- **THEN** the endpoint returns HTTP 200 with the updated `ChannelIdentity` fields

#### Scenario: Contact.displayName is not modified
- **WHEN** a profile sync completes successfully
- **THEN** `Contact.displayName` remains unchanged
- **THEN** `Contact.avatarUrl` remains unchanged

#### Scenario: Unknown channelId or lineUid returns 404
- **WHEN** no `ChannelIdentity` exists for the given `channelId` and `lineUid`
- **THEN** the endpoint returns HTTP 404

#### Scenario: Unauthenticated request rejected
- **WHEN** the request has no valid JWT
- **THEN** the endpoint returns HTTP 401

#### Scenario: LINE API error is surfaced
- **WHEN** the LINE Messaging API returns a non-200 response (e.g. invalid UID or revoked token)
- **THEN** the endpoint returns HTTP 502 with an error message describing the upstream failure

### Requirement: Profile sync is scoped to a single contact
The sync endpoint SHALL operate on exactly one `ChannelIdentity` identified by `channelId` + `lineUid`. Bulk sync is not supported by this endpoint.

#### Scenario: Only targeted identity is updated
- **WHEN** `PATCH /api/channels/:channelId/contacts/:lineUid/sync-profile` is called
- **THEN** only the `ChannelIdentity` matching `channelId` + `lineUid` is modified
- **THEN** no other `ChannelIdentity` or `Contact` records are affected
