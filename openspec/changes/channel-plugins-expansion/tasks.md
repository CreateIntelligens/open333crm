# Tasks: Channel Plugins Expansion

## 1. Telegram Plugin
- [x] 1.1 Scaffold `packages/channel-plugins/src/telegram/TelegramPlugin.ts`
- [x] 1.2 Implement Webhook validation (Secret Token header)
- [x] 1.3 Implement incoming payload parsing to UniversalMessage
- [x] 1.4 Implement send strategy (Reply/Push) via Telegram API

## 2. Facebook Messenger Plugin
- [x] 2.1 Scaffold `packages/channel-plugins/src/facebook/FacebookPlugin.ts`
- [x] 2.2 Implement GET Verify challenge for Meta Webhooks
- [x] 2.3 Implement POST Webhook HMAC-SHA256 signature validation
- [x] 2.4 Implement incoming payload parsing to UniversalMessage
- [x] 2.5 Implement send strategy via Graph API

## 3. Database and Gateway Integration
- [x] 3.1 Update `ChannelType` enum in schema and types (add TELEGRAM, FACEBOOK)
- [x] 3.2 Register both plugins in the `apps/api` Plugin Registry mapping
- [x] 3.3 Ensure `routes/webhooks.ts` gracefully routes `GET` requests (for FB verify) and `POST` requests.
- [x] 3.4 Enforce `LicenseService.isChannelEnabled` in `apps/api` (block disabled channels gracefully).
