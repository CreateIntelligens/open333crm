## Why

各模組對渠道類型以手寫字串（`'LINE'`、`'FB'`、`'FACEBOOK'`）做比較和 Prisma where 條件，導致：
1. Typo 不會在編譯期被發現（`'LIEN'` 合法通過型別檢查）
2. 前端混用 `'FACEBOOK'` 與 `'FB'`，造成 UI badge / label 查表失效
3. 新增渠道時需要手動搜索所有字串，遺漏風險高

## What Changes

- `packages/shared` 新增 `CHANNEL_TYPE` const object（`LINE | FB | WEBCHAT | WHATSAPP | TELEGRAM | THREADS`），`ChannelType` 型別由 const 衍生
- `packages/channel-plugins` 加入 `@open333crm/shared` 依賴，所有 plugin `readonly channelType` 改用 `CHANNEL_TYPE.XXX`
- `apps/api` 20+ 處 comparisons、Prisma where、`getChannelPlugin()` 呼叫全換用常數
- `apps/web` 所有邏輯比較（`=== 'FB'`、`includes` 等）改用 `CHANNEL_TYPE.XXX`
- 修正 `apps/web` 中誤用 `'FACEBOOK'`（正確值為 `'FB'`）的 5 處 bug：`MessageInput`、`SimulatorPanel`、`ContactTimeline`、`CaseDetail`、`ChannelBadge`

## Capabilities

### New Capabilities
（無）

### Modified Capabilities

- `channel-plugins`: plugin `channelType` 宣告改用共享常數

## Impact

- **`packages/shared`**: `channel.types.ts` — 新增 `CHANNEL_TYPE` const
- **`packages/channel-plugins`**: 所有 plugin 類別 + `package.json`
- **`apps/api`**: webhook、webchat、channel、csat、login、conversation routes/services
- **`apps/web`**: MessageInput、ChannelWizard、ChannelFormDialog、ChannelManagement、ContactInfoPanel、ChannelBadge、SimulatorPanel、ContactTimeline、CaseDetail
