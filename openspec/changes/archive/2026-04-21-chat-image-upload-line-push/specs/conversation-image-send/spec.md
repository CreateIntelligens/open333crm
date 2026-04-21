## ADDED Requirements

### Requirement: Agent can upload and push a PNG image in a LINE conversation
The system SHALL provide `POST /api/v1/conversations/:conversationId/send-image` accepting `multipart/form-data` with a single `file` field of type `image/png`. The endpoint SHALL upload the file to MinIO, persist an outbound `Message`, and deliver the image to the LINE contact.

#### Scenario: Successful image push to LINE
- **WHEN** an authenticated agent posts a valid `image/png` file ≤ 20 MB to `/conversations/:id/send-image`
- **THEN** the API returns HTTP 201 with the created message object
- **AND** the image is uploaded to MinIO under `{tenantId}/media/{conversationId}/{uuid}.png`
- **AND** an outbound `Message` is written with `contentType = 'image'` and `content.mediaUrl` set to the MinIO public URL
- **AND** LINE receives a push message with `type: 'image'`

#### Scenario: Non-LINE channel returns 501
- **WHEN** the conversation's channel type is not `LINE`
- **THEN** the API returns HTTP 501 with `code: NOT_IMPLEMENTED`

#### Scenario: Wrong MIME type rejected
- **WHEN** the uploaded file has a MIME type other than `image/png`
- **THEN** the API returns HTTP 400 with `code: BAD_REQUEST`

#### Scenario: File too large rejected
- **WHEN** the uploaded file exceeds 20 MB
- **THEN** the API returns HTTP 400 with `code: BAD_REQUEST`

#### Scenario: Missing file rejected
- **WHEN** the request contains no `file` field
- **THEN** the API returns HTTP 400 with `code: BAD_REQUEST`
