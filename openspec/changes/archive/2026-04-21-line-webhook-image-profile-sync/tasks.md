## 1. Update LINE plugin — contentProvider detection

- [x] 1.1 In `packages/channel-plugins/src/line/index.ts`, update the `image` / `video` / `audio` / `file` case inside `parseWebhook` to read `(m as any).contentProvider`
- [x] 1.2 When `contentProvider?.type === 'external'`: set `content = { text: '[圖片]'/'[影片]'/etc., url: contentProvider.originalContentUrl, previewUrl: contentProvider.previewImageUrl ?? contentProvider.originalContentUrl }` — do NOT set `contentId`
- [x] 1.3 When `contentProvider?.type !== 'external'` (default): keep existing `content = { text: ..., contentId: m.id, mediaUrl: 'line-content:{m.id}', ... }` unchanged

## 2. Add profile sync service

- [x] 2.1 Create `apps/api/src/modules/line/line-profile.service.ts` with `syncLineContactProfile(prisma, channelId, lineUid)` that: finds `ChannelIdentity` by `channelId_uid`, loads channel credentials, calls `linePlugin.getProfile(lineUid, credentials)`, updates `ChannelIdentity.profileName` and `ChannelIdentity.profilePic`, returns the updated record
- [x] 2.2 Return HTTP 404 `AppError` if `ChannelIdentity` is not found
- [x] 2.3 Wrap LINE API call in try/catch and throw HTTP 502 `AppError` on upstream failure

## 3. Add profile sync route

- [x] 3.1 Create `apps/api/src/modules/line/line-profile.routes.ts` with `PATCH /channels/:channelId/contacts/:lineUid/sync-profile`, `preHandler: [requireAuth()]` (any authenticated agent), calling `syncLineContactProfile`
- [x] 3.2 Validate `channelId` and `lineUid` params with Zod (non-empty strings)
- [x] 3.3 Register the new routes in `apps/api/src/index.ts` with prefix `/api/v1`

## 4. Verify

- [x] 4.1 Confirm that an image webhook event with `contentProvider.type === 'external'` produces a message with `content.url` set and no `content.contentId`
- [x] 4.2 Confirm that an image webhook event with no `contentProvider` still produces `content.contentId` (existing behaviour unchanged)
- [x] 4.3 Call `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` with a valid JWT and confirm `ChannelIdentity.profileName` and `profilePic` are updated
- [x] 4.4 Call the endpoint with a non-existent `lineUid` and confirm HTTP 404
