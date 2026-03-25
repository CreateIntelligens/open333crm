# Design: Channel Plugins Expansion

## Architecture
Both plugins will implement the `ChannelPlugin` interface defined in `@open333crm/types`.

### 1. Telegram Plugin (`packages/channel-plugins/src/telegram/`)
- Uses the Telegram Bot API (`api.telegram.org/bot<token>`).
- Webhook signature is validated differently (usually via secret token in headers rather than HMAC of body, introduced in Telegram API 6.0).
- Telegram lacks `userId` linking (no account link out of the box), so identity relies purely on the Telegram Chat ID.
- **Message Mapping**:
  - `message.text` -> `UniversalMessage (text)`
  - `callback_query` -> `UniversalMessage (postback)`

### 2. Facebook Messenger Plugin (`packages/channel-plugins/src/facebook/`)
- Uses the Meta Graph API (`graph.facebook.com/v19.0/me/messages`).
- Webhook subscription requires a `GET` verify flow (Hub challenge).
- Subsequent `POST` webhooks are signed with `X-Hub-Signature-256` using the App Secret.
- **Message Mapping**:
  - `entry[].messaging[].message.text` -> `UniversalMessage (text)`
  - `entry[].messaging[].postback` -> `UniversalMessage (postback)`

### 3. Setup Flow
Admins will add credentials (e.g., FB Page Token, App Secret, or Telegram Bot Token) to the `Channel` database record. The `InboxService` dynamically routes the webhook payload to the correct plugin based on the `Channel.type` and loads the credentials to verify the payload.
