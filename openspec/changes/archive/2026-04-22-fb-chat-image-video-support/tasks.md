## 1. Plugin Interface — Media Resolution Contract

- [x] 1.1 Add `MediaUploadFn` type and `resolveInboundMedia?` optional method to `ChannelPlugin` interface in `packages/channel-plugins/src/index.ts`
- [x] 1.2 Implement `resolveInboundMedia` on `LinePlugin` in `packages/channel-plugins/src/line/index.ts` — fetches binary from LINE Content API, calls `uploadFn` callback; returns null for external-URL messages (no `contentId`)

## 2. Webhook Service — Remove Channel-Specific Code

- [x] 2.1 Hoist `plugin` variable to top of `processInboundMessage` function scope (was only available inside the `if (!channelIdentity)` block)
- [x] 2.2 Replace `if (channel.channelType === 'LINE' && content.contentId && ...)` block with `if (plugin?.resolveInboundMedia)` — webhook service now has zero channel-name hardcodes for media handling; import `uploadFile` and inject as callback

## 3. Outbound Routes — Shared Handler + FB Support + send-video

- [x] 3.1 Add `MediaUploadConfig` interface and `handleSendMedia` helper to `apps/api/src/modules/conversation/conversation.routes.ts`
- [x] 3.2 Refactor `send-image` to use `handleSendMedia` with `SEND_IMAGE_CONFIG`; `allowedChannelTypes: ['LINE', 'FB']` removes the LINE-only 501 guard
- [x] 3.3 Add `POST /:id/send-video` route using `handleSendMedia` with `SEND_VIDEO_CONFIG` (mp4/quicktime, 25 MB, LINE + FB)

## 4. Verification

- [x] 4.1 `pnpm --filter @open333crm/channel-plugins build` passes
- [x] 4.2 `apps/api tsc --noEmit` passes — no type errors
