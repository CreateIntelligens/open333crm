# System Capability → CLI Command Mapping

This reference maps Open333CRM system domains (from Prisma schema) to potential CLI commands.
Use this to identify gaps and prioritize new CLI commands.

## Legend

- ✅ **Implemented** - CLI command exists
- 🔄 **Partial** - Some endpoints exist, could expand
- ⬜ **Missing** - No CLI coverage yet
- 🔒 **Scope needed** - New scope required

---

## Core CRM Domains

### Agents & Teams

| System Feature | Models                     | CLI Coverage | Suggested Commands                                                                                      |
| -------------- | -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| Agent CRUD     | `Agent`, `AgentTeamMember` | ⬜           | `agent list`, `agent get <id>`, `agent create`, `agent update <id>`, `agent delete <id>`, `agent teams` |
| Team CRUD      | `Team`                     | ⬜           | `team list`, `team get <id>`, `team create`, `team members <id>`                                        |
| Agent Roles    | `AgentRole` enum           | ⬜           | `agent role <id> <ADMIN\|SUPERVISOR\|AGENT>`                                                            |

**Required Scopes**: `cli:agents:read`, `cli:agents:write`, `cli:teams:read`, `cli:teams:write`

---

### Channels (LINE, FB, WebChat, WhatsApp, Telegram, Threads)

| System Feature        | Models              | CLI Coverage | Suggested Commands                                                                                                                     |
| --------------------- | ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Channel CRUD          | `Channel`           | ⬜           | `channel list`, `channel get <id>`, `channel create --type LINE`, `channel update <id>`, `channel verify <id>`, `channel webhook <id>` |
| Channel Team Access   | `ChannelTeamAccess` | ⬜           | `channel teams <id>`, `channel grant <id> --team <team> --level full`                                                                  |
| Channel Usage/Billing | `ChannelUsage`      | ⬜           | `channel usage <id> --from --to`                                                                                                       |
| LINE Rich Menus       | `RichMenu`          | ⬜           | `richmenu list`, `richmenu create`, `richmenu publish <id>`, `richmenu areas <id>`                                                     |

**Required Scopes**: `cli:channels:read`, `cli:channels:write`, `cli:richmenus:read`, `cli:richmenus:write`

---

### Contacts

| System Feature     | Models                                           | CLI Coverage | Suggested Commands                                                                                                 |
| ------------------ | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Contact CRUD       | `Contact`, `ChannelIdentity`, `ContactAttribute` | ⬜           | `contact list`, `contact get <id>`, `contact create`, `contact update <id>`, `contact merge <primary> <secondary>` |
| Contact Tags       | `Tag`, `ContactTag`                              | ⬜           | `contact tags <id>`, `contact tag <id> --add <tag>`, `contact untag <id> --remove <tag>`                           |
| Contact Relations  | `ContactRelation`                                | ⬜           | `contact relations <id>`, `contact relate <from> <to> --type colleague`                                            |
| Identity Stitching | `IdentityMap`, `MergeSuggestion`                 | ⬜           | `identity list`, `identity suggest`, `identity merge <suggestionId> --confirm`                                     |

**Required Scopes**: `cli:contacts:read`, `cli:contacts:write`, `cli:identity:read`, `cli:identity:write`

---

### Conversations & Messages

| System Feature    | Models                     | CLI Coverage | Suggested Commands                                                                                        |
| ----------------- | -------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| Conversation CRUD | `Conversation`             | ⬜           | `conv list`, `conv get <id>`, `conv assign <id> --agent <id>`, `conv close <id>`, `conv reopen <id>`      |
| Message CRUD      | `Message`                  | ⬜           | `msg list --conv <id>`, `msg send --conv <id> --text "Hello"`, `msg template --conv <id> --template <id>` |
| Unread/Read       | `Conversation.unreadCount` | ⬜           | `conv unread`, `conv mark-read <id>`                                                                      |

**Required Scopes**: `cli:conversations:read`, `cli:conversations:write`, `cli:messages:read`, `cli:messages:write`

---

### Cases (Tickets)

| System Feature | Models                                          | CLI Coverage    | Suggested Commands                                                                                                                                                                                       |
| -------------- | ----------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case CRUD      | `Case`, `CaseEvent`, `CaseNote`, `CaseRelation` | 🔄 (stats only) | `case list`, `case get <id>`, `case create`, `case update <id>`, `case assign <id> --agent <id>`, `case status <id> <OPEN\|IN_PROGRESS\|RESOLVED>`, `case notes <id>`, `case add-note <id> --text "..."` |
| SLA Policies   | `SlaPolicy`                                     | ⬜              | `sla list`, `sla get <id>`, `sla create`                                                                                                                                                                 |
| Case Tags      | `CaseTag`                                       | ⬜              | `case tags <id>`, `case tag <id> --add <tag>`                                                                                                                                                            |

