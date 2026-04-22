## ADDED Requirements

### Requirement: Unified channel plugin interface
The system SHALL provide a unified adapter interface for all external IM channels through a single `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`. The interface SHALL use `ParsedWebhookMessage[]` as the return type for `parseWebhook`, and `registerChannelPlugin`/`getChannelPlugin` as registry functions. Plugin implementations for LINE, Facebook, and Webchat SHALL live in their respective channel subdirectories (`line/`, `facebook/`, `webchat/`) — no duplicate `adapters/` folder SHALL exist. Both `apps/api` and `apps/workers` SHALL import from `@open333crm/channel-plugins` only.

`WebchatPlugin.sendMessage` SHALL return `{ success: true, channelMsgId }` but SHALL NOT be responsible for pushing the message to the visitor — actual delivery to the visitor Socket.IO room SHALL be handled by `conversation.service.ts` after the message is persisted.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into `ParsedWebhookMessage[]` and passes it to the Core Inbox through the runtime initialized from `apps/api/src/index.ts`

#### Scenario: Plugin resolved from single package registry
- **WHEN** any service in `apps/api` or `apps/workers` calls `getChannelPlugin(channelType)`
- **THEN** the registry returns the plugin instance from `@open333crm/channel-plugins` (no `/webhook` sub-path)

#### Scenario: No adapter duplication
- **WHEN** `packages/channel-plugins/src/` is inspected
- **THEN** there SHALL be no `adapters/` directory and no `webhook-adapter.ts` file; LINE/FB/Webchat plugins SHALL each have exactly one implementation file in their own subdirectory

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
