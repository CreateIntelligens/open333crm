## ADDED Requirements

### Requirement: Tenant admin can set GA4 Measurement ID

The system SHALL allow ADMIN or SUPERVISOR roles to set a Google Analytics 4 Measurement ID (e.g., `G-XXXXXXXXXX`) at the tenant level via `PUT /api/v1/settings/tracking`.

#### Scenario: Set GA4 ID

- **WHEN** an ADMIN sends `PUT /api/v1/settings/tracking` with `{ "gaId": "G-ABC123" }`
- **THEN** the system stores `gaId = "G-ABC123"` in the tenant's `TenantSettings` record

#### Scenario: Clear GA4 ID

- **WHEN** an ADMIN sends `PUT /api/v1/settings/tracking` with `{ "gaId": null }`
- **THEN** the system sets `gaId = null` in the tenant's `TenantSettings` record

### Requirement: Tenant admin can set Meta Pixel ID

The system SHALL allow ADMIN or SUPERVISOR roles to set a Meta (Facebook) Pixel ID at the tenant level via `PUT /api/v1/settings/tracking`.

#### Scenario: Set Meta Pixel ID

- **WHEN** an ADMIN sends `PUT /api/v1/settings/tracking` with `{ "metaPixelId": "1234567890" }`
- **THEN** the system stores `metaPixelId = "1234567890"` in the tenant's `TenantSettings` record

#### Scenario: Clear Meta Pixel ID

- **WHEN** an ADMIN sends `PUT /api/v1/settings/tracking` with `{ "metaPixelId": null }`
- **THEN** the system sets `metaPixelId = null` in the tenant's `TenantSettings` record

### Requirement: Tracking settings are retrievable

The system SHALL return the current tenant's tracking settings via `GET /api/v1/settings/tracking`.

#### Scenario: Get tracking settings

- **WHEN** an ADMIN sends `GET /api/v1/settings/tracking`
- **THEN** the system returns `{ "gaId": "G-ABC123", "metaPixelId": "1234567890" }` (or null values if not set)

#### Scenario: Get tracking settings with defaults

- **WHEN** the tenant has never configured tracking settings
- **THEN** the system returns `{ "gaId": null, "metaPixelId": null }`

### Requirement: Non-admin users cannot modify tracking settings

The system SHALL reject tracking setting updates from users with AGENT role.

#### Scenario: Agent attempts to update tracking settings

- **WHEN** a user with AGENT role sends `PUT /api/v1/settings/tracking`
- **THEN** the system returns HTTP 403 Forbidden

### Requirement: Frontend provides tracking settings form

The system SHALL display a "追蹤設定" tab in the settings page with input fields for GA4 Measurement ID and Meta Pixel ID.

#### Scenario: Display tracking settings tab

- **WHEN** an ADMIN or SUPERVISOR navigates to `/dashboard/settings` and clicks the "追蹤設定" tab
- **THEN** the system displays a form with two input fields: "Google Analytics 4 ID" and "Meta Pixel ID", pre-filled with current values

#### Scenario: Save tracking settings

- **WHEN** the user fills in the GA4 ID field and clicks "儲存"
- **THEN** the system calls `PUT /api/v1/settings/tracking` and shows a success toast

#### Scenario: Validation feedback

- **WHEN** the user clicks "儲存" with empty fields
- **THEN** the system saves successfully (both fields are optional — null means disabled)