**Required Scopes**: `cli:cases:read`, `cli:cases:write`, `cli:sla:read`, `cli:sla:write`

---

### Automation Engine

| System Feature | Models                                                           | CLI Coverage | Suggested Commands                                                                                                                        |
| -------------- | ---------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Rule CRUD      | `AutomationRule`                                                 | ⬜           | `auto list`, `auto get <id>`, `auto create`, `auto update <id>`, `auto enable <id>`, `auto disable <id>`, `auto test <id> --event <json>` |
| Execution Logs | `AutomationExecution`, `AutomationActionResult`, `AutomationLog` | ⬜           | `auto runs <ruleId>`, `auto run <id>`, `auto actions <executionId>`                                                                       |

**Required Scopes**: `cli:automation:read`, `cli:automation:write`

---

### Knowledge Base

| System Feature   | Models                             | CLI Coverage | Suggested Commands                                                                                                              |
| ---------------- | ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Article CRUD     | `KmArticle`, `KmArticleAttachment` | ⬜           | `kb list`, `kb get <id>`, `kb create`, `kb update <id>`, `kb publish <id>`, `kb search <query>`, `kb attach <id> --file <path>` |
| Feedback         | `KbArticleFeedback`                | ⬜           | `kb feedback <id>`                                                                                                              |
| Long-term Memory | `LongTermMemory`                   | ⬜           | `memory list --contact <id>`, `memory add --contact <id> --text "..."`                                                          |

**Required Scopes**: `cli:kb:read`, `cli:kb:write`, `cli:memory:read`, `cli:memory:write`

---

### Templates & Materials

| System Feature    | Models                            | CLI Coverage | Suggested Commands                                                                                                              |
| ----------------- | --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Message Templates | `MessageTemplate`, `TemplateView` | ⬜           | `template list`, `template get <id>`, `template create`, `template submit <id>`, `template approve <id>`, `template views <id>` |
| Materials         | `Material`                        | ⬜           | `material list`, `material get <id>`, `material create`, `material usage <id>`                                                  |

**Required Scopes**: `cli:templates:read`, `cli:templates:write`, `cli:materials:read`, `cli:materials:write`

---

### Marketing (Segments, Campaigns, Broadcasts)

| System Feature | Models                            | CLI Coverage | Suggested Commands                                                                                                                                                    |
| -------------- | --------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segments       | `Segment`                         | ⬜           | `segment list`, `segment get <id>`, `segment create`, `segment preview <id>`, `segment contacts <id>`                                                                 |
| Campaigns      | `Campaign`                        | ⬜           | `campaign list`, `campaign get <id>`, `campaign create`, `campaign start <id>`, `campaign stop <id>`                                                                  |
| Broadcasts     | `Broadcast`, `BroadcastRecipient` | ⬜           | `broadcast list`, `broadcast get <id>`, `broadcast create --material <id> --segment <id>`, `broadcast send <id>`, `broadcast recipients <id>`, `broadcast stats <id>` |

**Required Scopes**: `cli:segments:read`, `cli:segments:write`, `cli:campaigns:read`, `cli:campaigns:write`, `cli:broadcasts:read`, `cli:broadcasts:write`

---

### Webhook Subscriptions

| System Feature    | Models                                   | CLI Coverage | Suggested Commands                                                                                                                                                    |
| ----------------- | ---------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription CRUD | `WebhookSubscription`, `WebhookDelivery` | ⬜           | `webhook list`, `webhook get <id>`, `webhook create --url <url> --events event1,event2`, `webhook test <id>`, `webhook deliveries <id>`, `webhook retry <deliveryId>` |

**Required Scopes**: `cli:webhooks:read`, `cli:webhooks:write`

---

### Interaction Canvas (Flows)

| System Feature | Models                               | CLI Coverage | Suggested Commands                                                                                       |
| -------------- | ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------- |
| Flow CRUD      | `InteractionFlow`, `InteractionNode` | ⬜           | `flow list`, `flow get <id>`, `flow create`, `flow update <id>`, `flow nodes <id>`, `flow validate <id>` |
| Execution      | `FlowExecution`, `FlowLog`           | ⬜           | `flow runs <id>`, `flow run <id> --contact <id>`, `flow logs <executionId>`, `flow resume <executionId>` |

**Required Scopes**: `cli:flows:read`, `cli:flows:write`, `cli:flow-executions:read`

---

### Portal (Fan Engagement)

