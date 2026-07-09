# CLI Capability Gap Analysis

## Current CLI Commands (4)

| Command  | Scopes Required        | Description                                                                 |
| -------- | ---------------------- | --------------------------------------------------------------------------- |
| `login`  | (none - creates token) | Authenticate & store CLI token                                              |
| `status` | `cli:status`           | Health check + current agent identity                                       |
| `apis`   | `cli:apis`             | Discover available endpoints & capabilities                                 |
| `stats`  | `cli:analytics:read`   | Read-only CRM analytics (overview, trends, cases, channels, my performance) |

## Current CLI Scopes (3)

| Scope                | Description                   |
| -------------------- | ----------------------------- |
| `cli:status`         | Server health, agent identity |
| `cli:apis`           | API discovery metadata        |
| `cli:analytics:read` | Read-only analytics endpoints |

## System Capabilities (from Prisma Schema) - Missing CLI Coverage

### Core CRM (High Priority for CLI)

| Domain            | Models                                                                            | Suggested CLI Commands                                                                                                      | Suggested Scopes                                    |
| ----------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Agents**        | `Agent`, `AgentTeamMember`, `Team`                                                | `agent list`, `agent get`, `agent create`, `agent update`, `agent delete`, `team list`, `team members`                      | `cli:agents:read`, `cli:agents:write`               |
| **Channels**      | `Channel`, `ChannelTeamAccess`, `ChannelUsage`                                    | `channel list`, `channel get`, `channel create`, `channel update`, `channel verify`                                         | `cli:channels:read`, `cli:channels:write`           |
| **Contacts**      | `Contact`, `ChannelIdentity`, `ContactAttribute`, `ContactRelation`, `ContactTag` | `contact list`, `contact get`, `contact search`, `contact create`, `contact update`, `contact merge`                        | `cli:contacts:read`, `cli:contacts:write`           |
| **Conversations** | `Conversation`, `Message`, `ChatboxSession`                                       | `conv list`, `conv get`, `conv assign`, `conv close`, `conv messages`, `conv transfer`                                      | `cli:conversations:read`, `cli:conversations:write` |
| **Cases**         | `Case`, `CaseEvent`, `CaseNote`, `CaseTag`, `CaseRelation`, `SlaPolicy`           | `case list`, `case get`, `case create`, `case update`, `case assign`, `case close`, `case notes`, `case events`, `case sla` | `cli:cases:read`, `cli:cases:write`                 |

### Automation & AI (Medium Priority)

| Domain               | Models                                                                             | Suggested CLI Commands                                                                         | Suggested Scopes                              |
| -------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Automation Rules** | `AutomationRule`, `AutomationExecution`, `AutomationActionResult`, `AutomationLog` | `automation list`, `automation get`, `automation create`, `automation test`, `automation logs` | `cli:automation:read`, `cli:automation:write` |
| **Knowledge Base**   | `KmArticle`, `KmArticleAttachment`, `KbArticleFeedback`                            | `kb list`, `kb get`, `kb create`, `kb update`, `kb search`, `kb feedback`                      | `cli:kb:read`, `cli:kb:write`                 |
| **AI/Embeddings**    | `LongTermMemory`, `TenantSettings` (embedding config)                              | `ai embed`, `ai search`, `ai classify`                                                         | `cli:ai:read`, `cli:ai:write`                 |

### Marketing & Outreach (Medium Priority)

| Domain         | Models                                        | Suggested CLI Commands                                                                     | Suggested Scopes                              |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Segments**   | `Segment`                                     | `segment list`, `segment get`, `segment create`, `segment preview`                         | `cli:segments:read`, `cli:segments:write`     |
| **Campaigns**  | `Campaign`                                    | `campaign list`, `campaign get`, `campaign create`, `campaign start`                       | `cli:campaigns:read`, `cli:campaigns:write`   |
| **Broadcasts** | `Broadcast`, `BroadcastRecipient`, `Material` | `broadcast list`, `broadcast get`, `broadcast create`, `broadcast send`, `broadcast stats` | `cli:broadcasts:read`, `cli:broadcasts:write` |
| **Templates**  | `MessageTemplate`, `Material`, `TemplateView` | `template list`, `template get`, `template create`, `template preview`                     | `cli:templates:read`, `cli:templates:write`   |

### LINE OA Features (Medium Priority)

| Domain              | Models            | Suggested CLI Commands                                                                         | Suggested Scopes                          |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Rich Menus**      | `RichMenu`        | `richmenu list`, `richmenu get`, `richmenu create`, `richmenu publish`, `richmenu set-default` | `cli:richmenu:read`, `cli:richmenu:write` |
| **Insights**        | `InsightSnapshot` | `insight get`, `insight history`                                                               | `cli:insights:read`                       |
| **Audience Groups** | `AudienceGroup`   | `audience list`, `audience sync`                                                               | `cli:audience:read`, `cli:audience:write` |

### Webhooks & Integrations (Medium Priority)

