## 1. Redis Claim Service

- [x] 1.1 Add chatbox Redis claim helpers that derive claim keys from token digest, create claims atomically with `SET NX`, and compute TTL from `ChatboxSession.expiresAt`.
- [x] 1.2 Generate a random page-lifetime claim token on successful entry and store only its digest/HMAC in the Redis claim value.
- [x] 1.3 Add claim verification helpers that validate `sessionId` plus claim token without accepting raw `sessionId` reuse.
- [x] 1.4 Fail closed with clear application errors when Redis is unavailable, the session is already claimed, the claim token mismatches, or the session TTL is non-positive.

## 2. API Contract

- [x] 2.1 Extend shared chatbox bootstrap/request types to include the returned `claimToken` and request-side claim token fields.
- [x] 2.2 Update `/api/v1/chatbox/sessions/verify` so successful first entry creates the Redis claim and returns `claimToken` with config.
- [x] 2.3 Update `/api/v1/chatbox/messages` to require a valid claim token for chatbox message submission.
- [x] 2.4 Update `/api/v1/chatbox/media` multipart handling to require a valid claim token alongside `sessionId`.
- [x] 2.5 Preserve existing session signature, digest lookup, expiry, revocation, channel activity, and fingerprint checks before claim creation or claim verification.

## 3. Socket And Client

- [x] 3.1 Update the chatbox session verifier plugin and visitor socket auth so chatbox socket connections require `sessionId` plus matching claim token.
- [x] 3.2 Update the `/chatbox` page to store `claimToken` only in React/page memory after bootstrap.
- [x] 3.3 Pass the in-memory claim token on chatbox message sends, media uploads, and Socket.IO auth.
- [x] 3.4 Render a safe unavailable/expired state when the same `sessionId` is rejected because it is already claimed, including refresh and shared-link cases.

## 4. Tests And Verification

- [x] 4.1 Add focused chatbox service tests for first claim success, duplicate claim rejection, TTL alignment with `expiresAt`, and raw `sessionId` absence from Redis keys/values.
- [x] 4.2 Add route-level tests for `/sessions/verify`, `/messages`, and `/media` requiring the claim token after entry.
- [x] 4.3 Add socket auth coverage for accepted claimed sessions and rejected missing/mismatched claim token sessions.
- [x] 4.4 Run the existing chatbox API tests and relevant web type/build checks.
