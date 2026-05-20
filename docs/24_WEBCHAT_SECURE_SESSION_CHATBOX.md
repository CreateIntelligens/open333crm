# 24 - WebChat Secure Session Chatbox
# 固定路由聊天室與安全 Session 設計探索

## Position / 定位

這份文件探索下一版 WebChat 入口：使用固定公開路由，例如 `/chatbox`，由 `sessionId` 管理訪客聊天室生命週期。

目標不是再做一個單純 embed widget，而是建立一個可分享、可刷新、可過期、可弱綁定裝置 fingerprint 的聊天入口：

- `GET /chatbox` 沒有有效 `sessionId` 時，建立新 session 與新 conversation，然後 redirect 到帶有 `sessionId` 的 URL。
- `GET /chatbox?sessionId=...` 有效時，載入同一個 session 與同一個 conversation。
- visitor client 不可讀取 server-side conversation history；只有後台 agent/API 可以讀歷史紀錄。
- session 外流時，系統用最小程度 fingerprint 判斷可疑使用，不把 fingerprint 當強身份驗證。
- 訊息格式要前後端統一，為表情、圖片、附件、系統訊息、多語言等擴展保留欄位。

相關既有脈絡：

- `openspec/changes/archive/2026-04-08-webchat-embeddable-widget`
- `openspec/changes/archive/2026-04-22-webchat-media`
- 目前實作：`apps/api/src/modules/webchat/*`、`apps/widget/src/*`

---

## Current Baseline / 目前基線

目前 WebChat 行為大致是：

```text
Widget load
  -> sessionStorage open333crm_visitor UUID
  -> POST /api/v1/webchat/:channelId/sessions
       returns visitorToken + greeting only
  -> visitor sends first message
  -> POST /api/v1/webchat/:channelId/messages
  -> handleVisitorMessage()
  -> processInboundMessage()
  -> contact / conversation / message created or reused
  -> inbox sees conversation
```

媒體訊息已採兩段式：

```text
file selected
  -> POST /api/v1/webchat/:channelId/media
  -> returns { url, contentType }
  -> POST /api/v1/webchat/:channelId/messages
       { visitorToken, contentType: "image" | "video", content: { url } }
```

新 `/chatbox` 模式和既有 widget 的關鍵差異：

| Area | Current Widget | Proposed `/chatbox` |
| --- | --- | --- |
| Visitor key | `visitorToken` UUID in `sessionStorage` | signed `sessionId` in URL |
| Conversation creation | first visitor message | session creation |
| Refresh | token reused by `sessionStorage` | `sessionId` reused by URL |
| History to visitor | currently no history response in implementation | explicitly no server history response |
| Leak detection | none beyond token UUID format | weak fingerprint binding + expiry |

---

## High-Level Flow / 高階流程

```text
┌────────────────────────────────────────────────────────────┐
│ Browser opens /chatbox                                     │
└──────────────────────────────┬─────────────────────────────┘
                               │
                               ▼
                 ┌──────────────────────────┐
                 │ sessionId query exists?  │
                 └─────────────┬────────────┘
                               │
              no               │ yes
              │                ▼
              │      ┌──────────────────────┐
              │      │ verify sessionId      │
              │      │ - signature           │
              │      │ - expiry              │
              │      │ - server session row  │
              │      │ - fingerprint score   │
              │      └──────────┬───────────┘
              │                 │
              ▼                 ▼
┌────────────────────────┐   valid?
│ create ChatboxSession  │      │
│ create Conversation    │      │ no
│ issue signed sessionId │◀─────┘
└───────────┬────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ 302 /chatbox?sessionId=<signed-token>                      │
└──────────────────────────────┬─────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────┐
│ boot chat UI                                                │
│ - public config                                             │
│ - background image                                          │
│ - greeting                                                  │
│ - socket auth with sessionId                                │
│ - no history payload                                        │
└────────────────────────────────────────────────────────────┘
```

---

## SessionId Design / sessionId 設計

需求說法是 `random + expire_time + fingerprint`。實作上不建議把這三個值直接明文串起來，因為：

- `expire_time` 可被竄改。
- fingerprint 若明文放在 URL，會增加隱私與外流風險。
- random 若長度不足會被猜測。

建議採 signed structured token：

