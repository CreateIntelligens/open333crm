## MODIFIED Requirements

### Requirement: Standard Integration Interface
The system SHALL provide a unified adapter interface for all external IM channels through a single `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`. The interface SHALL use `ParsedWebhookMessage[]` as the return type for `parseWebhook`, and `registerChannelPlugin`/`getChannelPlugin` as registry functions. Plugin implementations for LINE, Facebook, and Webchat SHALL live in their respective channel subdirectories (`line/`, `facebook/`, `webchat/`) — no duplicate `adapters/` folder SHALL exist. Both `apps/api` and `apps/workers` SHALL import from `@open333crm/channel-plugins` only.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into `ParsedWebhookMessage[]` and passes it to the Core Inbox through the runtime initialized from `apps/api/src/index.ts`

#### Scenario: Plugin resolved from single package registry
- **WHEN** any service in `apps/api` or `apps/workers` calls `getChannelPlugin(channelType)`
- **THEN** the registry returns the plugin instance from `@open333crm/channel-plugins` (no `/webhook` sub-path)

#### Scenario: No adapter duplication
- **WHEN** `packages/channel-plugins/src/` is inspected
- **THEN** there SHALL be no `adapters/` directory and no `webhook-adapter.ts` file; LINE/FB/Webchat plugins SHALL each have exactly one implementation file in their own subdirectory
