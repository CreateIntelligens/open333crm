## Why

Marketing campaigns currently store basic campaign metadata and separate broadcasts, but they do not model the ordered message sequence that makes up "this campaign advertisement". Marketers need to compose LINE/FB campaign drafts as ordered text, image, and rich-card/flex-like messages from `/dashboard/marketing` without triggering delivery.

## What Changes

- Add campaign message sequence CRUD to the API for LINE and Facebook campaigns.
- Model a campaign sequence as an ordered list of message references or payloads, where each step is one outbound message in the campaign.
- Support authoring sequence steps for text, image, and rich-card/flex-like messages using the existing template-variable hole pattern.
- Expose LINE/FB channel authoring capabilities so the UI can constrain available step types by channel.
- Extend `/dashboard/marketing` campaign pages to create, edit, reorder, preview, and persist campaign message sequences.
- Store the canonical campaign sequence in the database for later sending, but do not implement sending, scheduling, workers, or channel delivery in this change.
- Keep existing broadcast send behavior unchanged.

## Examples

### Example: LINE campaign draft

A marketer creates a campaign for LINE with three consecutive messages:

1. Text message: "Hi {{contact.name}}, this week's offer is ready."
2. Image message: uploaded campaign banner.
3. Rich message: product card/carousel with title, image, body text, and action buttons.

This change stores those three messages as campaign draft data. It does not push them to LINE.

### Example: Facebook campaign draft

A marketer creates the same three-step campaign for Facebook. The stored sequence is still the same canonical campaign shape, but future delivery will treat Facebook as sequential single-message sends. This change only records the draft and the channel capability metadata needed by the UI.

### Non-example: sending a campaign

Clicking save in the new sequence editor must not create a `Broadcast`, enqueue a BullMQ job, call `sendMessage`, or contact LINE/Facebook APIs. Sending belongs to a future change.

## Capabilities

### New Capabilities
- `campaign-message-sequences`: Defines campaign-level ordered message sequence CRUD, validation, persistence, and marketing UI behavior.

### Modified Capabilities
- `channel-plugins`: Adds LINE/FB authoring capability metadata for campaign sequence composition without changing channel delivery behavior.

## Impact

- `packages/database/prisma/schema.prisma` for campaign sequence persistence.
- `apps/api/src/modules/marketing/*` for campaign sequence schemas, service methods, and routes.
- `packages/channel-plugins` for LINE/FB authoring capability declarations or helpers.
- `apps/web/src/app/dashboard/marketing` and related marketing hooks/components.
- Existing campaign CRUD behavior and broadcast execution remain compatible; no worker/send path changes are in scope.