```text
sessionId = base64url(payload) + "." + base64url(signature)

payload = {
  v: 1,
  sid: "<256-bit random id>",
  exp: 1770000000,
  fp: "<fingerprint hash prefix or id>",
  kid: "key-2026-05"
}

signature = HMAC-SHA256(serverSecret[kid], base64url(payload))
```

更保守的做法是 opaque token：

```text
sessionId = base64url(256-bit random) + "." + base64url(hmac(random))
```

然後把 `exp`、`fpHash`、`conversationId` 都存在 DB。這樣 URL 不暴露任何 metadata。若未來要 rotate secret 或調整 fingerprint，server-side row 比自含 payload 更好控。

建議採用：

```text
Public URL sessionId: opaque signed token
DB ChatboxSession: stores random digest, expiresAt, fingerprintHash, conversationId
```

### Session Row / 建議資料模型

```text
ChatboxSession
  id                uuid
  tenantId          uuid
  channelId         uuid
  conversationId    uuid
  tokenDigest        string   # sha256(sessionId random part + pepper), not raw token
  fingerprintHash    string
  fingerprintVersion int
  expiresAt          datetime
  lastSeenAt         datetime
  revokedAt          datetime?
  riskLevel          enum LOW | MEDIUM | HIGH
  createdAt          datetime
  updatedAt          datetime
```

不要存 raw `sessionId`。DB 泄漏時，token digest 不能直接拿來打 API。

---

## Fingerprint Strategy / Fingerprint 策略

fingerprint 只能做到「最小程度辨識外流」，不能當強身份。瀏覽器資料不穩定，過度嚴格會讓正常使用者刷新或換網路後失敗。

建議 fingerprint normalization：

```text
fingerprintInput =
  uaFamily          # Chrome / Safari / Firefox, not full UA
  osFamily          # iOS / Android / macOS / Windows
  languagePrimary   # zh / en / ja
  timezone          # Asia/Taipei
  screenBucket      # e.g. 390x844 -> mobile-small
```

避免或降低權重：

- 完整 IP：變動大，且隱私性較高。
- 完整 User-Agent：太細，升級瀏覽器就變。
- Canvas/WebGL fingerprint：侵入性高，容易踩隱私期待。

fingerprint 檢查可以做 score：

| Result | Meaning | Suggested behavior |
| --- | --- | --- |
| exact/near match | same likely browser | allow |
| partial mismatch | maybe browser upgraded / viewport changed | allow, mark `riskLevel=MEDIUM` |
| strong mismatch | leaked URL likely opened elsewhere | reject with expired/restart screen, or create new session |

建議第一版採偏安全策略：

```text
strong mismatch -> 403 session_mismatch
UI -> 顯示「此聊天連結已失效，請重新開啟聊天室」
```

如果商業上更重視可用性，可以改成：

```text
strong mismatch -> revoke old session + create new session + new conversation
```

---

## Session Lifecycle / 生命週期

```text
CREATED
  -> ACTIVE       # chatbox page booted
  -> EXPIRED      # now > expiresAt
  -> REVOKED      # fingerprint mismatch / admin action
```

### Rules

- No `sessionId`: create `ChatboxSession` and `Conversation`, redirect.
- Valid `sessionId`: continue same `Conversation`.
- Expired `sessionId`: do not reveal history; show restart action or auto-create a new session.
- Revoked/mismatched `sessionId`: reject or restart based on product decision.
- Refresh during active chat: same `sessionId`, same `Conversation`, no history replay to client.

### Expiry

Two times are useful:

```text
absoluteExpiresAt: hard max lifetime, e.g. 24h
idleExpiresAt: extended on activity, e.g. 30m after lastSeenAt
```

For support chat, first version can use one `expiresAt` field, then add idle expiry later.

---

## Conversation Creation / Conversation 建立

Requirement says every session creates a new conversation. That means `/chatbox` differs from current SDK behavior.

```text
create session
  -> create/find ContactIdentity for this session identity
  -> create new Conversation
  -> link ChatboxSession.conversationId
```

Important: "every session creates new conversation" should mean every newly issued `sessionId`, not every refresh.

```text
new sessionId     -> new conversation
same sessionId    -> same conversation
expired sessionId -> new sessionId, new conversation
```

`visitorToken` can be replaced by session identity for chatbox mode:

```text
contactUid = "chatbox:" + session.id
visitor room = visitor:${channelId}:${session.id}
```

