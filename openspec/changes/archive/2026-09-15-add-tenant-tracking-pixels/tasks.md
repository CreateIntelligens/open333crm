## 1. Database Migration

- [x] 1.1 Add `gaId` and `metaPixelId` nullable String fields to `TenantSettings` model in `packages/database/prisma/schema.prisma`
- [ ] 1.2 Run `pnpm db:migrate -- --name add-tracking-settings` to create migration

## 2. API Layer

- [x] 2.1 Add Zod validation schema for tracking settings (gaId: string|null, metaPixelId: string|null) in `apps/api/src/modules/settings/settings.routes.ts`
- [x] 2.2 Add `GET /api/v1/settings/tracking` endpoint — read gaId/metaPixelId from TenantSettings
- [x] 2.3 Add `PUT /api/v1/settings/tracking` endpoint — upsert gaId/metaPixelId into TenantSettings

## 3. Shortlink Strategy — Tracking Script Injection

- [x] 3.1 Create `apps/api/src/modules/shortlink/strategies/tracking-snippet.ts` — helper functions `buildGa4Snippet(gaId)` and `buildMetaPixelSnippet(metaPixelId)` that return HTML string fragments
- [x] 3.2 Modify `external-browser.strategy.ts` — accept tracking config, inject GA4 + Meta Pixel scripts after sendBeacon, before location.replace
- [x] 3.3 Modify `line-webview.strategy.ts` — inject tracking scripts into the LIFF redirect micro-page
- [x] 3.4 Verify `bot.strategy.ts` does NOT inject any tracking (already confirmed — no changes needed)

## 4. Frontend — Settings UI

- [x] 4.1 Add "追蹤設定" tab to `SETTINGS_TABS` array in `apps/web/src/app/dashboard/settings/page.tsx`
- [x] 4.2 Create `apps/web/src/components/settings/TrackingSettings.tsx` — form with GA4 ID and Meta Pixel ID inputs, save button, loading/success state
- [x] 4.3 Import and render `<TrackingSettings />` in the settings page tab switch

## 5. Verification

- [x] 5.1 Verify `GET /api/v1/settings/tracking` returns `{ gaId: null, metaPixelId: null }` for new tenant
- [x] 5.2 Verify `PUT /api/v1/settings/tracking` persists values and `GET` returns them
- [x] 5.3 Verify shortlink redirect HTML includes GA4 script when gaId is set
- [x] 5.4 Verify shortlink redirect HTML includes Meta Pixel script when metaPixelId is set
- [x] 5.5 Verify BOT strategy never includes tracking scripts
- [x] 5.6 Verify tracking settings tab renders in frontend and saves correctly
