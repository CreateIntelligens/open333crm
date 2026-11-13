## Purpose
定義渠道插件：各渠道（LINE、FB、IG、WebChat）實作統一的插件介面，渠道類型的值由共用常數定義，不在各處寫死字串。

## Requirements

### Requirement: Unified channel plugin interface
The system SHALL provide a unified adapter interface for all external IM channels through a single `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`. The interface SHALL use `ParsedWebhookMessage[]` as the return type for `parseWebhook`, and `registerChannelPlugin`/`getChannelPlugin` as registry functions. Both `apps/api` and `apps/workers` SHALL import from `@open333crm/channel-plugins` only.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into `ParsedWebhookMessage[]` and passes it to the Core Inbox through the runtime initialized from `apps/api/src/index.ts`

#### Scenario: Plugin resolved from single package registry
- **WHEN** any service in `apps/api` or `apps/workers` calls `getChannelPlugin(channelType)`
- **THEN** the registry returns the plugin instance from `@open333crm/channel-plugins` (no `/webhook` sub-path)

### Requirement: Each channel plugin has one implementation
Plugin implementations for LINE, Facebook, and Webchat SHALL live in their respective channel subdirectories (`line/`, `facebook/`, `webchat/`) — no duplicate `adapters/` folder SHALL exist.

#### Scenario: No adapter duplication
- **WHEN** `packages/channel-plugins/src/` is inspected
- **THEN** there SHALL be no `adapters/` directory and no `webhook-adapter.ts` file; LINE/FB/Webchat plugins SHALL each have exactly one implementation file in their own subdirectory

### Requirement: Webchat plugin does not deliver to visitors
`WebchatPlugin.sendMessage` SHALL return `{ success: true, channelMsgId }` but SHALL NOT be responsible for pushing the message to the visitor — actual delivery to the visitor Socket.IO room SHALL be handled by `conversation.service.ts` after the message is persisted.

#### Scenario: WebchatPlugin sendMessage returns success
- **WHEN** `webchatPlugin.sendMessage(to, payload, credentials)` is called
- **THEN** it returns `{ success: true, channelMsgId: "webchat-msg-<timestamp>" }` without performing any Socket.IO operation (delivery is the caller's responsibility)

---

### Requirement: Channel type values are defined as shared constants
All channel type comparisons, Prisma where conditions, and plugin declarations SHALL reference the `CHANNEL_TYPE` const from `@open333crm/shared` rather than raw string literals. This ensures compile-time typo detection and autocomplete support.

#### Scenario: Developer uses wrong channel type string
- **WHEN** a developer writes `CHANNEL_TYPE.LIEN` instead of `CHANNEL_TYPE.LINE`
- **THEN** TypeScript reports a compile-time error immediately

#### Scenario: Developer adds a new channel type
- **WHEN** a new value is added to `CHANNEL_TYPE` in `packages/shared`
- **THEN** all existing comparisons and plugin declarations remain valid, and the new value is available for use with autocomplete

### Requirement: Channel plugins declare whether they can send a CSAT survey
`ChannelPlugin` SHALL have an optional method `buildCsatSurvey(input)` that returns a CSAT survey payload with tappable score options. Only plugins whose customers can answer the survey SHALL implement it; today only LINE does, with a Flex message. The CSAT module SHALL decide whether to send a survey by this method, not by a branch on `channelType`. The workers registry SHALL hold the same plugin objects.

#### Scenario: LINE plugin builds a CSAT survey
- **WHEN** `linePlugin.buildCsatSurvey()` is called with a question and five score options for a case
- **THEN** it returns a payload with `contentType` `flex` whose buttons have postback data `csat:1:<case ID>` to `csat:5:<case ID>`

#### Scenario: Other plugins cannot send a CSAT survey
- **WHEN** the Facebook, Instagram (`THREADS`) and WebChat plugins are inspected
- **THEN** none of them has a `buildCsatSurvey` method

#### Scenario: Workers registry has the same capability
- **WHEN** `createWorkerPluginRegistry()` builds the workers registry
- **THEN** its LINE plugin has `buildCsatSurvey`, and its other plugins do not
