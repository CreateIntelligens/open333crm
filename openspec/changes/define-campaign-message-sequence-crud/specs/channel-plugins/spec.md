## ADDED Requirements

### Requirement: Channel authoring capabilities
The channel plugin package SHALL expose authoring capability metadata for LINE and Facebook campaign message sequences without changing delivery behavior.

#### Scenario: LINE authoring capabilities returned
- **WHEN** the marketing API requests authoring capabilities for LINE
- **THEN** the system reports support for text, image, and rich sequence steps

#### Scenario: Facebook authoring capabilities returned
- **WHEN** the marketing API requests authoring capabilities for Facebook
- **THEN** the system reports support for text, image, and rich sequence steps

#### Scenario: Unsupported channel omitted
- **WHEN** the marketing UI requests campaign sequence authoring capabilities
- **THEN** Webchat, WhatsApp, Telegram, Threads, and other unsupported channels are not offered for this change

#### Scenario: Capability metadata example returned
- **WHEN** authoring capabilities are requested
- **THEN** the returned metadata includes entries shaped like:
  ```json
  {
    "LINE": {
      "supportedStepTypes": ["text", "image", "rich"],
      "nativeMultiMessage": true,
      "maxMessagesPerFutureRequest": 5,
      "richLayouts": ["single", "carousel"]
    },
    "FB": {
      "supportedStepTypes": ["text", "image", "rich"],
      "nativeMultiMessage": false,
      "maxMessagesPerFutureRequest": 1,
      "richLayouts": ["single", "carousel"]
    }
  }
  ```

### Requirement: Multi-message authoring metadata
The channel authoring capabilities SHALL distinguish future transport behavior from current CRUD behavior by describing whether a channel supports native multi-message requests.

#### Scenario: LINE native multi-message metadata
- **WHEN** LINE authoring capabilities are read
- **THEN** the metadata indicates native multi-message support and a maximum of five messages per future request

#### Scenario: Facebook sequential-message metadata
- **WHEN** Facebook authoring capabilities are read
- **THEN** the metadata indicates that future multi-step delivery must be performed as sequential single-message sends

#### Scenario: UI uses metadata to constrain add controls
- **WHEN** the marketing UI opens a LINE or Facebook campaign sequence editor
- **THEN** it uses `supportedStepTypes` to show only text, image, and rich add controls

#### Scenario: Future transport notes remain informational
- **WHEN** the API returns `nativeMultiMessage` or `maxMessagesPerFutureRequest`
- **THEN** campaign CRUD treats the values as authoring metadata and does not use them to send messages

### Requirement: No send behavior change
Adding authoring capabilities SHALL NOT change the existing `ChannelPlugin.sendMessage` contract or invoke channel delivery when campaigns are created or updated.

#### Scenario: Existing sendMessage remains compatible
- **WHEN** existing conversation, template, or broadcast code calls `sendMessage`
- **THEN** the existing `OutboundPayload` send contract remains valid

#### Scenario: Authoring metadata is read-only
- **WHEN** campaign sequence CRUD reads LINE or Facebook authoring capabilities
- **THEN** no external LINE or Facebook API request is made

#### Scenario: No native payload conversion on save
- **WHEN** a campaign sequence containing a rich step is saved
- **THEN** channel-plugin authoring code does not convert that step into LINE Flex, Facebook Generic Template, or any other native delivery payload
