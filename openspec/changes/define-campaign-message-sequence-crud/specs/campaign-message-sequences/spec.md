## ADDED Requirements

### Requirement: Campaign sequence persistence
The system SHALL persist each marketing campaign's optional `channelType` and ordered `messageSequence` in the database without requiring a broadcast or send job.

#### Scenario: Campaign created without sequence
- **WHEN** an authenticated user creates a campaign with only name, description, and dates
- **THEN** the campaign is created with an empty message sequence and remains compatible with existing campaign CRUD behavior

#### Scenario: Campaign created with LINE sequence
- **WHEN** an authenticated user creates a campaign with `channelType = "LINE"` and a valid message sequence
- **THEN** the API persists the campaign and stores the ordered sequence payload

#### Scenario: Campaign created with Facebook sequence
- **WHEN** an authenticated user creates a campaign with `channelType = "FB"` and a valid message sequence
- **THEN** the API persists the campaign and stores the ordered sequence payload

#### Scenario: Full example sequence persisted
- **WHEN** an authenticated user creates a campaign with the following body:
  ```json
  {
    "name": "VIP product launch",
    "channelType": "LINE",
    "messageSequence": [
      {
        "id": "intro",
        "order": 1,
        "type": "text",
        "enabled": true,
        "content": { "text": "{{contact.name}}，新品活動開始了" }
      },
      {
        "id": "hero",
        "order": 2,
        "type": "image",
        "enabled": true,
        "content": {
          "url": "{{campaign.heroImageUrl}}",
          "storageKey": "templates/vip-launch/hero.png",
          "altText": "新品主視覺"
        }
      },
      {
        "id": "product-card",
        "order": 3,
        "type": "rich",
        "enabled": true,
        "content": {
          "schema": "o333.rich.v1",
          "layout": "single",
          "fallbackText": "{{product.name}} {{product.url}}",
          "cards": [
            {
              "title": "{{product.name}}",
              "body": "{{product.summary}}",
              "imageUrl": "{{product.imageUrl}}",
              "actions": [
                { "type": "url", "label": "查看商品", "url": "{{product.url}}" }
              ]
            }
          ]
        }
      }
    ]
  }
  ```
- **THEN** the API stores the three enabled sequence items in order without resolving the template-variable holes

### Requirement: Campaign sequence item contract
The system SHALL validate campaign sequence items as canonical outbound message steps with stable IDs, order, type, enabled state, and content.

#### Scenario: Text step accepted
- **WHEN** a sequence item has type `text` and content with a non-empty `text` value
- **THEN** the API accepts the item and preserves template-variable holes in the stored payload

#### Scenario: Image step accepted
- **WHEN** a sequence item has type `image` and content containing a URL or storage reference
- **THEN** the API accepts the item and stores the image reference for later rendering

#### Scenario: Rich step accepted
- **WHEN** a sequence item has type `rich` and content containing a valid canonical card or carousel payload
- **THEN** the API accepts the item without converting it to LINE or Facebook native delivery payload

#### Scenario: Unsupported step rejected
- **WHEN** a sequence item uses a type other than `text`, `image`, or `rich`
- **THEN** the API rejects the request with a validation error

#### Scenario: Disabled step accepted
- **WHEN** a sequence item has `enabled = false` and otherwise valid content
- **THEN** the API stores the item so the draft can preserve disabled campaign content

#### Scenario: Duplicate order normalized or rejected
- **WHEN** a request contains two enabled sequence items with the same `order`
- **THEN** the API either normalizes the order deterministically or rejects the request with a validation error

### Requirement: Campaign sequence CRUD API
The marketing API SHALL support reading and updating campaign message sequences through campaign CRUD without triggering delivery.

#### Scenario: Campaign detail includes sequence
- **WHEN** an authenticated user reads `GET /marketing/campaigns/:id`
- **THEN** the response includes `channelType` and `messageSequence` for that tenant's campaign

#### Scenario: Campaign sequence updated
- **WHEN** an authenticated user updates a draft campaign with a valid `channelType` and `messageSequence`
- **THEN** the API saves the new sequence and returns the updated campaign

#### Scenario: Campaign sequence reordered through patch
- **WHEN** an authenticated user sends a campaign update where the same sequence item IDs have new `order` values
- **THEN** the API persists the new order and returns the sequence sorted by order

#### Scenario: Sequence update does not send
- **WHEN** an authenticated user creates or updates a campaign sequence
- **THEN** no broadcast is created, no BullMQ job is enqueued, and no channel plugin send method is called

#### Scenario: Existing campaign CRUD remains compatible
- **WHEN** an existing client creates or updates a campaign without `channelType` or `messageSequence`
- **THEN** the API preserves existing behavior and returns an empty sequence by default

### Requirement: LINE and Facebook only
The campaign sequence authoring API SHALL allow only LINE and Facebook channel types for this change.

#### Scenario: Supported channel accepted
- **WHEN** a request uses `channelType = "LINE"` or `channelType = "FB"`
- **THEN** the API validates the campaign sequence against that channel's authoring capabilities

#### Scenario: Unsupported channel rejected
- **WHEN** a request uses Webchat, WhatsApp, Telegram, Threads, or another unsupported channel type
- **THEN** the API rejects sequence authoring with a validation error

#### Scenario: Channel change revalidates sequence
- **WHEN** a draft campaign changes `channelType` from LINE to Facebook
- **THEN** the API revalidates the existing sequence against Facebook authoring capabilities before saving

### Requirement: Marketing UI sequence editor
The `/dashboard/marketing` campaign UI SHALL allow users to create and edit campaign message sequences for LINE and Facebook without exposing send controls for the sequence.

#### Scenario: Campaign created from marketing page
- **WHEN** a user opens the campaign creation dialog
- **THEN** the UI allows selecting LINE or Facebook as the campaign channel for sequence authoring

#### Scenario: Sequence edited on campaign detail page
- **WHEN** a user opens a campaign detail page
- **THEN** the UI shows an ordered sequence editor with controls to add text, image, and rich message steps

#### Scenario: Add controls append one message each
- **WHEN** a user clicks Add Text, Add Image, or Add Rich in the campaign detail page
- **THEN** the UI appends exactly one new sequence item for that message type and does not edit another item's body

#### Scenario: Sequence reordered
- **WHEN** a user reorders sequence steps and saves
- **THEN** the UI sends the new step order to the API and refreshes the campaign detail

#### Scenario: LINE label maps to canonical rich
- **WHEN** the selected campaign channel is LINE and the UI labels a control as Flex
- **THEN** saving the step stores canonical type `rich`, not LINE-native Flex JSON as the top-level type

#### Scenario: Sequence editor does not send
- **WHEN** a user saves a campaign sequence
- **THEN** the UI persists the draft only and does not call any broadcast send endpoint

### Requirement: Sequence preview
The campaign sequence UI SHALL display a draft preview of text, image, and rich steps before any delivery feature exists.

#### Scenario: Preview preserves holes
- **WHEN** a sequence step contains template-variable holes
- **THEN** the preview displays the hole text rather than requiring runtime contact data

#### Scenario: Rich preview visible
- **WHEN** a rich step contains card or carousel content
- **THEN** the preview shows the title, image, text, and action labels in campaign order

#### Scenario: Example preview for three-step sequence
- **WHEN** the campaign contains text, image, and rich steps in order
- **THEN** the preview renders three distinct timeline items instead of merging them into one card
