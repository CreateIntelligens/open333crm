## Context

The LINE plugin's `parseWebhook` method always emits `contentId` for image/video/audio/file messages, triggering an async download from LINE's Content API and upload to MinIO for every media message. However, LINE's webhook payload includes a `contentProvider` field that distinguishes between content hosted by LINE (requiring download) and content already hosted externally (permanent URL available immediately).

The `webhook.service.ts` step 3b guard already correctly skips the async download when `content.contentId` is absent — so the only change needed is in the plugin layer.

For profile sync: `plugin.getProfile()` already exists in the LINE plugin and is called at first-contact creation. There is no endpoint to re-trigger it on demand. The design decision is Option B: ChannelIdentity is the LINE source of truth; Contact fields are not overwritten by sync.

## Goals / Non-Goals

**Goals:**
- Skip MinIO upload for externally-hosted LINE images; store the permanent URL directly
- Provide an authenticated REST endpoint for agents to manually refresh a LINE contact's `displayName` and `pictureUrl` into `ChannelIdentity`

**Non-Goals:**
- Bulk profile sync across all contacts for a channel
- Updating `Contact.displayName` or `Contact.avatarUrl` (Option B policy — ChannelIdentity only)
- Unauthenticated / LIFF-triggered profile sync
- Handling non-LINE channels in the new sync endpoint

## Decisions

### 1. contentProvider detection belongs in the plugin, not the webhook service

**Decision:** Modify `parseWebhook` in `packages/channel-plugins/src/line/index.ts`. The plugin is the correct layer to normalize LINE-specific payload fields into the `ParsedWebhookMessage` contract. `webhook.service.ts` stays channel-agnostic.

**Alternative considered:** Check for `line-content:` prefix in `webhook.service.ts`. Rejected — leaks LINE-specific logic into the generic service layer.

### 2. External URL images: omit contentId, set url directly

**Decision:** When `contentProvider.type === "external"`:
```
content = {
  url: contentProvider.originalContentUrl,
  previewUrl: contentProvider.previewImageUrl ?? contentProvider.originalContentUrl,
  text: '[圖片]',
}
// contentId NOT set → step 3b guard skips async download automatically
```

**Alternative considered:** Set both `url` and `contentId`. Rejected — would redundantly trigger MinIO upload even though a permanent URL is available.

### 3. Profile sync endpoint: PATCH on channel-scoped contact resource

**Decision:**
```
PATCH /api/channels/:channelId/contacts/:lineUid/sync-profile
preHandler: requireAuth (any authenticated agent)
```
Returns the updated `ChannelIdentity` fields. Uses `getChannelPlugin('LINE')` internally.

**Alternative considered:** `POST /api/line/sync-profile` with body. Rejected — REST resource path is more conventional and aligns with existing channel-scoped routes.

### 4. Write-back policy: ChannelIdentity only (Option B)

**Decision:** `syncLineProfile` updates only `ChannelIdentity.profileName` and `ChannelIdentity.profilePic`. `Contact.displayName` and `Contact.avatarUrl` are left unchanged to preserve agent edits.

## Risks / Trade-offs

- **[Risk] External URLs may expire** → LINE's external `contentProvider` URLs are provided by the sender's app and may not be permanent. Mitigation: out of scope for this change; this is the same behaviour as any other channel that provides external URLs.
- **[Risk] getProfile rate-limited by LINE API** → LINE's Messaging API has per-second rate limits. Mitigation: the endpoint is agent-triggered (manual), so volume is naturally low.
- **[Trade-off] ChannelIdentity-only sync** → Agent-facing contact name stays stale if Contact was renamed. Acceptable per explicit product decision (Option B).

## Migration Plan

No DB migrations required. Deploy is a straight code push:
1. Update `packages/channel-plugins/src/line/index.ts`
2. Add `apps/api/src/modules/line/line-profile.routes.ts` + `line-profile.service.ts`
3. Register new routes in the API plugin registry

Rollback: revert the two changed files; no state is affected.

## Open Questions

None — all decisions made during exploration session.
