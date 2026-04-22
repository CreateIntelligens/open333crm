## Requirements

### Requirement: Agent can send an image to an FB conversation

Agents must be able to upload an image file and deliver it to FB Messenger contacts via the same `send-image` endpoint used for LINE. The frontend `MessageInput` component SHALL allow image selection for both LINE and FB channel types.

#### Scenario: Agent sends image on FB channel via UI

- **WHEN** the conversation is on the `FB` channel and the agent selects an image in MessageInput
- **THEN** `POST /api/v1/conversations/:id/send-image` is called, the image is uploaded to S3, a `Message` (OUTBOUND) is created, and the FB Graph API `me/messages` endpoint is called with `attachment.type=image` and the S3 URL; `message.new` socket event is emitted

#### Scenario: Agent sends image on FB channel via API

- **WHEN** `POST /api/v1/conversations/:id/send-image` is called with a valid image file and the conversation is on the `FB` channel
- **THEN** the image is uploaded to S3, a `Message` (OUTBOUND) is created, and the FB Graph API `me/messages` endpoint is called with `attachment.type=image` and the S3 URL; `message.new` socket event is emitted

#### Scenario: Non-LINE/FB channel type

- **WHEN** the conversation channel is neither `LINE` nor `FB`
- **THEN** the frontend shows an unsupported alert and does NOT call the API; the route returns HTTP 501 `NOT_IMPLEMENTED` if called directly

---

### Requirement: Agent can send a video to a LINE or FB conversation

A new `send-video` endpoint enables outbound video delivery for both LINE and FB channels.

#### Scenario: Agent sends video on FB channel

- **WHEN** `POST /api/v1/conversations/:id/send-video` is called with a valid video file (≤25 MB) and the conversation is on the `FB` channel
- **THEN** the video is uploaded to S3, a `Message` (OUTBOUND) is created, and the FB Graph API is called with `attachment.type=video` and the S3 URL

#### Scenario: Agent sends video on LINE channel

- **WHEN** `POST /api/v1/conversations/:id/send-video` is called with a valid video file and the conversation is on the `LINE` channel
- **THEN** the video is uploaded to S3, a `Message` (OUTBOUND) is created, and the LINE Messaging API is called with `type=video`, `originalContentUrl=<s3-url>`, `previewImageUrl=<s3-url>`

#### Scenario: Video file too large for FB

- **WHEN** the uploaded file exceeds 25 MB
- **THEN** the route returns HTTP 400 `FILE_TOO_LARGE`
