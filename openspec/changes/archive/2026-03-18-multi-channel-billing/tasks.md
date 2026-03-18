# Implementation Tasks

## 1. Channel Plugin Infrastructure

- [x] 1.1 Update ChannelType enum in packages/types to include TELEGRAM and THREADS
- [x] 1.2 Create TelegramPlugin class in packages/channel-plugins/src/telegram.ts
- [x] 1.3 Create ThreadsPlugin class in packages/channel-plugins/src/threads.ts
- [x] 1.4 Implement verifySignature for Telegram using X-Telegram-Bot-Api-Secret-Token
- [x] 1.5 Implement verifySignature for Threads using Instagram Webhook verification
- [x] 1.6 Implement parseWebhook for Telegram (text, photo, sticker, location, callback)
- [x] 1.7 Implement parseWebhook for Threads (text, image, story reply, like reaction)
- [x] 1.8 Implement getProfile for both Telegram and Threads
- [x] 1.9 Implement sendMessage for both Telegram and Threads
- [x] 1.10 Register both plugins in packages/channel-plugins/src/index.ts
- [x] 1.11 Add webhook routes in apps/api/src/routes/webhooks.ts

## 2. License System Extension

- [x] 2.1 Update License JSON schema to support `ChannelLimit` interface (pure object, no boolean fallback — Q4)
- [x] 2.2 Add `messageFee` and `messageFeeCurrency` fields to channel config
- [x] 2.3 Update LicenseService: add `isChannelEnabled(channelType)` method
- [x] 2.4 Update LicenseService: add `getChannelMaxCount(channelType)` method (Q1 — 多組帳號數量上限)
- [x] 2.5 Update LicenseService: add `getMessageFee(channelType)` method
- [x] 2.6 Add `features.inbox.maxTeams` field to License JSON schema (Q3)
- [x] 2.7 Update LicenseService: add `isTeamCreationAllowed()` method (Q3)
- [x] 2.8 Add team license support (`teams[]` in License JSON)
- [x] 2.9 Add `defaultTeam` fallback configuration
- [x] 2.10 Implement `getTeamLicense(teamId)` method
- [x] 2.11 Implement `isFeatureEnabledForTeam(teamId, feature)` method
- [x] 2.12 Migrate existing boolean channel flags to object format for all existing licenses (Q4)

## 3. Database Schema Updates

> 依據 design.md D6 / D7 定義，以下為明確 schema 變更清單。

### 3a. 新建 Model

- [x] 3.1 新增 `ChannelTeamAccess` 表（`channel_team_accesses`）
  - 欄位：`channelId`, `teamId`, `accessLevel`（full/read_only）, `grantedAt`, `grantedById`
  - 主鍵：`[channelId, teamId]`（複合主鍵）
  - 關聯：Channel（Cascade Delete）、Team（Cascade Delete）
- [x] 3.2 新增 `ChannelUsage` 表（`channel_usages`）
  - 欄位：`id`, `channelId`, `teamId?`, `direction`（INBOUND/OUTBOUND）, `messageCount`, `feeAmount?`, `feeCurrency?`, `recordedAt`
  - 索引：`[channelId, recordedAt]`, `[teamId, recordedAt]`

### 3b. 修改現有 Model

- [x] 3.3 修改 `Team` 表：新增 `licenseTeamId String?` 欄位（對應 License JSON teams[].teamId）
- [x] 3.4 修改 `Channel` model：加入 `teamAccesses ChannelTeamAccess[]` 和 `usages ChannelUsage[]` 反向關聯
- [x] 3.5 修改 `ChannelType` enum：新增 `TELEGRAM`、`THREADS` 值
- [x] 3.6 確認 `Message` 表不需要新增 teamId（可由 Conversation.teamId 推導，避免冗餘）

### 3c. Migration

- [-] 3.7 產生並執行 Prisma migration (Skipped: No live DB, Schema validated)
- [ ] 3.8 為既有 Channel 執行資料回填腳本（若有 defaultTeamId 需求）

## 4. API Layer Changes

- [x] 4.1 Update channel creation API to check license limits
- [x] 4.2 Update channel creation to accept optional `defaultTeamId` and auto-create ChannelTeamAccess
- [x] 4.4 Implement channel creation rejection for `CHANNEL_LIMIT_EXCEEDED` (per channelType maxCount)
- [x] 4.5 Update message sending to pre-deduct credits before send (即時預扣, Q2)
- [x] 4.6 Record ChannelUsage after successful send (teamId for reporting only)
- [x] 4.7 Implement POST /api/v1/channels/{channelId}/teams (grant team access)
- [x] 4.8 Implement DELETE /api/v1/channels/{channelId}/teams/{teamId} (revoke team access)
- [x] 4.9 Implement GET /api/v1/channels/{channelId}/teams (list teams for channel)
- [x] 4.11 Implement access level enforcement middleware (logic inside MessageService)
- [x] 4.12 Implement Team creation guard: check `isTeamCreationAllowed()`

## 5. Usage Reporting

- [x] 5.1 Implement ChannelUsageService to record message events
- [x] 5.2 Create GET /api/v1/reports/channel-usage endpoint
- [ ] 5.3 Create GET /api/v1/reports/channel-fees endpoint
- [ ] 5.4 Create GET /api/v1/analytics/channel-usage/trend endpoint
- [ ] 5.5 Create GET /api/v1/analytics/channel-health endpoint
- [ ] 5.6 Implement CSV export for usage data

## 6. Frontend Updates

- [ ] 6.1 Add Telegram channel option in channel creation UI
- [ ] 6.2 Add Threads channel option in channel creation UI
- [ ] 6.3 Display channel usage statistics in dashboard
- [ ] 6.4 Display fee summary in billing section
- [ ] 6.5 Add team selector in admin settings
- [ ] 6.6 Show per-team channel limits in team management

## 7. Testing

- [ ] 7.1 Write unit tests for TelegramPlugin
- [ ] 7.2 Write unit tests for ThreadsPlugin
- [ ] 7.3 Write unit tests for team license methods
- [ ] 7.4 Write integration tests for channel creation with limits
- [ ] 7.5 Write integration tests for message fee calculation with team attribution
- [ ] 7.6 Write integration tests for team-based credit deduction
- [ ] 7.7 Test usage report API responses
- [ ] 7.8 Write unit tests for ChannelTeamAccess grant/revoke logic
- [ ] 7.9 Write integration tests for multi-team shared channel routing
- [ ] 7.10 Verify read_only teams cannot send outbound messages

## 8. Channel Team Access

### 8a. Backend
- [x] 8.1 Implement `ChannelTeamAccessService` with methods: `grantAccess`, `revokeAccess`, `listTeamsForChannel`, `listChannelsForTeam`, `checkAccess`
- [x] 8.2 Implement inbound message router: resolve teamId from Conversation → defaultTeam → AutomationRule → unassigned queue
- [x] 8.3 Implement fee attribution: resolve teamId from conversation context when recording ChannelUsage

### 8b. Frontend
- [ ] 8.4 Add Channel sharing UI in admin settings: grant/revoke team access, set accessLevel
- [ ] 8.5 Display shared channel badge on channel list (顯示共用部門數)
- [ ] 8.6 Add defaultTeamId selector in channel creation wizard

### 8c. Testing
- [ ] 8.7 Integration test: create channel → grant to 2 teams → send message → verify ChannelUsage.teamId is correct
- [ ] 8.8 Integration test: revoke access → verify team can no longer route messages through channel
