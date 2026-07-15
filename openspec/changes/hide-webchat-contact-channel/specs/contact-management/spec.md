## ADDED Requirements

### Requirement: Contact List WebChat Channel Visibility
The system SHALL support requesting contact list results whose channel identity payload excludes WebChat identities without removing contacts from the list.

#### Scenario: Contact list API excludes WebChat identities from payload
- **WHEN** an authenticated user requests `/api/v1/contacts` with a filter that excludes `WEBCHAT` channel identities
- **THEN** returned contacts omit `WEBCHAT` identities from each contact's `channelIdentities` array
- **AND** contacts are not removed solely because they have WebChat identities

#### Scenario: Contacts dashboard requests WebChat-excluded results
- **WHEN** `/dashboard/contacts` loads the contacts list
- **THEN** it calls `/api/v1/contacts` with the WebChat-exclusion filter
- **AND** the channel column displays only the channel identities returned by the API

#### Scenario: Contact has only WebChat identities
- **WHEN** `/dashboard/contacts` renders a contact whose filtered `channelIdentities` array is empty because all identities were `WEBCHAT`
- **THEN** the contact row remains visible
- **AND** the channel column displays the empty channel placeholder

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