Or keep compatibility by deriving a UUID-like visitor token stored server-side:

```text
ChatboxSession.visitorToken = uuid
contactUid = visitorToken
```

Compatibility option is safer because current `processInboundMessage()` already keys WebChat contact identity by `visitorToken`.

---

## Client History Boundary / Client 不可讀歷史

The visitor client must not call a history endpoint and must not receive server-side message history on bootstrap.

Allowed bootstrap response:

```json
{
  "session": {
    "expiresAt": "2026-05-20T10:30:00.000Z"
  },
  "config": {
    "displayName": "客服聊天室",
    "welcomeMessage": "您好，請問需要什麼協助？",
    "backgroundImageUrl": "https://..."
  }
}
```

Not allowed in visitor bootstrap:

```json
{
  "messages": []
}
```

Refresh behavior:

- The visitor can keep chatting after refresh because `sessionId` maps to the same conversation.
- The visitor does not receive previous server-side messages after refresh.
- Backend/agent UI can read full history normally.

If UX later requires visitor-side visible transcript after refresh, that conflicts with "client 不可讀歷史". The only softer option is local in-memory UI state, but refresh destroys it.

---

## Public Route and APIs / 路由與 API 草案

### Public page

```text
GET /chatbox
GET /chatbox?sessionId=<token>
```

Open question: `/chatbox` must resolve tenant/channel somehow.

Options:

| Option | URL | Tradeoff |
| --- | --- | --- |
| Default channel | `/chatbox` | simplest, only works for one public webchat channel per deployment |
| Query channel key | `/chatbox?channel=<publicKey>` | fixed route, supports many channels |
| Path key | `/chatbox/:publicKey` | cleaner sharing, less "fixed route" |

If `/chatbox` must stay fixed, recommend:

```text
/chatbox?channel=<publicChannelKey>
```

and after session creation:

```text
/chatbox?channel=<publicChannelKey>&sessionId=<token>
```

### Public APIs

```text
POST /api/v1/chatbox/sessions
  body: { channelKey, fingerprint }
  returns: { redirectUrl }

POST /api/v1/chatbox/sessions/verify
  body: { sessionId, fingerprint }
  returns: { expiresAt, config }

POST /api/v1/chatbox/messages
  body: WebChatMessageInput
  returns: WebChatMessageAck

POST /api/v1/chatbox/media
  multipart: sessionId + file
  returns: { type: "image" | "video" | "file", payload }
```

The existing `/api/v1/webchat/:channelId/messages` can remain for embed widget compatibility. `/chatbox/*` can be a new module that wraps the same service-level inbound message path after session verification.

---

## Unified Message Interface / 統一訊息介面

訊息格式應該是 discriminated union。不要讓前端各自拼 `content` shape。

### Input: visitor to API

```ts
type WebChatMessageInput =
  | {
      sessionId: string;
      clientMessageId: string;
      type: 'text';
      payload: { text: string };
      locale?: string;
      sentAt?: string;
    }
  | {
      sessionId: string;
      clientMessageId: string;
      type: 'image';
      payload: { mediaId: string; url: string; alt?: string };
      locale?: string;
      sentAt?: string;
    }
  | {
      sessionId: string;
      clientMessageId: string;
      type: 'emoji';
      payload: { shortcode: string; unicode?: string };
      locale?: string;
      sentAt?: string;
    };
```

`clientMessageId` is for idempotency and optimistic UI reconciliation.

### Output: API/socket to client

```ts
type WebChatMessageOutput = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender: {
    type: 'VISITOR' | 'AGENT' | 'BOT' | 'SYSTEM';
    displayName?: string;
  };
  type: 'text' | 'image' | 'video' | 'file' | 'emoji' | 'system';
  payload: Record<string, unknown>;
  createdAt: string;       // server ISO timestamp
  sequence: number;        // per-conversation monotonic ordering if available
  status?: 'sending' | 'sent' | 'failed';
};
```

Do not expose `conversationId` to visitor unless there is a concrete need. The visitor should operate on `sessionId`.

### Sorting

UI sorting should use:

```text
sequence ASC, createdAt ASC, id ASC
```

If there is no `sequence` yet:

```text
createdAt ASC, id ASC
```

Server timestamp is authoritative. `sentAt` from client is metadata only.

---

## Background Image / 聊天室背景圖

後台可在 WebChat channel settings 上傳背景圖。

