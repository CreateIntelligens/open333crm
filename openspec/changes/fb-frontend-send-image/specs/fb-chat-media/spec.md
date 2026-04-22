## MODIFIED Requirements

### Requirement: Agent can send an image to an FB conversation

Agents must be able to upload an image file and deliver it to FB Messenger contacts via the same `send-image` endpoint used for LINE. The frontend `MessageInput` component SHALL allow image selection for both LINE and FACEBOOK channel types.

#### Scenario: Agent sends image on FB channel via UI

- **WHEN** the conversation is on the `FACEBOOK` channel and the agent selects an image in MessageInput
- **THEN** `POST /api/v1/conversations/:id/send-image` is called, the image is uploaded to S3, a `Message` (OUTBOUND) is created, and the FB Graph API `me/messages` endpoint is called with `attachment.type=image` and the S3 URL; `message.new` socket event is emitted

#### Scenario: Agent sends image on FB channel via API

- **WHEN** `POST /api/v1/conversations/:id/send-image` is called with a valid image file and the conversation is on the `FB` channel
- **THEN** the image is uploaded to S3, a `Message` (OUTBOUND) is created, and the FB Graph API `me/messages` endpoint is called with `attachment.type=image` and the S3 URL; `message.new` socket event is emitted

#### Scenario: Non-LINE/FB channel type

- **WHEN** the conversation channel is neither `LINE` nor `FB`/`FACEBOOK`
- **THEN** the frontend shows an unsupported alert and does NOT call the API; the route returns HTTP 501 `NOT_IMPLEMENTED` if called directly
