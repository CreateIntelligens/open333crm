## Why

The LINE webhook currently treats every inbound image as requiring a download from LINE's Content API, even when LINE itself provides a permanent external URL via `contentProvider`. This wastes bandwidth and MinIO storage for images already hosted elsewhere. Additionally, there is no on-demand way to refresh a contact's LINE `displayName` and `pictureUrl` after initial creation — agents have to wait for the contact to send a new message before the profile updates.

## What Changes

- **Modify** `parseWebhook` in `packages/channel-plugins/src/line/index.ts` to inspect `contentProvider` on image (and video/audio/file) message events:
  - If `contentProvider.type === "external"` → populate `content.url` and `content.previewUrl` from the payload; do **not** set `contentId`
  - If `contentProvider.type === "line"` (default) → keep today's `contentId`-based flow (async download → MinIO upload)
- **Add** a new authenticated API endpoint `PATCH /api/channels/:channelId/contacts/:lineUid/sync-profile` that:
  - Calls `plugin.getProfile(lineUid, credentials)` against the LINE Messaging API
  - Updates `ChannelIdentity.profileName` and `ChannelIdentity.profilePic` only
  - Leaves `Contact.displayName` and `Contact.avatarUrl` untouched (Option B policy)
  - Requires AGENT role or above (JWT auth)

## Capabilities

### New Capabilities

- `line-contact-profile-sync`: On-demand API to refresh a LINE contact's `displayName` and `pictureUrl` from the LINE Messaging API into `ChannelIdentity`

### Modified Capabilities

- `line-webhook-events`: The "Immediate media download on receipt" requirement changes — images with `contentProvider.type === "external"` SHALL store the provided URL directly without triggering a MinIO upload

## Impact

- `packages/channel-plugins/src/line/index.ts`: `parseWebhook` — image/video/audio/file case
- `apps/api/src/modules/webhook/webhook.service.ts`: step 3b guard already correct (checks `content.contentId`), no change needed
- New files: `apps/api/src/modules/line/line-profile.routes.ts`, `apps/api/src/modules/line/line-profile.service.ts`
- No DB schema changes; no new dependencies
