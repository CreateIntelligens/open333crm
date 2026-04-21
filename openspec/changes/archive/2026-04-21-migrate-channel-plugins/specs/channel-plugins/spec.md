## MODIFIED Requirements

### Requirement: Standard Integration Interface
The system SHALL provide a unified adapter interface for all external IM channels through the `@open333crm/channel-plugins` package. The package SHALL own the `ChannelPlugin` base interface, `ChannelRegistry`, and all channel implementations (LINE, Facebook, Webchat). The authoritative API bootstrap at `apps/api/src/index.ts` SHALL import and register plugins from `@open333crm/channel-plugins` rather than from `apps/api/src/channels/`.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into a standard `UniversedMessage` and passes it to the Core Inbox through the runtime initialized from `apps/api/src/index.ts`

#### Scenario: Plugin resolved from shared package registry
- **WHEN** any service in `apps/api` calls `getChannelPlugin(channelType)`
- **THEN** the registry returns the plugin instance registered from `@open333crm/channel-plugins`

#### Scenario: No duplicate plugin implementations
- **WHEN** the `apps/api/src/channels/` directory is inspected
- **THEN** it SHALL NOT contain LINE, Facebook, or Webchat plugin implementations (only the dev-only `simulator/` may remain)