| Domain                    | Models                                   | Suggested CLI Commands                                                                | Suggested Scopes                                  |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Webhook Subscriptions** | `WebhookSubscription`, `WebhookDelivery` | `webhook list`, `webhook get`, `webhook create`, `webhook test`, `webhook deliveries` | `cli:webhooks:read`, `cli:webhooks:write`         |
| **Partner API Keys**      | `PartnerApiKey`                          | `partner-key list`, `partner-key create`, `partner-key revoke`                        | `cli:partner-keys:read`, `cli:partner-keys:write` |

### Portal & Gamification (Lower Priority)

| Domain                | Models                                                              | Suggested CLI Commands                                                      | Suggested Scopes                              |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| **Portal Activities** | `PortalActivity`, `PortalOption`, `PortalField`, `PortalSubmission` | `portal list`, `portal get`, `portal create`, `portal submissions`          | `cli:portal:read`, `cli:portal:write`         |
| **Points**            | `PointTransaction`                                                  | `points balance`, `points history`, `points adjust`                         | `cli:points:read`, `cli:points:write`         |
| **Short Links**       | `ShortLink`, `ClickLog`                                             | `shortlink list`, `shortlink create`, `shortlink stats`, `shortlink clicks` | `cli:shortlinks:read`, `cli:shortlinks:write` |

### Interaction Canvas (Lower Priority)

| Domain    | Models                                                           | Suggested CLI Commands                                              | Suggested Scopes                    |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| **Flows** | `InteractionFlow`, `InteractionNode`, `FlowExecution`, `FlowLog` | `flow list`, `flow get`, `flow create`, `flow execute`, `flow logs` | `cli:flows:read`, `cli:flows:write` |

### Identity & Data (Lower Priority)

| Domain                 | Models                           | Suggested CLI Commands                                    | Suggested Scopes                                    |
| ---------------------- | -------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| **Identity Stitching** | `IdentityMap`, `MergeSuggestion` | `identity list`, `identity merge`, `identity suggestions` | `cli:identity:read`, `cli:identity:write`           |
| **Notifications**      | `Notification`                   | `notify list`, `notify read`, `notify mark-read`          | `cli:notifications:read`, `cli:notifications:write` |
| **Settings**           | `TenantSettings`                 | `settings get`, `settings update`                         | `cli:settings:read`, `cli:settings:write`           |
| **CLI Sessions**       | `CliSession`                     | `token list`, `token revoke`, `token rotate`              | `cli:tokens:read`, `cli:tokens:write`               |

## Priority Implementation Order

### Phase 1: Core CRM Read Operations (High Impact, Low Risk)

1. `agent list/get` — `cli:agents:read`
2. `channel list/get` — `cli:channels:read`
3. `contact list/search/get` — `cli:contacts:read`
4. `conv list/get/messages` — `cli:conversations:read`
5. `case list/get/notes/events` — `cli:cases:read`

### Phase 2: Core CRM Write Operations

6. `agent create/update` — `cli:agents:write`
7. `channel create/update/verify` — `cli:channels:write`
8. `contact create/update/merge` — `cli:contacts:write`
9. `conv assign/close/transfer` — `cli:conversations:write`
10. `case create/update/assign/close` — `cli:cases:write`

### Phase 3: Automation & KB

10. `automation list/get/test` — `cli:automation:read`
11. `kb list/search/get` — `cli:kb:read`

### Phase 4: Marketing

12. `segment list/get/preview` — `cli:segments:read`
13. `broadcast list/get/stats` — `cli:broadcasts:read`
14. `template list/get/preview` — `cli:templates:read`

### Phase 5: Advanced Features

15. Rich menus, webhooks, flows, identity, portal, short links

## Implementation Checklist per Command

- [ ] Add scope constant to `cli-session.service.ts`
- [ ] Add capability to `cli-endpoints.ts`
- [ ] Add route to `cli.routes.ts` with scope check
- [ ] Add response types to `cli/src/types.ts`
- [ ] Create command function in `cli/src/commands/*.ts`
- [ ] Create command class extending `Open333Command`
- [ ] Register in `cli/src/commands.ts`
- [ ] Add test in `cli/src/__tests__/*.test.ts`
- [ ] Run `pnpm --filter @open333crm/cli build && pnpm --filter @open333crm/cli lint`

## Scope Naming Convention

```
cli:<domain>:<action>
cli:agents:read
cli:agents:write
cli:channels:read
cli:channels:write
cli:contacts:read
cli:contacts:write
cli:conversations:read
cli:conversations:write
cli:cases:read
cli:cases:write
cli:automation:read
cli:automation:write
cli:kb:read
cli:kb:write
cli:segments:read
cli:segments:write
cli:campaigns:read
cli:campaigns:write
cli:broadcasts:read
cli:broadcasts:write
cli:templates:read
cli:templates:write
cli:richmenu:read
cli:richmenu:write
cli:webhooks:read
cli:webhooks:write
cli:partner-keys:read
cli:partner-keys:write
cli:portal:read
cli:portal:write
cli:points:read
cli:points:write
cli:shortlinks:read
cli:shortlinks:write
cli:flows:read
cli:flows:write
cli:identity:read
cli:identity:write
cli:notifications:read
cli:notifications:write
cli:settings:read
cli:settings:write
cli:tokens:read
cli:tokens:write
cli:insights:read
cli:audience:read
cli:audience:write
cli:ai:read
cli:ai:write
```
