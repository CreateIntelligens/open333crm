## ADDED Requirements

### Requirement: Cases Dashboard Deletion
The `/dashboard/cases` page SHALL allow an authenticated user to delete an existing Case from the cases list by using the tenant-scoped Case deletion API. A delete action SHALL be isolated from row navigation, SHALL ask for confirmation before deleting, and SHALL refresh the displayed cases after a successful deletion.

#### Scenario: Delete case from list
- **WHEN** a user confirms deletion of a Case from `/dashboard/cases`
- **THEN** the frontend calls the Case deletion API for that Case and removes the deleted Case from the refreshed list

#### Scenario: Delete action does not navigate
- **WHEN** a user clicks the delete action on a Case row
- **THEN** the row navigation to the Case detail page is not triggered

#### Scenario: Delete fails
- **WHEN** the Case deletion API returns an error
- **THEN** the deleted Case remains visible after refresh and the user receives an error indication

### Requirement: Cases Dashboard Create Button Hidden
The `/dashboard/cases` page SHALL NOT display the standalone create-case button or open the standalone create-case modal. Case creation from conversation context in `/dashboard/inbox` SHALL remain available.

#### Scenario: Cases page has no create button
- **WHEN** a user opens `/dashboard/cases`
- **THEN** no standalone "建立案件" button is displayed in the page topbar

#### Scenario: Inbox create case still available
- **WHEN** a user opens a conversation in `/dashboard/inbox`
- **THEN** the inbox contact panel can still open the create-case modal for that conversation
