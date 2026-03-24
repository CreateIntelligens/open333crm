## ADDED Requirements

### Requirement: Agnostic Storage Abstraction
The system SHALL isolate all file operations (upload, URL generation, deletion) behind a common Storage Layer interface.

#### Scenario: Uploading an attachment
- **WHEN** the system needs to save an incoming image message
- **THEN** it calls the Storage Layer's `upload()` method without needing to know if the backend is MinIO or S3

### Requirement: Immediate Media Retention
The system SHALL immediately download external media to local storage to prevent expiration of temporary URLs.

#### Scenario: Saving a LINE media file
- **WHEN** a media message arrives with a temporary external URL
- **THEN** the system downloads the file and uploads it to the Storage Layer before marking the message as read
