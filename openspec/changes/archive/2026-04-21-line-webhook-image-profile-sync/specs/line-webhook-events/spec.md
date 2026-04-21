## MODIFIED Requirements

### Requirement: Immediate media download on receipt
The system SHALL handle inbound LINE media messages (image / video / audio / file) according to the `contentProvider` field in the webhook payload:

- If `contentProvider.type === "external"`: the system SHALL store the `originalContentUrl` directly as `Message.content.url` without downloading or uploading to the Storage Layer.
- If `contentProvider.type === "line"` (default when field is absent): the system SHALL enqueue a download from `GET /v2/bot/message/{messageId}/content`, upload to the Storage Layer, and update `Message.content.url` with the permanent storage URL.

#### Scenario: External-provider image stored directly
- **WHEN** a Webhook `message` event of type `image` arrives with `contentProvider.type === "external"`
- **THEN** `Message.content.url` is set to the `originalContentUrl` from the payload
- **THEN** no download from LINE's Content API is triggered
- **THEN** no upload to MinIO/Storage Layer occurs

#### Scenario: External-provider image uses previewUrl
- **WHEN** a Webhook `message` event of type `image` arrives with `contentProvider.type === "external"` and a `previewImageUrl`
- **THEN** `Message.content.previewUrl` is set to `previewImageUrl`

#### Scenario: LINE-hosted image downloaded and stored
- **WHEN** a Webhook `message` event of type `image` arrives with `contentProvider.type === "line"` or no `contentProvider`
- **THEN** the system enqueues a BullMQ job to download from `GET /v2/bot/message/{messageId}/content` and upload to Storage Layer
- **THEN** `Message.content.url` is updated with the permanent Storage URL after upload completes

#### Scenario: Video downloaded and stored
- **WHEN** a Webhook `message` event of type `video` arrives with `contentProvider.type === "line"` or no `contentProvider`
- **THEN** the system enqueues download and storage as for images

#### Scenario: Audio downloaded and stored
- **WHEN** a Webhook `message` event of type `audio` arrives with `contentProvider.type === "line"` or no `contentProvider`
- **THEN** the system enqueues download and storage as for images
