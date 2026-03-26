# Proposal: Channel Plugins Expansion (FB Messenger & Telegram)

## Goal
Implement two new channel adapters (`FbMessengerPlugin` and `TelegramPlugin`) under `packages/channel-plugins` to expand the platform's multi-channel capabilities. This will prove the flexibility of our architecture and allow businesses to handle Facebook and Telegram messaging securely and uniformly.

## Context
Currently, the system only supports the `LINE OA` channel. Before we dive into advanced CRM logic, we want to ensure our foundation can genuinely handle multiple channels via the `ChannelAdapter` interface. 

## Proposed Changes
1. **Telegram Plugin**:
   - Implement webhook verification for Telegram Bot API.
   - Implement universal parsing for incoming Text, Location, and Callback Queries (Inline Keyboards).
   - Implement outgoing message sending via standard HTTP API.
2. **Facebook Messenger Plugin**:
   - Implement webhook verification (verify token) and HMAC-SHA1 signature validation.
   - Implement universal parsing for incoming Text and Postbacks (Buttons).
   - Implement outgoing message sending via Facebook Graph API.
3. **API Gateway updates**:
   - Create generic webhook routing that proxies to the appropriate loaded channel plugin.

## Expected Impact
The platform will support real multi-channel capabilities. A user could configure a LINE, Telegram, and FB Messenger channel, and all messages will flow uniformly into the central `InboxService`.
