## ADDED Requirements

### Requirement: LIFF App management
The system SHALL allow administrators to manage LIFF (LINE Front-end Framework) Apps associated with a LINE OA channel.

#### Scenario: List LIFF Apps
- **WHEN** an administrator views the LIFF Apps page for a LINE channel
- **THEN** the system calls `GET /liff/v1/apps` and displays all registered LIFF Apps

#### Scenario: Create LIFF App
- **WHEN** an administrator creates a new LIFF App with a view type (compact / tall / full) and URL
- **THEN** the system calls `POST /liff/v1/apps` and stores the returned `liffId`

#### Scenario: Update LIFF App
- **WHEN** an administrator updates the URL or view type of an existing LIFF App
- **THEN** the system calls `PUT /liff/v1/apps/{liffId}` with the updated configuration

#### Scenario: Delete LIFF App
- **WHEN** an administrator deletes a LIFF App
- **THEN** the system calls `DELETE /liff/v1/apps/{liffId}` and removes the record from DB
