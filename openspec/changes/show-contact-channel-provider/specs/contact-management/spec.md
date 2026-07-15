## ADDED Requirements

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
