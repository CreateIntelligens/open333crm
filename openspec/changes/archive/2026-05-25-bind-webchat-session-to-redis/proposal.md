## Why

Standalone chatbox links currently rely on the signed `sessionId` as the refresh boundary, so the same URL can continue the same conversation when refreshed or shared. We need the public link to be single-use after entry, preventing copied URLs and repeated refreshes from reusing or repeatedly creating chatbox conversations.

## What Changes

- Bind each accepted chatbox `sessionId` to a Redis claim record when a visitor enters the chatbox.
- Use a Redis TTL equal to the remaining chatbox session TTL, so the claim and the session expire together.
- Reject later attempts to enter with the same `sessionId` while the Redis claim exists, including copied links and browser refreshes.
- Return a non-URL, page-lifetime claim token for the active page to use on message, media, and visitor socket requests.
- Preserve database-backed session expiry, revocation, fingerprint checks, and no-history bootstrap behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webchat-secure-session`: Chatbox `sessionId` verification changes from refresh-reusable to single-use Redis-claimed entry with page-lifetime request authorization.

## Impact

- `apps/api/src/modules/chatbox/chatbox.service.ts`: add Redis claim creation, claim verification, and TTL calculation from the stored session expiry.
- `apps/api/src/modules/chatbox/chatbox.routes.ts`: require claim token on message/media APIs after entry and expose claim state during bootstrap.
- `apps/api/src/modules/webchat/webchat.socket.ts` and chatbox session verifier plugin: authenticate visitor socket connections with both `sessionId` and the active claim token.
- Chatbox client route/runtime: hold the returned claim token only in memory and avoid persisting it into the URL or storage.
- Redis: add session claim keys with TTL matching the remaining chatbox session lifetime.
- Tests: cover first entry, shared-link rejection, refresh rejection, expiry cleanup, and page-lifetime message/media/socket success.
