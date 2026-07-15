## Purpose

Contact management maintains tenant-scoped customer profiles, channel identities, duplicate handling, and contacts dashboard list behavior.

## Requirements

### Requirement: Identity Resolution
The system SHALL automatically link channel identities based on common identifiers (phone/email).

#### Scenario: Linking LINE user via Phone
- **GIVEN** an existing Contact with phone `0912345678`
- **WHEN** a new LINE message arrives from a user who has previously shared their phone `0912345678` in a lead form
- **THEN** the LINE identity is linked to the existing Contact instead of creating a new one

### Requirement: Contact Merging
The system SHALL support manual merging of two contact records.

#### Scenario: Merging duplicates
- **WHEN** a supervisor selects Contact A to be merged into Contact B
- **THEN** all tags, attributes, and channel identities from A are moved to B, and A is deleted

### Requirement: Contact List Channel Provider Display
The system SHALL expose and display provider metadata for each contact channel identity in the contacts list.

#### Scenario: Listing contacts with channel provider metadata
- **WHEN** an authenticated user requests the contacts list
- **THEN** each returned channel identity includes its channel type and the related provider channel's display name when a provider channel exists

#### Scenario: Displaying provider type and provider name
- **WHEN** a contact row has one or more channel identities with provider channel metadata
- **THEN** `/dashboard/contacts` displays both the provider type and the provider display name in the channel column for each identity

#### Scenario: Missing provider metadata fallback
- **WHEN** a contact channel identity does not include related provider channel metadata
- **THEN** `/dashboard/contacts` still displays the identity channel type without breaking the contacts table

### Requirement: Contact List WebChat Channel Visibility
The system SHALL support requesting contact list results that exclude WebChat-only contacts and omit WebChat identities from returned contact channel identity payloads.

#### Scenario: Contact list API excludes WebChat-only contacts and WebChat identities
- **WHEN** an authenticated user requests `/api/v1/contacts` with a filter that excludes `WEBCHAT` channel identities
- **THEN** returned contacts include only contacts that have at least one non-WebChat channel identity
- **AND** returned contacts omit `WEBCHAT` identities from each contact's `channelIdentities` array
- **AND** pagination counts are calculated from the same WebChat-excluding contact filter

#### Scenario: Contacts dashboard requests WebChat-excluded results
- **WHEN** `/dashboard/contacts` loads the contacts list
- **THEN** it calls `/api/v1/contacts` with the WebChat-exclusion filter
- **AND** the channel column displays only the channel identities returned by the API

#### Scenario: Contact has only WebChat identities
- **WHEN** a contact has only WebChat channel identities
- **THEN** `/dashboard/contacts` does not include that contact in the contacts list response
- **AND** the contact can still be accessed through non-list contact detail APIs when addressed directly

#### Scenario: Contact details keep WebChat identity data
- **WHEN** a user opens or requests a contact detail view for a contact with WebChat identities
- **THEN** WebChat identities remain available outside the contacts list channel-column display

### Requirement: Contacts Dashboard Pagination
The system SHALL expose pagination controls on `/dashboard/contacts` backed by `/api/v1/contacts` pagination metadata.

#### Scenario: Rendering contact list pagination
- **WHEN** `/dashboard/contacts` receives a paginated contact list response with more than one page
- **THEN** the page displays pagination controls and current total information

#### Scenario: Changing contact list page
- **WHEN** a user changes page from `/dashboard/contacts`
- **THEN** the next `/api/v1/contacts` request includes the selected `page` and configured `limit`

#### Scenario: Searching contacts resets pagination
- **WHEN** a user submits a new contact search query
- **THEN** `/dashboard/contacts` resets to page 1 before requesting results
