## 1. packages/shared — CHANNEL_TYPE const

- [x] 1.1 `packages/shared/src/types/channel.types.ts`：以 `as const` object 定義 `CHANNEL_TYPE`（LINE, FB, WEBCHAT, WHATSAPP, TELEGRAM, THREADS），`ChannelType` 型別衍生自 const

## 2. packages/channel-plugins — 加入 shared 依賴

- [x] 2.1 `packages/channel-plugins/package.json` 加入 `@open333crm/shared: workspace:*`
- [x] 2.2 LINE、FB、WEBCHAT、Telegram、Threads plugin 的 `readonly channelType` 改用 `CHANNEL_TYPE.XXX`

## 3. apps/api — 替換所有 channel type 字串

- [x] 3.1 `webhook/webhook.service.ts`、`webhook/webhook.routes.ts`
- [x] 3.2 `webchat/webchat.service.ts`、`webchat/webchat.socket.ts`
- [x] 3.3 `channel/channel.routes.ts`、`channel/channel.service.ts`
- [x] 3.4 `channel/fb-token-monitor.service.ts`、`channel/line-webhook-setup.service.ts`、`channel/webchat-embed.service.ts`
- [x] 3.5 `conversation/conversation.routes.ts`、`conversation/conversation.service.ts`
- [x] 3.6 `csat/csat.service.ts`、`fb-login/fb-login.routes.ts`、`line-login/line-login.routes.ts`、`line/line-profile.service.ts`
- [x] 3.7 `channels/simulator/simulator.routes.ts`

## 4. apps/web — 修正 FACEBOOK bug + 替換字串

- [x] 4.1 `MessageInput.tsx`：`'FACEBOOK'` → `CHANNEL_TYPE.FB`；`ChannelType` import
- [x] 4.2 `ChannelBadge.tsx`：移除 `FACEBOOK`/`facebook` 別名，加入 `WHATSAPP`
- [x] 4.3 `SimulatorPanel.tsx`：dropdown value `'FACEBOOK'` → `CHANNEL_TYPE.FB`
- [x] 4.4 `ContactTimeline.tsx`、`CaseDetail.tsx`：label map key `FACEBOOK` → `FB`
- [x] 4.5 `ChannelWizard.tsx`、`ChannelFormDialog.tsx`、`ChannelManagement.tsx`、`ContactInfoPanel.tsx`：所有邏輯比較改用 `CHANNEL_TYPE.XXX`

## 5. 驗證

- [x] 5.1 `pnpm --filter @open333crm/api exec tsc --noEmit` 通過
- [x] 5.2 `pnpm --filter @open333crm/web exec tsc --noEmit` 通過
- [x] 5.3 `pnpm --filter @open333crm/channel-plugins exec tsc --noEmit` 通過