| System Feature | Models                                          | CLI Coverage | Suggested Commands                                                                                         |
| -------------- | ----------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| Activities     | `PortalActivity`, `PortalOption`, `PortalField` | ⬜           | `portal list`, `portal get <id>`, `portal create`, `portal publish <id>`, `portal submissions <id>`        |
| Points         | `PointTransaction`                              | ⬜           | `points balance --contact <id>`, `points history --contact <id>`, `points add --contact <id> --amount 100` |

**Required Scopes**: `cli:portal:read`, `cli:portal:write`, `cli:points:read`, `cli:points:write`

---

### Short Links & Analytics

| System Feature | Models                  | CLI Coverage | Suggested Commands                                                                                              |
| -------------- | ----------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| Short Links    | `ShortLink`, `ClickLog` | ⬜           | `shortlink list`, `shortlink create --url <url> --slug <slug>`, `shortlink stats <id>`, `shortlink clicks <id>` |
| LINE Insights  | `InsightSnapshot`       | ⬜           | `insights list --channel <id>`, `insights get --channel <id> --date <YYYYMMDD>`                                 |

**Required Scopes**: `cli:shortlinks:read`, `cli:shortlinks:write`, `cli:insights:read`

---

### Notifications & Settings

| System Feature  | Models           | CLI Coverage   | Suggested Commands                                                     |
| --------------- | ---------------- | -------------- | ---------------------------------------------------------------------- |
| Notifications   | `Notification`   | ⬜             | `notif list`, `notif read <id>`, `notif unread`, `notif mark-all-read` |
| Tenant Settings | `TenantSettings` | ⬜             | `settings get`, `settings update --key <key> --value <json>`           |
| Daily Stats     | `DailyStat`      | 🔄 (via stats) | `stats daily --type overview --date <date>`                            |

**Required Scopes**: `cli:notifications:read`, `cli:notifications:write`, `cli:settings:read`, `cli:settings:write`

---

### Partner API & CLI Sessions

| System Feature   | Models          | CLI Coverage             | Suggested Commands                                      |
| ---------------- | --------------- | ------------------------ | ------------------------------------------------------- |
| Partner API Keys | `PartnerApiKey` | ⬜                       | `partner list`, `partner create`, `partner revoke <id>` |
| CLI Sessions     | `CliSession`    | ✅ (login, status, apis) | `token list`, `token revoke <id>`, `token rotate <id>`  |

**Required Scopes**: `cli:partner:read`, `cli:partner:write`, `cli:tokens:read`, `cli:tokens:write`

---

## Priority Recommendations

### Phase 1: Core Operations (High Impact)

1. **Cases** - `case list/get/create/update/assign/status` (most requested)
2. **Contacts** - `contact list/get/create/update/merge`
3. **Conversations** - `conv list/get/assign/close`
4. **Agents** - `agent list/get` (for supervisors)

### Phase 2: Automation & Marketing

5. **Automation Rules** - `auto list/get/create/test`
6. **Broadcasts** - `broadcast create/send/stats`
7. **Segments** - `segment list/create/preview`

### Phase 3: Advanced

8. **Knowledge Base** - `kb search/create/publish`
9. **Templates** - `template list/create/submit`
10. **Flows** - `flow list/get/validate/run`

### Phase 4: Admin

11. **Channels** - `channel list/create/verify`
12. **Settings** - `settings get/update`
13. **Tokens** - `token list/revoke/rotate`

---

## Scope Naming Convention

```
cli:<domain>:<action>

Domains: agents, teams, channels, contacts, conversations, messages, cases, sla,
         automation, kb, memory, templates, materials, segments, campaigns, broadcasts,
         webhooks, flows, portal, points, shortlinks, insights, notifications, settings,
         partner, tokens, richmenus, identity

Actions: read, write, admin
```

Examples:

- `cli:cases:read` — list/get cases
- `cli:cases:write` — create/update/assign cases
- `cli:broadcasts:admin` — delete broadcasts (dangerous)

---

## Implementation Checklist per Command

- [ ] Add types to `apps/cli/src/types.ts`
- [ ] Add scope constant to `apps/api/src/modules/auth/cli-session.service.ts`
- [ ] Add capability to `apps/api/src/modules/cli/cli-endpoints.ts`
- [ ] Add route to `apps/api/src/modules/cli/cli.routes.ts`
- [ ] Create command in `apps/cli/src/commands/<name>.ts`
- [ ] Register in `apps/cli/src/commands.ts`
- [ ] Add test in `apps/cli/src/__tests__/<name>-command.test.ts`
- [ ] Build & verify: `pnpm --filter @open333crm/cli build && pnpm --filter @open333crm/cli dev -- <command> --help`
