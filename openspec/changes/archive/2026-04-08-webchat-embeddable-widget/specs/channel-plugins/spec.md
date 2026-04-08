## MODIFIED Requirements

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