Suggested storage:

```text
Channel.settings.webchatTheme = {
  backgroundImageAssetId: "...",
  backgroundImageUrl: "https://...",
  backgroundMode: "cover" | "contain" | "repeat",
  overlay: "light" | "dark" | "none"
}
```

Admin flow:

```text
Agent uploads image
  -> storage service / MinIO
  -> save asset id/url in channel settings
  -> public chatbox config returns sanitized background URL
```

Visitor bootstrap may read theme config, but not messages.

Security constraints:

- Only allow tenant-owned uploaded assets.
- Prefer signed/public-safe asset URL rather than arbitrary remote URL.
- Validate MIME and size.
- Strip EXIF metadata if image processing is added later.

---

## Fastify Decorator Extension Points / Fastify Decorator 擴展點

Use Fastify decorators to keep WebChat extensibility centralized instead of scattering `if contentType === ...` checks across routes.

### Message type registry

```ts
fastify.decorate('webchatMessageTypes', {
  register(type, handler) {},
  parse(input) {},
  serialize(message) {},
});
```

Handler shape:

```ts
type WebChatMessageTypeHandler = {
  type: string;
  parseInput(input: unknown): ParsedWebChatPayload;
  toParsedWebhookMessage(payload: ParsedWebChatPayload): {
    contentType: string;
    content: Record<string, unknown>;
  };
  renderForVisitor(message: Message): WebChatMessageOutput;
  renderForAgent(message: Message): AgentMessageOutput;
};
```

Registration example:

```ts
fastify.webchatMessageTypes.register('emoji', emojiMessageHandler);
fastify.webchatMessageTypes.register('image', imageMessageHandler);
```

### Locale registry

```ts
fastify.decorate('webchatI18n', {
  resolveLocale(req) {},
  translate(key, locale, params) {},
});
```

Use cases:

- error messages
- welcome message fallback
- upload validation text
- system message copy

### Session verifier decorator

```ts
fastify.decorate('verifyChatboxSession', async (req) => {
  // verify signature, expiry, fingerprint, session row
});
```

Routes then stay small:

```text
route
  -> verifyChatboxSession
  -> parse message through registry
  -> process inbound message
```

---

## Security Model / 安全模型

### Threats

| Threat | Mitigation |
| --- | --- |
| Guess sessionId | 256-bit random token + HMAC |
| Tamper expiry/fingerprint | signature or server-side opaque row |
| DB token leak | store token digest, not raw token |
| URL copied to another browser | weak fingerprint check + expiry + optional revoke |
| Client reads history | no visitor history endpoint; bootstrap excludes messages |
| Replay send message | `clientMessageId` idempotency per session |
| Upload abuse | MIME/size validation, tenant/channel check, rate limit |
| XSS in text | escape text rendering, never trust payload HTML |

### Rate limits

Public endpoints need per-IP and per-session rate limits:

```text
POST /api/v1/chatbox/sessions      low threshold
POST /api/v1/chatbox/messages      per session + per IP
POST /api/v1/chatbox/media         stricter size/count limits
Socket.IO /visitor connect         per IP + session
```

---

## Open Questions / 待決策

1. `/chatbox` 如何解析 channel？
   - 單一部署預設 channel？
   - `?channel=<publicKey>`？
   - path-based `/chatbox/:publicKey`？

2. Fingerprint mismatch 的產品行為是什麼？
   - 直接 403？
   - 自動建立新 session/new conversation？
   - 允許但標記風險？

3. Session expiry 是固定 TTL 還是 idle timeout？
   - 第一版建議固定 TTL，之後再加 idle expiry。

4. Visitor refresh 後是否需要顯示舊訊息？
   - 若需要，會違反「client 不可讀歷史」。
   - 若不需要，目前設計成立：refresh 後可繼續同一 conversation，但畫面不 replay history。

5. 是否要把 `/chatbox` 和現有 `/webchat/open/:channelId` 合併？
   - `/webchat/open/:channelId` 偏 SDK auto-open。
   - `/chatbox` 偏 signed session + conversation-on-session。

---

## Possible OpenSpec Change Name

如果這個方向要正式進 OpenSpec，建議 change name：

```text
define-secure-chatbox-session
```

建議 capabilities：

- `webchat-secure-session`
- `webchat-message-contract`
- `webchat-admin-theme`

