## Context

The current standalone chatbox flow issues a signed `sessionId`, stores only its digest in `chatbox_sessions`, and treats that valid unexpired `sessionId` as the browser refresh boundary. `/chatbox?channel=...&sessionId=...` can therefore be refreshed or copied, and the backend will keep verifying the same database session until it expires or is revoked.

This change makes `sessionId` a single-use entry credential. Once the chatbox page successfully enters with a `sessionId`, the API records a Redis claim for that session. The Redis key lives for the same remaining lifetime as the database-backed chatbox session, so Redis and the session become unavailable together.

## Goals / Non-Goals

**Goals:**

- Prevent copied chatbox URLs from being usable after the first successful entry.
- Prevent browser refresh from reusing the same `sessionId`.
- Keep the active page usable for message send, media upload, and visitor Socket.IO events.
- Keep Redis TTL aligned with the chatbox session's remaining TTL.
- Avoid storing raw public `sessionId` values in Redis.

**Non-Goals:**

- Do not add browser-close cleanup. Closing or crashing the tab should leave the session claimed until TTL expiry.
- Do not change the embedded widget `visitorToken` flow.
- Do not expose previous chatbox history to visitors.
- Do not introduce a new database table or migration for claims.

## Decisions

1. Use Redis `SET NX EX/PX` as the claim authority.

   The API will derive the token digest from the submitted `sessionId`, load the matching `ChatboxSession`, compute remaining TTL from `expiresAt`, and atomically create `chatbox:session:claim:<tokenDigest>` only when it does not exist. This gives one successful entry per session across all API instances. Redis is already part of the runtime and fits the temporary nature of this state better than a database row.

   Alternative considered: persist a `claimedAt` field in `chatbox_sessions`. That would be durable but would require a migration and explicit cleanup/rollback behavior. The requested behavior is TTL-coupled and temporary, so Redis is the simpler control point.

2. Return a page-lifetime claim token after entry.

   After a successful claim, the API returns a random `claimToken` alongside config. The chatbox client keeps it only in React/page memory and sends it with messages, media uploads, and visitor socket auth. The token is not appended to the URL and is not persisted in localStorage/sessionStorage, so refresh or copied links cannot recover it.

   Alternative considered: allow the same browser fingerprint to reuse the session. That would still make refresh work and would not satisfy the requested behavior.

3. Store only hashed claim token material in Redis.

   The Redis claim value will contain a digest/HMAC of the page token plus minimal metadata such as chatbox session id and claimed timestamp. Request verification recomputes the page-token digest and compares it to the stored value. The raw `claimToken` is only returned to the active page.

   Alternative considered: store the raw claim token. This is unnecessary secret exposure in Redis and inconsistent with the existing session digest pattern.

4. Keep database verification as the baseline before claim checks.

   Existing `sessionId` signature, database digest lookup, expiry, revocation, channel activity, and fingerprint mismatch checks remain in force. Claim creation happens only after those checks pass. Message/media/socket verification must require both the valid session and matching active claim.

5. Treat claim conflicts as a safe unavailable state.

   When Redis already has a claim for the `sessionId`, `/sessions/verify` returns a 403-style application error for already-used sessions. The frontend renders a generic unavailable/expired state and does not create a new chatbox session from that same URL.

## Risks / Trade-offs

- Claimed tab closed before conversation starts -> the link remains unusable until session expiry. This is intentional for the single-use requirement; operators can issue a new chatbox link from the channel UI.
- Redis outage during entry -> the API cannot safely enforce single-use semantics. Fail closed for chatbox claim creation and return an unavailable state rather than allowing unclaimed entry.
- Clock drift between API and database expiry -> compute Redis TTL from the loaded `expiresAt` at request time and reject non-positive TTLs before claiming.
- Multiple tabs race the same URL -> `SET NX` allows exactly one winner; losers get the already-used response.

## Migration Plan

1. Add Redis claim helper functions in the chatbox service layer.
2. Extend chatbox bootstrap response and shared types with `claimToken`.
3. Update message, media, and visitor socket auth to require the claim token for chatbox sessions.
4. Update the chatbox page to keep `claimToken` only in memory and pass it to APIs/socket auth.
5. Add focused service and route/socket tests around first claim, duplicate claim, TTL, and active-page usage.
6. Rollback by removing the claim requirement and returning to `sessionId`-only verification; no schema migration is involved.

## Open Questions

None.
