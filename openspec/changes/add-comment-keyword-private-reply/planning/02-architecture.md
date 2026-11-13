# 02 — 程式架構規劃：留言關鍵字自動私訊

> 範圍：模組切分、資料流、渠道外掛契約、API、佇列與冪等、聯絡人與收件匣串接、平台層。
> 資料表只寫「需求」（要記什麼、唯一性、查詢模式），欄位型別、索引、RLS migration、上線步驟見 `03-sre-db.md`。
> 依據：`proposal.md`「決定」一節（2026-11-13 使用者拍板）、`planning/00-initial-plan-2026-10-21.md`、`planning/01-ux.md` §11。
> 程式位置以 2026-11-13 的 main（`29dad93a`）重新確認過；00 號文件的行號已過時，以本文件為準。

---

## 0. 從現在的 main 讀到、會改變 00 號規劃的事實

| # | 事實 | 出處 | 對設計的影響 |
| - | ---- | ---- | ---- |
| F1 | 新的背景工作慣例是 **API 行程消費的佇列＋outbox 排入**：`coupon-broadcast` 佇列由 `broadcast-coupon.flow.ts` 以 `enqueueJob(scope, …)` 寫 outbox，`broadcast-coupon.worker.ts` 在 API 行程執行，用 `inTenant()`（app_tenant 連線） | `apps/api/src/modules/marketing/broadcast-coupon.*`、`apps/api/src/events/outbox-publisher.ts` | 00 號把 handler 放 `apps/workers`。改放 API 行程（理由見 §4.1）。workers 行程用的是 `DATABASE_URL_ADMIN`（BYPASSRLS），新程式放那裡只剩第一層隔離 |
| F2 | service 收 `TenantCtx`、副作用（推播、outbox、稽核）放 flow，以 `inTenant()` 開交易；`flowOf()` 包單一 service | `apps/api/src/lib/tenant-ctx.ts` | 本模組所有 service 簽章都是 `(ctx: TenantCtx, …)`，不是 00 號寫的 `(prisma, …)` |
| F3 | 入站分派 `routeWebhookMessages()`／`routePlatformMessages()` 的型別寫死 `ParsedWebhookMessage[]`，但只用到 `accountId` | `apps/api/src/modules/webhook/webhook-account-routing.ts` | 改成泛型 `<T extends { accountId?: string }>`，留言事件直接沿用同一套分派（含「同一個 Meta App」檢查、停用渠道視同未認領） |
| F4 | 關鍵字比對已抽到 `@open333crm/automation` 的 `matchKeywordTrigger()`（包含、不分大小寫、any／all），AI 讓步與 workers 共用 | `packages/automation/src/keyword/keyword-match.ts` | 不從 `automation.worker.ts` 抽，改把比對核心再抽一層共用（§3.4） |
| F5 | FB 外掛 `sendMessage()` 送 `POST /me/messages`，`recipient: { id }` 寫死，回傳只有 `channelMsgId`，丟掉 Meta 回應的 `recipient_id` | `packages/channel-plugins/src/facebook/index.ts` | 新方法要回傳 `recipientId`（聯絡人對應的關鍵，§6） |
| F6 | IG 渠道走 **Instagram Login**（`graph.instagram.com`），權杖由租戶手動貼上、每個 IG 渠道各自存 `appId`／`appSecret`；系統完全沒有呼叫 IG 的 `subscribed_apps` | `threads.ts`、`channel.service.ts` `verifyChannel()` THREADS 分支 | IG 的留言訂閱要新增；租戶若用自己的 App，App 後台的 `comments` 欄位要租戶自己開 |
| F7 | Meta 連結精靈只處理 FB 粉專（平台模式），`SUBSCRIBED_FIELDS = ['messages','messaging_postbacks','messaging_referrals','message_echoes']`；重新連結會以這份清單重新 `POST subscribed_apps` | `meta-connect.service.ts` | 加 `feed` 的時機要小心：訂了就會收到該粉專**所有**動態（按讚、分享、貼文），見 §7.1 |
| F8 | 權限天花板只作用在 HTTP 路由（`loadPlanCeiling()` 依 `plan.features` 推權限），背景工作沒有任何 feature 檢查 | `apps/api/src/services/permission.service.ts` | 留言事件的收件與處理要**自己**查方案是否包含本 feature（§4.4、§9） |
| F9 | `app_tenant` 對 `plans`、`tenants`、`platform_settings` 有 SELECT | migration `20261103110000_revoke_app_tenant_platform_tables` | 租戶交易內讀得到方案 features、上限與平台旗標，不必用 `prismaAdmin` |
| F10 | 聯絡人合併（One ID）逐表搬移 `contactId` 並記錄供解除合併搬回 | `contact-merge.service.ts` | 留言紀錄**不存 contactId 外鍵**，改存渠道 uid，避免改合併／解除合併（§6.4） |
| F11 | 收件匣訊息依 `createdAt` 排序；`Conversation.metadata` 是既有 JSON 欄位 | `conversation.service.ts`、schema | 「來自留言」的來源與補進對話的私訊不需要新欄位（§6.5） |
| F12 | UX 文件寫的 `channel.manage` 不存在；渠道權限是 `channel.view/create/update/delete/view_all/assign_team` | `packages/shared/src/rbac/permissions.ts` | 補訂閱留言改用 `channel.update`（§5） |
| F13 | `fix-meta-webhook-page-routing` change 尚未歸檔（8.x 送審、9.0c `appsecret_proof` 等任務未完成），它的 `meta-page-connect` delta 還不在主規格 | `openspec/changes/fix-meta-webhook-page-routing/` | 本 change 對 Meta 連結的 delta 要等它歸檔，或先寫在本 change 的新 capability（§10） |
| F14 | 平台設定已有通用 `GET/PUT /api/v1/platform/settings/:key`，寫入記 `setting.update` 稽核；有型別的鍵在路由內單獨驗證（例：合約提醒天數） | `platform.routes.ts`、`platform-setting.service.ts` | 「測試階段」旗標沿用這支 API，加型別驗證（§9） |

---

## 1. 元件與資料流

### 1.1 元件一覽

| 元件 | 行程 | 位置 | 職責 |
| ---- | ---- | ---- | ---- |
| Webhook 路由 | API | `webhook/webhook.routes.ts`（既有） | 回 200、背景呼叫處理函式 |
| 入站處理 | API | `webhook/webhook.service.ts`（既有，小改） | 驗簽 → `parseWebhook` ＋ `extensions.comments.parseCommentEvents` → 分派 → 留言交給 comment-reply |
| 留言收件 flow | API | `comment-reply/comment-reply-intake.flow.ts`（新） | feature 檢查、比對規則、寫紀錄（PENDING）＋outbox job，同一交易 |
| outbox relay | API | 既有 | commit 後快路徑送佇列；失敗由 relay 補送 |
| `comment-reply` 佇列消費者 | API | `comment-reply/comment-reply.worker.ts`（新） | 認領 → 檢查（7 天、規則、上限、去重）→ 呼叫 Meta → 寫結果 → 建／對聯絡人 → 公開回覆 |
| 渠道外掛 | API（與 workers 共用同一個實例） | `packages/channel-plugins` facebook／threads | 解析留言、私訊、公開回覆、列貼文、網址轉貼文 ID、查與補訂閱 |
| 入站關聯 | API | `webhook/inbound-comment-origin.ts`（新，薄轉接）→ `comment-reply-inbox.service.ts` | 顧客第一次回覆私訊時，把私訊補進對話、標記來源 |
| 後台 API | API | `comment-reply/*.routes.ts`（新，三支） | 規則、紀錄、渠道（前置條件、貼文代理、補訂閱） |
| 平台設定 | API | `platform/platform.routes.ts`（既有，加鍵驗證） | Meta 審核狀態旗標 |

### 1.2 主流程時序圖

```
 Meta              API: webhook.routes      API: webhook.service         API: comment-reply-intake.flow     Postgres            Redis/BullMQ        API: comment-reply.worker        Meta Graph
  │  POST /webhooks/meta│(或 /fb/:id、/threads/:id)                                                                                                                         │
  │────────────────────>│                                                                                                                                                 │
  │   200 EVENT_RECEIVED│                                                                                                                                                 │
  │<────────────────────│ processPlatformMetaWebhook()（不 await）                                                                                                        │
  │                     │──────────────────────>│ 1 驗簽（App Secret）                                                                                                    │
  │                     │                       │ 2 plugin.parseWebhook()           → 私訊事件（既有流程，不變）                                                          │
  │                     │                       │ 3 plugin.extensions.comments                                                                                          │
  │                     │                       │     .parseCommentEvents()          → ParsedCommentEvent[]（已排除自己帳號、非 add）                                     │
  │                     │                       │ 4 routeByAccount(prismaAdmin, …)   ── SELECT channels by (type, externalAccountId) ─>│                                   │
  │                     │                       │ 5 每個渠道群組：                                                                                                        │
  │                     │                       │──────────────────────────────>│ inTenant(fastify.prisma, tenantId)                                                     │
  │                     │                       │                               │ a 方案含 comment_reply？渠道啟用？ ─────────────>│                                     │
  │                     │                       │                               │ b 讀啟用中規則（依 priority）     ─────────────>│                                     │
  │                     │                       │                               │ c 純函式比對 → 沒命中：結束，不寫任何資料                                              │
  │                     │                       │                               │ d INSERT 紀錄 PENDING                                                                  │
  │                     │                       │                               │   ON CONFLICT (channelId, commentId) DO NOTHING ─>│ 沒插入＝Meta 重投，結束           │
  │                     │                       │                               │ e enqueueJob(scope, 'comment-reply', {tenantId, logId})                                 │
  │                     │                       │                               │   └ INSERT outbox（同一交易）  ───────────────>│                                     │
  │                     │                       │                               │ f 更新渠道 lastCommentEventAt（節流）                                                  │
  │                     │                       │                               │ COMMIT → afterCommit：outbox 快路徑 ─────────────────────────>│ add(job, jobId=outboxId) │
  │                     │                       │                                                                              │                  │                       │
  │                     │                       │                                                                              │                  │──── job ─────────────>│
  │                     │                       │                                                                              │   短交易 T1：認領     │                       │
  │                     │                       │                                                                              │<─ UPDATE PENDING→SENDING（條件更新）─│ │
  │                     │                       │                                                                              │   檢查：7 天、規則仍啟用、素材、        │
  │                     │                       │                                                                              │   feature、月上限、同人去重（唯一鍵）   │
  │                     │                       │                                                                              │   不送 → 終態（EXPIRED／SKIPPED…），結束│
  │                     │                       │                                                                              │                  │  交易外：渲染內容       │
  │                     │                       │                                                                              │                  │  sendPrivateReply() ──────────────────>│ POST /me/messages
  │                     │                       │                                                                              │                  │                       │ recipient:{comment_id}
  │                     │                       │                                                                              │                  │<──── {recipient_id, message_id} ───────│
  │                     │                       │                                                                              │   短交易 T2：寫結果   │                       │
  │                     │                       │                                                                              │<─ SENT＋recipientUid＋內容快照          │
  │                     │                       │                                                                              │<─ 建／對聯絡人與 ChannelIdentity(uid=recipient_id)
  │                     │                       │                                                                              │                  │  有設定公開回覆：       │
  │                     │                       │                                                                              │<─ T3 publicReply PENDING→SENDING        │
  │                     │                       │                                                                              │                  │  replyToComment() ────────────────────>│ POST /{comment}/comments（FB）
  │                     │                       │                                                                              │<─ T4 publicReply SENT／FAILED           │      /{comment}/replies（IG）
```

### 1.3 顧客回覆私訊（收件匣串接）時序圖

```
 Meta            webhook.service（既有私訊流程）                   comment-reply-inbox.service                 Postgres
  │ messages 事件（sender.id = PSID／IGSID）                                                                     │
  │──────────────>│ resolveInboundContact()                                                                       │
  │               │   └ ChannelIdentity(channelId, uid=PSID) 已存在（留言私訊時建的）→ 同一位聯絡人，不重建       │
  │               │ resolveInboundConversation() → 新對話                                                         │
  │               │ createInboundMessage()（顧客的回覆）                                                          │
  │               │ attachCommentOrigin(ctx) ─────────────────────>│ inTenant：                                    │
  │               │                                                │ 找 (channelId, recipientUid) 的 SENT 紀錄，    │
  │               │                                                │   conversationId 為空、近 30 天內，取最新一筆 │
  │               │                                                │ 條件更新紀錄 conversationId=…（IS NULL 才更新）─>│ 沒更新到＝別的請求已處理
  │               │                                                │ INSERT 系統訊息（createdAt = sentAt − 1ms）   │
  │               │                                                │ INSERT 外送訊息（私訊快照，createdAt = sentAt）│
  │               │                                                │ conversation.metadata.origin = {…}            │
  │               │<───────────────────────────────────────────────│                                               │
  │               │ emitInboundSocketEvents()…（既有，前端看到完整三則）                                             │
```

### 1.4 每一段用哪個 Prisma client

| 段落 | Client | 理由 |
| ---- | ---- | ---- |
| Webhook 驗簽、依 `entry.id` 找渠道 | `fastify.prismaAdmin` | 公開 webhook，還不知道租戶；要跨租戶以 `(channelType, externalAccountId)` 找渠道。`webhook.routes.ts` 已在 `check-prisma-admin-usage` 白名單 |
| 收件 flow（feature、規則、寫紀錄、outbox） | `inTenant(fastify.prisma, tenantId)` | 分派後租戶已知，寫入要受 RLS（第二層）。outbox 與紀錄同交易才不會「紀錄寫了 job 沒排」或反之 |
| outbox 快路徑／relay | 既有 `createOutboxPublisher(fastify.prisma)` | 不變 |
| 佇列消費者 | `inTenant(fastify.prisma, tenantId)`，每步一個短交易 | 與 coupon-broadcast 一致；Meta 呼叫在交易外（AGENTS 結構規則 2、tenant-ctx 規則） |
| 建立聯絡人與 ChannelIdentity | 同上（T2 交易內） | 與 SENT 狀態一起成功或一起失敗 |
| 入站關聯（顧客回覆時） | `inTenant(fastify.prisma, tenantId)` | 入站管線目前整條用 `prismaAdmin`（`webhook.service.ts` 的 `TODO(rls)`）；新程式不跟進，`processInboundMessage` 的 options 多帶 `tenantPrisma`（§3.6） |
| 後台路由 | flow ＋ `{ prisma: fastify.prisma }`，tenantId 取自 `request.agent` | 新程式慣例（routes 不開交易） |
| 補訂閱、前置條件查 Meta | 讀渠道憑證在 `inTenant` 內，呼叫 Meta 在交易外 | 同上 |
| 平台旗標寫入 | `fastify.prismaAdmin`（既有平台路由） | 平台層表格 |
| 平台旗標讀取（租戶前置條件 API、收件） | 租戶交易內讀 `platform_settings` | F9：app_tenant 有 SELECT |

---

## 2. 渠道外掛契約

### 2.1 放在哪裡：`extensions.comments`

沿用既有 `extensions.{ui,audience,analytics}` 的模式，新增一個選用擴充，不在 `ChannelPlugin` 介面頂層加五個方法：

- 能力判斷一律是 `plugin.extensions?.comments` 有沒有值（AGENTS 結構規則 5，不比對 channelType）。
- 渠道的差異（IG 只能文字、IG 沒有素材）以 `capabilities` 宣告，comment-reply 模組依宣告決定 UI 與驗證，不寫 `if (channelType === 'THREADS')`。
- LINE、WebChat、Telegram 不實作，前置條件 API 不列這些渠道。

### 2.2 型別（`packages/channel-plugins/src/index.ts`）

```ts
/** 一則新留言（外掛已排除：自己帳號的留言、非新增事件、直播留言） */
export interface ParsedCommentEvent {
  /** 事件所屬帳號（webhook entry.id：粉專 ID／IG 專業帳號 ID），分派渠道用 */
  accountId: string;
  commentId: string;
  /** FB：`{pageId}_{postId}`；IG：media id */
  postId: string;
  /** 對另一則留言的回覆時有值 */
  parentId?: string;
  /** 留言者在平台上的 ID。FB 不保證等於 PSID（見 §6.2），IG 文件載明是 IGSID */
  commenterId: string;
  commenterName?: string;      // FB from.name
  commenterUsername?: string;  // IG from.username
  text: string;
  /** 留言建立時間；平台沒有提供時用通知時間（IG，見 §8 第 7 點） */
  createdAt: Date;
  createdAtSource: 'comment' | 'notification';
  /** 廣告貼文的留言（IG media.ad_id；FB 文件未載明） */
  adId?: string;
  rawPayload?: unknown;
}

export interface CommentReplyCapabilities {
  /** 私訊可用的 contentType。IG：['text']；FB：文字、圖片、影片、按鈕／generic 等 Send API 支援的型態 */
  privateReplyContentTypes: readonly string[];
  /** 是否支援公開回覆留言 */
  publicReply: boolean;
  /** 素材庫的 channelType（FB：'fb'；IG：null＝沒有素材） */
  materialChannelType: string | null;
  /** 貼文挑選畫面的用詞與開啟連結的平台名稱，例如「在 Facebook 開啟」 */
  postLinkLabel: string;
}

export type MetaErrorInfo = {
  /** 原始錯誤（給「技術資訊」區） */
  code?: number; subcode?: number; message: string;
  /** 正規化後的原因代碼（§4.6 對照表） */
  reason: CommentReplyFailReason;
  /** 是否值得自動重試（網路、5xx、限流） */
  transient: boolean;
};

export type CommentSendResult =
  | { ok: true; recipientId: string; messageId: string }
  | { ok: false; error: MetaErrorInfo };

export interface RecentPost {
  postId: string; permalink: string | null; thumbnailUrl: string | null;
  excerpt: string; mediaType: 'text' | 'image' | 'carousel' | 'video' | 'reels';
  publishedAt: Date;
}

export interface CommentSubscriptionStatus {
  /** null＝無法查詢（文件未提供查詢方式） */
  subscribed: boolean | null;
  missingPermissions: string[];
  canPrivateReply: boolean;
  canPublicReply: boolean;
}

export interface ChannelCommentExtension {
  readonly capabilities: CommentReplyCapabilities;
  parseCommentEvents(rawBody: Buffer): ParsedCommentEvent[];
  sendPrivateReply(commentId: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<CommentSendResult>;
  replyToComment(commentId: string, text: string, credentials: Record<string, unknown>): Promise<{ ok: true; replyId: string } | { ok: false; error: MetaErrorInfo }>;
  listRecentPosts(credentials: Record<string, unknown>, cursor?: string): Promise<{ posts: RecentPost[]; nextCursor: string | null }>;
  /** 網址找不到時回 null（不丟錯） */
  resolvePostUrl(url: string, credentials: Record<string, unknown>): Promise<RecentPost | null>;
  getSubscriptionStatus(credentials: Record<string, unknown>, ctx: { accountId: string; appId?: string }): Promise<CommentSubscriptionStatus>;
  /** 補訂閱留言事件。fields 由呼叫端給完整清單（POST subscribed_apps 是否覆蓋既有欄位文件未載明，一律送完整清單） */
  subscribeCommentEvents(credentials: Record<string, unknown>, ctx: { accountId: string; fields: string[]; appSecret?: string }): Promise<void>;
}

// ChannelPlugin.extensions 加一個鍵
readonly extensions?: { ui?; audience?; analytics?; comments?: ChannelCommentExtension };
```

### 2.3 Facebook 實作（`facebook/index.ts`）

| 方法 | Meta 端點 | 重點 |
| ---- | ---- | ---- |
| `parseCommentEvents` | Page webhook `object=page`，`entry[].changes[]` | 只取 `field==='feed' && value.item==='comment' && value.verb==='add'`。**排除** `value.from.id === entry.id`（粉專自己的留言，含本功能的公開回覆，避免迴圈）。`created_time` 是 Unix 秒。`post_id`、`comment_id`、`parent_id`（`parent_id === post_id` 時視為第一層留言，不填 parentId）。`from` 缺少時（見 §8 第 8 點）整則略過並計數 |
| `sendPrivateReply` | `POST https://graph.facebook.com/v21.0/me/messages`，body `{ recipient: { comment_id }, message }` | 與 `sendMessage` 共用：把站內路徑換公開網址、`buildFbMessage()` 抽成私有 `postMessage(recipient, payload, credentials)`，`sendMessage` 改呼叫它（行為不變、既有測試要過）。回傳 `recipient_id`（PSID）與 `message_id`。不帶 `messaging_type`（私訊回覆不需要，文件範例未帶） |
| `replyToComment` | `POST /v21.0/{comment-id}/comments`，`message=…` | 需 `pages_manage_engagement` |
| `listRecentPosts` | `GET /v21.0/{page-id}/published_posts?fields=id,message,created_time,permalink_url,full_picture,attachments{media_type}&limit=25&after=` | 需 `pages_read_engagement`；廣告的未發布貼文不在清單 |
| `resolvePostUrl` | 先從網址解出數字 ID（`/posts/<id>`、`story_fbid=`、`fbid=`）→ `GET /{pageId}_{id}`；`pfbid…` 網址無法離線換算 → 掃最近 4 頁 `published_posts` 比對 `permalink_url` | 找不到回 null，路由轉成 `POST_NOT_FOUND` |
| `getSubscriptionStatus` | `GET /v21.0/{page-id}/subscribed_apps` 找自己的 App 是否含 `feed`；權限用 `GET /debug_token?input_token=<page token>`（App token＝`appId|appSecret`）讀 `scopes` | 平台模式用平台 App 憑證；自備 App 用渠道憑證的 `appId/appSecret`。查不到時 `subscribed: null` |
| `subscribeCommentEvents` | `POST /v21.0/{page-id}/subscribed_apps`，`subscribed_fields=<完整清單>`，`appsecret_proof` | 抽出 `meta-connect.service.ts` 的 `subscribePage()` 共用同一個實作（見 §7.2），不另寫第二份 |

`capabilities`：`privateReplyContentTypes` 列 `buildFbMessage()` 支援的 FB 型態（`fb_text`、`fb_image`、`fb_video`、`fb_button`、`fb_generic`、`fb_media`、`text`、`image`、`video`、`file`）；`fb_receipt`、`fb_coupon`、`fb_feedback` 第一版排除（文件說所有 Send API 型態都可用，但這三種是交易／回饋用途，未實測不開放）。

### 2.4 Instagram 實作（`threads.ts`）

| 方法 | Meta 端點（Instagram Login） | 重點 |
| ---- | ---- | ---- |
| `parseCommentEvents` | `object=instagram`，`entry[].changes[]` 中 `field==='comments'` | `value.id`＝留言 ID、`value.text`、`value.from.{id,username}`、`value.media.{id,media_product_type,ad_id}`、`value.parent_id`。**排除** `from.id === entry.id` 或帶 `from.self_ig_scoped_id`（自己帳號的留言，Self Messaging 文件載明）。`live_comments` 不處理。沒有留言時間 → 用 `entry.time`，`createdAtSource='notification'` |
| `sendPrivateReply` | `POST https://graph.instagram.com/v21.0/me/messages`，`{ recipient: { comment_id }, message: { text } }` | 只送文字；非 text 的 payload 直接回 `MATERIAL_UNSUPPORTED`（不呼叫 Meta）。回傳 `recipient_id`（IGSID） |
| `replyToComment` | `POST /v21.0/{ig-comment-id}/replies`，`message=…` | 需 `instagram_business_manage_comments` |
| `listRecentPosts` | `GET /v21.0/me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp&limit=25&after=` | `media_product_type=REELS` 對應 `reels` |
| `resolvePostUrl` | 從網址取 shortcode（`/p/<code>`、`/reel/<code>`）→ 掃最近 4 頁 media 比對 `permalink` | shortcode 不能換算成 media id |
| `getSubscriptionStatus` | `GET /v21.0/me/subscribed_apps`（文件未載明 Instagram Login 是否提供 GET，需實測；不提供時 `subscribed: null`，改看 `lastCommentEventAt`） | 權限：Instagram 權杖沒有 debug_token，以 `missingPermissions: []`、`canPublicReply` 依實際呼叫錯誤推斷 |
| `subscribeCommentEvents` | `POST /v21.0/me/subscribed_apps?subscribed_fields=messages,comments`（＋既有在用的欄位） | App 後台的 Instagram webhook 也要勾 `comments`（租戶自備 App 時由租戶自己做） |

`capabilities`：`privateReplyContentTypes: ['text']`、`publicReply: true`、`materialChannelType: null`。

### 2.5 兩邊 registry

- API：`apps/api/src/index.ts` 的 `registerChannelPlugin(fbPlugin|threadsPlugin)` 不用改，擴充掛在同一個實例上。
- workers：`createWorkerPluginRegistry()` 註冊的也是同一個 `fbPlugin`、`threadsPlugin` 實例。本功能的消費者在 API 行程，workers 不呼叫留言方法；但仍加一個單元測試斷言兩邊 registry 的 FB／IG 外掛都有 `extensions.comments`，避免日後有人把 workers 改成另建實例而漏掉。
- `docs/ref/modules/CHANNEL-PLUGINS.md` 補「留言擴充」一節（AGENTS Step 4 文件同步）。

### 2.6 外掛的錯誤正規化

外掛把 Meta 錯誤轉成 `MetaErrorInfo`，comment-reply 模組只看 `reason`／`transient`，不解析 Meta 錯誤碼。對照表見 §4.6。這樣 FB／IG 錯誤碼差異留在外掛內（結構規則 5）。

---

## 3. 模組切分：`apps/api/src/modules/comment-reply/`

### 3.1 檔案

| 檔案 | 角色 |
| ---- | ---- |
| `comment-reply-rule.service.ts` | 規則 CRUD、排序、上限檢查、驗證（TenantCtx） |
| `comment-reply-log.service.ts` | 紀錄查詢、摘要、詳情、重試的狀態轉換（TenantCtx） |
| `comment-reply-intake.service.ts` | 收件：feature／規則讀取、寫 PENDING 紀錄（TenantCtx） |
| `comment-reply-delivery.service.ts` | 消費者每一步的資料操作：認領、終態、寫 SENT、去重鍵、上限計數（TenantCtx） |
| `comment-reply-contact.service.ts` | 依 recipient uid 找或建聯絡人與 ChannelIdentity（TenantCtx） |
| `comment-reply-inbox.service.ts` | 顧客回覆時的關聯：找未關聯的 SENT 紀錄、補訊息、寫 origin（TenantCtx） |
| `comment-reply-match.ts` | 純函式：`matchCommentRule(rules, event)`、正規化 |
| `comment-reply-content.ts` | 純函式＋素材讀取：把規則內容渲染成 `OutboundPayload` |
| `comment-reply-entitlement.ts` | 方案 feature、上限、平台旗標的讀取（TenantCtx） |
| `comment-reply.flow.ts` | 路由用的 flow（含 outbox、稽核、Meta 呼叫在交易外） |
| `comment-reply-intake.flow.ts` | webhook 呼叫的收件 flow |
| `comment-reply-delivery.flow.ts` | 消費者主流程（步驟編排、交易邊界） |
| `comment-reply.worker.ts` | BullMQ processor（只解析 job data、呼叫 delivery flow） |
| `comment-reply-rule.routes.ts`、`comment-reply-log.routes.ts`、`comment-reply-channel.routes.ts` | 三個資源各一支（結構規則 3，合計約 17 支路由） |
| `comment-reply.schemas.ts` | Zod schema 與錯誤代碼常數（前後端共用代碼另放 `packages/shared`，§5.6） |
| `comment-reply.types.ts` | 狀態、原因代碼列舉 |

webhook 模組新增 `inbound-comment-origin.ts`（薄轉接，呼叫 `comment-reply-inbox.service.ts`），以及在 `webhook.service.ts` 加留言分支。跨模組只呼叫 service（結構規則 4）。

### 3.2 主要函式簽章

```ts
// comment-reply-match.ts（純函式，前端試算與收件共用同一支）
export interface MatchableRule { id: string; keywords: string[]; matchMode: 'any' | 'all'; postIds: string[]; priority: number; isActive: boolean }
export function normalizeForMatch(text: string): string;            // NFKC + toLowerCase
export function matchCommentRule<R extends MatchableRule>(rules: R[], event: { postId: string; text: string }):
  { rule: R; matchedKeywords: string[] } | null;                    // 依 priority 升冪，第一條命中者勝

// comment-reply-intake.service.ts
export async function loadIntakeContext(ctx: TenantCtx, channelId: string):
  Promise<{ enabled: false; reason: 'FEATURE_DISABLED' | 'CHANNEL_INACTIVE' } | { enabled: true; rules: IntakeRule[] }>;
export async function insertPendingLog(ctx: TenantCtx, input: PendingLogInput): Promise<{ id: string } | null>; // null＝重投
export async function touchLastCommentEvent(ctx: TenantCtx, channelId: string, at: Date): Promise<void>;        // 節流

// comment-reply-intake.flow.ts
export async function intakeCommentEvents(
  deps: { prisma: PrismaClient; events?: EventPublisher },
  channel: { id: string; tenantId: string; channelType: string },
  events: ParsedCommentEvent[],
): Promise<{ enqueued: number; unmatched: number; duplicates: number }>;

// comment-reply-delivery.service.ts
export async function claimForSending(ctx: TenantCtx, logId: string, now: Date): Promise<ClaimResult>;
//  ClaimResult = { kind:'proceed', log, rule, channel } | { kind:'final', status, reason } | { kind:'wait', delayMs } | { kind:'gone' }
export async function markSent(ctx: TenantCtx, logId: string, r: { recipientUid: string; messageId: string; snapshot: unknown; at: Date }): Promise<void>;
export async function markFailed(ctx: TenantCtx, logId: string, e: MetaErrorInfo, at: Date): Promise<void>;
export async function claimPublicReply(ctx: TenantCtx, logId: string): Promise<{ text: string } | null>;
export async function markPublicReply(ctx: TenantCtx, logId: string, r: { ok: boolean; replyId?: string; error?: MetaErrorInfo }): Promise<void>;

// comment-reply-contact.service.ts
export async function ensureContactForRecipient(ctx: TenantCtx, input: {
  channel: { id: string; channelType: string }; uid: string; displayName: string;
}): Promise<{ contactId: string; channelIdentityId: string; created: boolean }>;

// comment-reply-delivery.flow.ts
export async function deliverCommentReply(deps: DeliveryDeps, tenantId: string, logId: string): Promise<DeliveryOutcome>;
// DeliveryDeps = { prisma: PrismaClient; plugins: (type: string) => ChannelPlugin | undefined; rateGate: RateGate; now?: () => Date }

// comment-reply-inbox.service.ts
export async function attachCommentOrigin(ctx: TenantCtx, input: {
  channelId: string; uid: string; conversationId: string; firstInboundAt: Date;
}): Promise<{ attached: boolean; logId?: string }>;

// comment-reply-rule.service.ts
export async function listRules(ctx: TenantCtx, viewer: RuleViewer, filter: { channelId?: string }): Promise<RuleView[]>;
export async function createRule(ctx: TenantCtx, viewer: RuleViewer, input: RuleInput): Promise<RuleView>;
export async function updateRule(ctx: TenantCtx, viewer: RuleViewer, id: string, input: RulePatch): Promise<RuleView>;
export async function setRuleActive(ctx: TenantCtx, viewer: RuleViewer, id: string, isActive: boolean): Promise<RuleView>;
export async function reorderRules(ctx: TenantCtx, viewer: RuleViewer, ids: string[]): Promise<void>;
export async function deleteRule(ctx: TenantCtx, viewer: RuleViewer, id: string): Promise<void>;
export async function testRules(ctx: TenantCtx, viewer: RuleViewer, input: { channelId: string; postId?: string; text: string }): Promise<TestResult>;
// RuleViewer = { accessible: AccessibleChannels; canManage: boolean; levelOf(channelId): ChannelAccessLevel }
```

### 3.3 共用的既有程式（不重寫）

| 需要 | 沿用 |
| ---- | ---- |
| 依 `entry.id` 分派、同 App 檢查、停用渠道 | `webhook-account-routing.ts`（改泛型，§0 F3） |
| outbox 排入、relay | `enqueueJob()`、`createOutboxPublisher()` |
| 交易邊界 | `inTenant()`、`flowOf()`、`TenantCtx` |
| 渠道憑證解密 | `decryptCredentials()`（`channel.service.ts`） |
| 渠道可見範圍與存取層級 | `getAccessibleChannelIds()`、`resolveChannelAccessLevel()`、`channelIdWhere()`（`services/channel-visibility.ts`） |
| 素材變數與渲染 | API 端 `template-renderer.ts` 的 `renderTemplateBody()`、`buildVariableMap()`、`bodyHasCouponUrl()`；未解析的佔位字串處理比照 workers 的 `stripUnresolvedPlaceholders()`（API 端若無同等函式，把 workers 那支搬到 `packages/core` 共用，不複製） |
| 顧客券連結擋下 | 規則存檔時 `bodyHasCouponUrl()` → `COUPON_URL_IN_RULE_MESSAGE`（與關鍵字回覆同代碼） |
| 站內路徑轉公開網址 | FB 外掛既有 `findSitePathUrl()`／`resolveSitePathUrls()`（在 `postMessage` 內共用） |
| 方案上限解析 | `getEffectiveLimit()`（`plan-limits.service.ts`，擴充 `LimitKey`） |
| 台灣月份切點 | `taipeiMonthStart()`、`taipeiNextMonthStart()`（`@open333crm/core`） |
| UID 拼接（IdentityMap） | `resolveUidToContact()`（`@open333crm/core`）、`recordStitchedIdentity()` |
| 錯誤 | `AppError(message, code, statusCode, details)` |
| 粉專訂閱 | `meta-connect.service.ts` 的 `subscribePage()`（抽成可傳欄位清單的版本） |

### 3.4 關鍵字比對的共用

`matchKeywordTrigger()` 是 automation-engine 主規格「關鍵字的比對結果一致」的對象，行為不能改。做法：

1. 在 `packages/automation/src/keyword/keyword-match.ts` 抽出核心 `matchKeywords(keywords, matchMode, text, { normalize })`。
2. `matchKeywordTrigger()` 改呼叫 `matchKeywords(..., { normalize: 'lowercase' })`，結果不變（既有測試要過，屬於重構）。
3. 留言比對呼叫 `matchKeywords(..., { normalize: 'nfkc' })`：NFKC＋小寫，`＋１` 與 `+1` 相同。UX §3.3(3) 的「不分全形半形」因此成立。
4. 關鍵字回覆要不要也改 NFKC，另開 change（會改既有主規格）；列在「需要使用者決定」。

### 3.5 規則內容渲染（`comment-reply-content.ts`）

- 文字：`{ contentType: 'text', content: { text } }`；FB 外掛把 `text` 映成 Messenger 文字。
- 素材：讀 `Material`（`tenantId`、`isActive`、`channelType === capabilities.materialChannelType`），`contentType` 必須在 `capabilities.privateReplyContentTypes` 內，否則 `MATERIAL_UNSUPPORTED`。
- 變數：送出時通常沒有聯絡人。只代入 `material.variables` 的預設值與 `{ commenter.name }`（新增唯一一個留言專屬變數，值為留言者名稱），其餘留空。
- 寫 SENT 時把渲染後的 payload 存成快照（UX §4.5 第 4 點、收件匣補訊息都用它）。

### 3.6 webhook 模組的改動（最小）

```ts
// webhook.service.ts
export interface WebhookDeps { prismaAdmin: PrismaClient; prisma: PrismaClient; io: SocketIOServer }

// processWebhookEvent／processPlatformMetaWebhook 在既有 parseWebhook 之後：
const comments = plugin.extensions?.comments?.parseCommentEvents(rawBody) ?? [];
if (comments.length) {
  const groups = await routeByAccount(prismaAdmin, …, comments);   // 與訊息同一套分派
  for (const g of groups) await intakeCommentEvents({ prisma: deps.prisma }, g.channel, g.messages);
}
```

- 留言收件放在私訊處理**之前**或之後都可，兩者互不相依；放在之後，避免收件失敗影響私訊。收件丟錯只在該渠道記警示（`recordRoutingWarning` 新增原因 `comment_intake_failed`）並 log，不丟出（私訊已處理完）。
- 下游轉發 `immediate` 模式短路時，留言也不處理（與私訊一致：下游接手）。寫進 `CHANNEL-PLUGINS.md`。
- `processInboundMessage()` 的 options 多帶 `tenantPrisma`，在 `createInboundMessage()` 成功之後、`emitInboundSocketEvents()` 之前呼叫 `attachCommentOrigin`（§6.5）。只有 `plugin.extensions?.comments` 存在的渠道才呼叫，失敗只記 log＋不影響訊息落地（沿用 inbound-contact-resolution「解析失敗不得靜默丟棄訊息」的精神：顧客訊息一定落地）。

---

## 4. 佇列與冪等

### 4.1 新佇列 `comment-reply`（API 行程消費），由 outbox 排入

| 選項 | 取捨 |
| ---- | ---- |
| A. 新佇列，outbox 排入，API 行程消費（**建議**） | 與 coupon-broadcast 同模式；紀錄與 job 同交易；`inTenant()`＋TenantCtx；`fastify.prisma` 受 RLS；可直接用 API 端素材渲染與聯絡人 service；webhook 流量尖峰不會卡在 webhook 處理 |
| B. 新佇列，workers 行程消費（00 號規劃） | workers 只有 BYPASSRLS 連線，新程式只剩第一層隔離；聯絡人建立、素材渲染、可見範圍要在 workers 再寫或搬到 packages |
| C. 不用佇列，webhook 背景直接送 | 違反 Path B（失敗無重試、Meta 限流時無法延後）；webhook 處理時間被 Meta 呼叫拖長 |
| D. 走 event 訂閱（`publishEvent` → event-automation） | 留言不是領域事件，訂閱者只有一個；用 job 比較直接 |

- 佇列名：`COMMENT_REPLY_QUEUE = 'comment-reply'`，常數放 `comment-reply.types.ts`，加進 `monitored-queues.ts` 的 `API_QUEUES`（會一併進 `ALERTED_QUEUES`，failed job 發維運告警）。
- 併發：`concurrency: 5`（`subscriber-workers.ts` 的 `WORKER_CONCURRENCY` 慣例）。限流靠 §4.5 的渠道閘門，不靠 BullMQ 全域 limiter。
- job data：`{ tenantId, logId }`；job 名稱 `deliver`；job id＝outbox id（outbox 強制，不能自訂）。
- job options（outbox 白名單內）：`attempts: 5`、`backoff: { type: 'exponential', delay: 10_000 }`、`removeOnComplete: { age: 86_400 }`、`removeOnFail: { age: 604_800 }`。

### 4.2 冪等的三層

| 層 | 擋什麼 | 做法 |
| ---- | ---- | ---- |
| 1. 收件唯一鍵 | Meta 重投 webhook（最長 36 小時）、IG 廣告貼文重複通知、平台與渠道網址兩條路同時進來 | 紀錄唯一鍵 `(channelId, commentId)`，`INSERT … ON CONFLICT DO NOTHING`；沒插入就不排 job。重投不產生第二筆紀錄（UX §4.2 說明） |
| 2. 狀態機條件更新 | 同一個 job 被重送、outbox relay 與快路徑重複送（job id 相同 BullMQ 已擋，但保留 24 小時後可能再進） | 送出前 `UPDATE … SET status='SENDING' WHERE id=? AND status='PENDING'`，更新 0 列就結束 |
| 3. Meta 本身 | 系統當機在「Meta 成功、DB 未寫」之間 | Meta 每則留言只允許一次私訊；重試時若 Meta 回「已私訊過」，視為已送出（§4.3 SENDING 復原） |

### 4.3 狀態機

主狀態（`status`）：

```
           收件寫入
              │
              ▼
          ┌────────┐  認領（條件更新）    ┌─────────┐  Meta 成功   ┌──────┐
          │PENDING │────────────────────>│ SENDING │────────────>│ SENT │
          └────────┘                     └─────────┘             └──────┘
           │  │  │                         │      │
           │  │  └─> EXPIRED              │      └─ Meta 失敗且不可重試／重試用盡 ─> FAILED
           │  └────> SKIPPED（reason）     │
           └───────> SKIPPED_DUPLICATE     └─ 可重試錯誤：退回 PENDING，丟錯讓 BullMQ 重試
                                                                          │
   FAILED（retryable 且未滿 7 天）── 後台「重試」（manage）─────────────────┘ → PENDING（新 outbox job）
   SKIPPED（reason=PLAN_LIMIT_REACHED 且未滿 7 天）── 後台「重試」 ──────────→ PENDING
```

- 終態：`SENT`、`FAILED`、`EXPIRED`、`SKIPPED`、`SKIPPED_DUPLICATE`。
- `SKIPPED` 的 `reasonCode`：`RULE_INACTIVE`（處理前被停用或刪除）、`MATERIAL_UNAVAILABLE`、`MATERIAL_UNSUPPORTED`、`FEATURE_DISABLED`、`PLAN_LIMIT_REACHED`、`CHANNEL_INACTIVE`、`TENANT_DISABLED`。
- **SENDING 復原**：認領時遇到 `SENDING` 且 `sendingAt` 超過 2 分鐘（程式在送出途中結束），改走「再送一次」：Meta 回 `ALREADY_REPLIED` → 記 `SENT`，`recipientUid` 留空、`reasonCode='SENT_UNCONFIRMED'`（後台顯示「可能已送達」）；Meta 成功 → 正常 `SENT`。不會造成重複私訊，因為 Meta 每則留言只允許一次。
- 公開回覆子狀態（`publicReplyStatus`）：`NOT_CONFIGURED`、`PENDING`、`SENDING`、`SENT`、`FAILED`、`SKIPPED`（私訊沒送出就不公開回覆，UX §3.3(8)）。公開回覆**不冪等**（Meta 允許同一則留言多則回覆），所以 `SENDING` 中斷時不重送，記 `FAILED`／`reasonCode='UNKNOWN_AFTER_CRASH'`。公開回覆失敗不改主狀態。

### 4.4 消費者步驟（`deliverCommentReply`）與上限檢查點

```
T1 inTenant（短交易）
  1 讀紀錄；不是 PENDING／逾時 SENDING → 結束（gone）
  2 租戶停用 → SKIPPED/TENANT_DISABLED
  3 方案不含 comment_reply → SKIPPED/FEATURE_DISABLED
  4 渠道停用或沒有 comments 擴充 → SKIPPED/CHANNEL_INACTIVE
  5 now − comment.createdAt ≥ 7 天 − 10 分鐘（安全邊際）→ EXPIRED
  6 規則已刪除或停用 → SKIPPED/RULE_INACTIVE
  7 素材停用／型態不支援 → SKIPPED/MATERIAL_*
  8 月上限：pg_advisory_xact_lock(hashtext('comment-reply-quota:'||tenantId))
      count(本台灣月 SENT＋SENDING) ≥ monthlyCommentReplies → SKIPPED/PLAN_LIMIT_REACHED
  9 同人去重（規則開啟時）：設定去重鍵（§4.7）
      唯一衝突：持有者 SENT → SKIPPED_DUPLICATE（記下持有者 logId）
                持有者 SENDING/PENDING → wait（job 延後 30 秒重試，不寫終態）
 10 UPDATE PENDING→SENDING、sendingAt=now
交易外
 11 渠道限流閘門（§4.5）：額度不足 → 退回 PENDING、job 延後到下一個時段
 12 渲染內容 → extensions.comments.sendPrivateReply()
T2 inTenant
 13 成功：markSent（recipientUid、messageId、快照）＋ensureContactForRecipient()
     失敗：transient 且 attemptsMade < attempts−1 → 退回 PENDING、釋放去重鍵、丟錯（BullMQ 重試）
           否則 → FAILED（reasonCode、metaErrorCode/subcode、原始訊息前 200 字）、釋放去重鍵
交易外
 14 有公開回覆 → T3 claimPublicReply → replyToComment() → T4 markPublicReply
```

上限檢查點彙整：

| 上限鍵 | 意義 | 檢查點 | 超過時 |
| ---- | ---- | ---- | ---- |
| `maxCommentReplyRules` | 啟用中的規則數（全租戶） | `createRule`（新建且 isActive）、`setRuleActive(true)`、`updateRule` 若把停用改啟用 | 403 `PLAN_LIMIT_EXCEEDED`，`details: { limitKey, current, max }`（與 maxAgents 相同格式） |
| 〃 降級後 | 方案調降，啟用中規則超過新上限 | 收件時只取依 priority 排序的前 N 條啟用規則；其餘在列表 `warnings` 帶 `OVER_PLAN_LIMIT` | 規則保留、不自動停用 |
| `monthlyCommentReplies` | 本台灣月份私訊送出數（SENT＋SENDING） | 消費者步驟 8（advisory lock 內計數） | `SKIPPED`／`PLAN_LIMIT_REACHED`，`retryable=true`（升級或下個月、未滿 7 天可手動重試）；前置條件 API 回 `quota`，頁面顯示「本月私訊數已達上限」卡片（失敗要看得見，不只寫 log） |

收件階段不檢查月上限：收件只寫紀錄，量由命中規則的留言決定；在消費者檢查才能與實際送出數一致。

### 4.5 Meta 限流

- 文件：FB Private Replies 每粉專 750 次／小時（有商店或近 28 天直播留言 ≥ 2,000 則時 30,000）；IG 貼文／Reels 750 次／小時／帳號。
- 閘門：Redis 固定窗計數 `comment-reply:rate:{channelId}:{yyyyMMddHH}`，上限預設 700（留 50 給客服在 Meta Business Suite 手動私訊），`INCR` 超過就把 job 延後到下一個整點＋隨機 0～60 秒。7 天期限足夠消化尖峰。
- Meta 回限流錯誤（code 4、17、32、613）仍視為 transient，退避重試；重試用盡記 `FAILED/RATE_LIMITED`（UX 的「重試」按鈕可用）。
- 上限值做成環境變數（SRE 調整），不進方案。

### 4.6 Meta 錯誤對照（外掛內正規化）

| reason | 來源判斷 | transient | 後台可重試 |
| ---- | ---- | ---- | ---- |
| `TOKEN_EXPIRED` | code 190 | 否 | 是（重新連結後） |
| `PERMISSION_MISSING` | code 10、200～299 | 否 | 是（重新連結後） |
| `APP_NOT_APPROVED` | 權限類錯誤，且平台旗標為 standard（判斷在 comment-reply 模組，外掛只回 PERMISSION_MISSING＋原始碼） | 否 | 否 |
| `USER_UNAVAILABLE` | code 551 | 否 | 否 |
| `COMMENT_NOT_FOUND` | code 100＋subcode 33（物件不存在） | 否 | 否 |
| `ALREADY_REPLIED` | 文件未載明錯誤碼；社群經驗為 10900（"Activity already replied to"），**需實測** | 否 | 否 |
| `EXPIRED_BY_META` | 文件未載明；社群經驗為 10903（超過回覆期限），**需實測** | 否 | 否 |
| `RATE_LIMITED` | code 4、17、32、613 | 是 | 是 |
| `MATERIAL_UNSUPPORTED` | 外掛在送出前判斷；或 code 100 且訊息指出 message 參數 | 否 | 否 |
| `NETWORK` | fetch 丟錯、HTTP 5xx | 是 | 是 |
| `UNKNOWN` | 其他 | 否 | 是 |

上線前用 App 有角色的帳號逐一觸發，把實際 code/subcode 補進外掛測試的 fixture。

### 4.7 「同一位留言者只私訊一次」

- 範圍：同一條規則內（UX §3.3(7)）。
- 去重鍵：`(ruleId, commenterId)`，只在紀錄狀態為 `SENDING` 或 `SENT` 時持有。DB 以部分唯一索引實作（`WHERE dedupe_held`），去重旗標在步驟 9 設定、FAILED 或退回 PENDING 時清除。欄位與索引寫法交給 SRE。
- 為什麼不在收件時判斷：收件當下不知道前一則會不會送成功；前一則失敗（顧客封鎖）時，後一則應該仍可嘗試。
- FB 的 `commenterId` 是 feed 的 `from.id`（是否與 PSID 相同文件未載明，但同一粉專下對同一人是否穩定也未載明，**需實測**）；IG 是 IGSID。去重不依賴 PSID，所以兩者不同也成立。
- 規則改了貼文範圍或關鍵字後，去重仍以 ruleId 為準（規則被刪掉再建是新規則，會重新私訊；UX 列表說明可提示）。

### 4.8 並行與順序

- 同一則留言只會有一筆紀錄、一個有效 job（§4.2）。
- 同一人兩則留言同時處理：去重鍵唯一索引保證只有一筆進入 SENDING；另一筆 wait 後再判斷。
- 同一聯絡人同時被兩筆 SENT 建立：`ensureContactForRecipient` 以 `ChannelIdentity @@unique([channelId, uid])` 擋，P2002 時改讀對方建立的（比照 `resolveInboundContact` 的處理，回收孤兒聯絡人）。
- 顧客回覆私訊的 webhook 比 T2 先到（Meta 很快、我們的 T2 還沒 commit）：入站流程照常建聯絡人（uid＝PSID）；T2 的 `ensureContactForRecipient` 撞 P2002 → 用既有身分。`attachCommentOrigin` 在入站時找不到 SENT 紀錄（還沒 commit）→ 不關聯；補救：`markSent` 之後若該 identity 已有對話且 `firstInboundAt > sentAt`，在 T2 後呼叫一次 `attachCommentOrigin`。兩條路都用「`conversationId IS NULL` 才更新」的條件更新，只會關聯一次。

---

## 5. API

前綴 `/api/v1/comment-replies`。全部 `fastify.authenticate`＋`requirePermission()`；清單一律由後端依渠道可見範圍過濾；看不到的資源回 404（不洩漏存在）。錯誤用 `AppError`，`code` 是封閉列舉。

### 5.1 規則（`comment-reply-rule.routes.ts`）

| 方法與路徑 | 權限 | Zod 輸入 | 回應 | 錯誤碼 |
| ---- | ---- | ---- | ---- | ---- |
| `GET /rules` | `comment_reply.view` | query `{ channelId?: uuid }` | `RuleView[]`（欄位依 UX §11.1：`id,name,channelId,channel{id,channelType,displayName,accountId},keywords,matchMode,postScope,posts[],content{type,materialId,materialName,materialStatus,text},dedupePerCommenter,publicReply{enabled,texts[]},isActive,priority,canEdit,stats7d{sent,failed,expired,duplicate},warnings[]`） | — |
| `GET /rules/:id` | view | params `{ id: uuid }` | `RuleView` | `RULE_NOT_FOUND` 404 |
| `POST /rules` | `comment_reply.manage` | body `RuleInput`（下表） | `RuleView` 201 | `VALIDATION_ERROR` 400（`details.field`）、`CHANNEL_NOT_SUPPORTED` 400、`CHANNEL_ACCESS_DENIED` 403、`MATERIAL_NOT_FOUND` 400、`MATERIAL_UNSUPPORTED` 400、`COUPON_URL_IN_RULE_MESSAGE` 400、`PLAN_LIMIT_EXCEEDED` 403 |
| `PATCH /rules/:id` | manage | body `RulePatch`（`RuleInput` 去掉 `channelId`，全部選填；帶 `channelId` 回 400 `CHANNEL_IMMUTABLE`） | `RuleView` | 同上＋`RULE_NOT_FOUND` |
| `PATCH /rules/:id/active` | manage | body `{ isActive: boolean }` | `RuleView` | `RULE_NOT_FOUND`、`CHANNEL_ACCESS_DENIED`、`PLAN_LIMIT_EXCEEDED` |
| `PUT /rules/order` | manage | body `{ ids: uuid[] (1..500, 不重複) }` | `{ ok: true }` | `RULE_ORDER_MISMATCH` 409（ids 與可見且可編輯的規則集合不一致，避免覆蓋別人的新規則） |
| `DELETE /rules/:id` | manage | params | 204 | `RULE_NOT_FOUND`、`CHANNEL_ACCESS_DENIED` |
| `POST /rules/test` | view | body `{ channelId: uuid, postId?: string(≤128), text: string(1..2000) }` | `{ matched: true, ruleId, ruleName, matchedKeywords[] } \| { matched: false }` | `CHANNEL_NOT_FOUND` 404 |

`RuleInput`：

```ts
z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(20)
    .refine(uniqueAfterNormalize, '關鍵字重複'),
  matchMode: z.enum(['any', 'all']).default('any'),
  postScope: z.enum(['all', 'selected']),
  posts: z.array(z.object({                       // 快照只做顯示，比對只用 postId
    postId: z.string().min(1).max(128),
    permalink: z.string().url().nullable(),
    thumbnailUrl: z.string().url().nullable(),
    excerpt: z.string().max(200),
    publishedAt: z.coerce.date().nullable(),
  })).max(50).default([]),                        // postScope=selected 時 1..50（superRefine）
  content: z.discriminatedUnion('type', [
    z.object({ type: z.literal('material'), materialId: z.string().uuid() }),
    z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(1000) }),
  ]),
  dedupePerCommenter: z.boolean().default(true),
  publicReply: z.object({
    enabled: z.boolean().default(false),
    texts: z.array(z.string().trim().min(1).max(300)).max(5).default([]),  // enabled 時 1..5
  }).default({ enabled: false, texts: [] }),
  isActive: z.boolean().default(true),
})
```

後端驗證（不只靠前端）：渠道必須可見且存取層級 `full`、啟用中、外掛有 `extensions.comments`；素材型態用 `capabilities` 判斷；`capabilities.materialChannelType === null` 時不得選素材；`publicReply.enabled` 但 `capabilities.publicReply=false` 回 400。日期一律 `z.coerce.date()`（記憶規則）。

`canEdit`＝有 manage 且該渠道存取層級 `full`。`warnings`：`CHANNEL_NOT_SUBSCRIBED`、`MATERIAL_INACTIVE`、`PUBLIC_REPLY_PERMISSION_MISSING`、`OVER_PLAN_LIMIT`、`FEATURE_DISABLED`。`stats7d` 一次 groupBy 查完（不逐條查）。

### 5.2 紀錄（`comment-reply-log.routes.ts`）

| 方法與路徑 | 權限 | Zod 輸入 | 回應 | 錯誤碼 |
| ---- | ---- | ---- | ---- | ---- |
| `GET /logs` | view | query `{ status?: Status[]（逗號分隔）, channelId?, ruleId?, from?: z.coerce.date(), to?: z.coerce.date(), q?: string(≤100), cursor?: string, limit?: 1..100 (預設 50), since?: z.coerce.date(), countOnly?: boolean }` | `{ items: LogListItem[], nextCursor }`；`countOnly=true` 時 `{ count }`（UX「有 N 筆新紀錄」） | `VALIDATION_ERROR` |
| `GET /logs/summary` | view | 同篩選（不含 cursor） | `{ SENT, FAILED, EXPIRED, SKIPPED, SKIPPED_DUPLICATE, PENDING, failed24h }` | — |
| `GET /logs/:id` | view | params | `LogDetail`（UX §11.3：含 `sentContentSnapshot`、`publicReplyText`、`publicReplyReasonCode`、`metaErrorCode`、`metaErrorSubcode`、`commentPermalink`、`conversationId`、`customerRepliedAt`、`retryable`） | `LOG_NOT_FOUND` 404 |
| `POST /logs/:id/retry` | manage | params | `{ status: 'PENDING' }` 202 | `LOG_NOT_FOUND`、`RETRY_NOT_ALLOWED` 409（`details.reason`：`NOT_RETRYABLE`／`EXPIRED`／`NOT_FAILED`）、`CHANNEL_ACCESS_DENIED` |
| `GET /logs/export` | view | 同篩選 | CSV（第二版，待使用者決定；做的話要寫租戶稽核，因為含留言者名稱） | — |

- `cursor`＝`(commentCreatedAt, id)` 的不透明編碼（排序穩定）。
- `q`：留言者名稱或留言內容的部分比對（需要 trigram 類索引，SRE）。
- `conversationId` 只在檢視者有 `inbox.view` 且看得到該渠道時回傳；否則回 `customerReplied: true` 不帶 id（UX §4.5 第 6 點）。
- 重試 flow：條件更新 `FAILED|SKIPPED(PLAN_LIMIT_REACHED) → PENDING`（`retryable` 為真、`now − commentCreatedAt < 7 天`），`attemptCount+1`，`enqueueJob()` 同交易；寫租戶稽核 `comment_reply.retry`（不含 PII）。

### 5.3 渠道（`comment-reply-channel.routes.ts`）

| 方法與路徑 | 權限 | Zod 輸入 | 回應 | 錯誤碼 |
| ---- | ---- | ---- | ---- | ---- |
| `GET /readiness` | view | — | `{ metaAccessLevel: { fb: 'standard'\|'advanced', ig: 'standard'\|'advanced' }, quota: { monthlyUsed, monthlyLimit, activeRules, maxRules }, channels: [{ channelId, channelType, displayName, appMode: 'platform'\|'own_app', subscribed: boolean\|null, missingPermissions[], canPrivateReply, canPublicReply, tokenStatus, lastCommentEventAt, capabilities }] }` | — |
| `GET /channels/:channelId/posts` | manage | query `{ cursor?: string }` | `{ posts: RecentPost[], nextCursor }` | `CHANNEL_NOT_FOUND` 404、`POSTS_UNAVAILABLE` 502（`details.reason`：`TOKEN_EXPIRED`／`PERMISSION_MISSING`／`UPSTREAM_ERROR`） |
| `POST /channels/:channelId/posts/resolve` | manage | body `{ url: z.string().url().max(2000) }` | `RecentPost` | `POST_NOT_FOUND` 404、`POSTS_UNAVAILABLE` 502 |
| `POST /channels/:channelId/subscribe-comments` | `channel.update` ＋ `comment_reply.view` | — | `{ subscribed: true }` | `CHANNEL_NOT_FOUND`、`REAUTH_REQUIRED` 409（權限不足，前端導重新連結）、`SUBSCRIBE_FAILED` 502 |

- `readiness` 每個渠道要呼叫 Meta，結果在 Redis 快取 5 分鐘（`comment-reply:readiness:{channelId}`），補訂閱成功時清快取；頁面載入不因 Meta 慢而卡住（每個渠道 3 秒逾時，逾時回 `subscribed: null`）。
- 貼文清單 Redis 快取 60 秒（`comment-reply:posts:{channelId}:{cursor}`），不進資料庫。
- `subscribe-comments` 走 flow：交易內讀憑證 → 交易外 `subscribeCommentEvents()` → 交易內把 `settings.commentReply.receiving = true` 寫回渠道（重新連結時用來決定欄位清單，§7.2）→ 寫租戶稽核 `channel.subscribe_comments`。
- Meta 連結流程的 `returnTo`：`POST /api/v1/meta-connect/start` 加選填 `returnTo`（只接受站內相對路徑，白名單前綴 `/dashboard/`），存進 state；回呼後導回。屬於 meta-connect 模組的小改。

### 5.4 權限註冊（`packages/shared/src/rbac/permissions.ts`）

```ts
// ── 留言自動私訊（feature: comment_reply）──
{ code: 'comment_reply.view',   group: '留言自動私訊', feature: 'comment_reply', label: '檢視留言自動私訊', description: '規則列表、觸發紀錄、試算、前置條件' },
{ code: 'comment_reply.manage', group: '留言自動私訊', feature: 'comment_reply', label: '管理留言自動私訊', description: '建/改/刪規則、排序、啟用、重試、選貼文', dependsOn: ['comment_reply.view'], implies: ['channel.view', 'marketing.view'] },
```

- `implies: ['marketing.view']` 讓管理者讀得到素材清單（素材 API 以 `marketing.view` 守門）。若方案沒有 marketing feature，implies 仍會被天花板濾掉 → 規則編輯頁的素材下拉改呼叫本模組自己的端點？**不另做**：素材下拉直接用既有素材 API，沒有權限時前端只顯示「文字」選項並提示。列在 QA 重點。
- 預設角色：ADMIN、SUPERVISOR 兩者都給；AGENT 給 view（`default-roles.ts`）。部署後跑 `scripts/reconcile-system-…`（記憶規則：新權限點既有租戶 system role 不會自動拿到）。

### 5.5 路由守門順序

`authenticate` → `requirePermission()`（含方案天花板，feature 關閉時 403）→ Zod → flow（渠道可見範圍與存取層級在 service 內查，因為要依資源決定 404／403）。

### 5.6 前後端共用的代碼

狀態、原因代碼、警示代碼放 `packages/shared/src/comment-reply.ts`（列舉＋中文對照表），前端顯示文字與後端列舉同源，避免 UX §4.3「未知代碼」漂移。

---

## 6. 聯絡人建立與收件匣串接（決定 4）

### 6.1 結論先講

- **聯絡人在私訊送出成功時建立**，以 Send API 回傳的 `recipient_id` 當 `ChannelIdentity.uid`。顧客日後回覆私訊時，Messenger／IG 的 `sender.id` 就是這個 uid，`resolveInboundContact()` 直接命中既有身分，不會重複建立。
- **私訊沒送出（失敗、過期、略過）不建立聯絡人**，只在紀錄存留言者 ID 與名稱。理由：FB 拿不到可對應私訊的 ID；建了也無法聯繫，會讓分眾與群發人數失真（UX §10.4 的顧慮）。這一點是對「決定 4」的解讀，列在「需要使用者決定」。

### 6.2 文件查證：留言者 ID 與私訊 ID 是否相同

| 平台 | 留言事件的 `from.id` | 私訊用的 ID | 文件 |
| ---- | ---- | ---- | ---- |
| Instagram | **IGSID**（Instagram Platform › Private Replies：「The commenter's Instagram-scoped ID and username」） | IGSID（private reply 回應的 `recipient_id` 註解「The Instagram-scoped ID」；IG Messaging 的 `sender.id` 也是 IGSID） | 文件載明兩者同為 IGSID。仍以 `recipient_id` 為準並在 T2 比對：不相等時記 log＋紀錄 `idMismatch=true`，以 `recipient_id` 建身分 |
| Facebook | Page feed webhook 的 `from.id`：Webhooks Reference › Page `feed` 只寫「sender information」，**未載明是否為 PSID**。Messenger 文件註明「來自 Facebook Login 的 User ID 是 app-scoped，與 Messenger 不相容」 | PSID（Send API 回應 `recipient_id`：「The customer's PSID」） | **文件未載明，需實測**。設計不假設相同：FB 只信 `recipient_id` |

### 6.3 `ensureContactForRecipient` 的步驟

1. `ChannelIdentity` 以 `(channelId, uid=recipient_id)` 查到 → 回傳既有聯絡人（舊顧客留言的常見情況）。
2. 查不到 → `resolveUidToContact(tx, tenantId, channelType, uid)`（IdentityMap 拼接，與入站相同）→ 有則在該聯絡人下建身分，並 `recordStitchedIdentity()`。
3. 都沒有 → 建 `Contact`（`displayName` = FB `from.name`／IG `@username`；都沒有時用 `channelDisplayName(type) + ' User ' + uid 後 6 碼`，與入站一致）＋`ChannelIdentity`（`profileName` 同上，`profilePic` 空，第一次回覆時既有 `scheduleAvatarRefresh` 會補頭像）。
4. P2002（並行）→ 讀對方建立的，孤兒聯絡人標 `isArchived`（與入站相同）。
5. 不呼叫 `getProfile()`：顧客還沒回覆前，Messenger 的使用者資料 API 對這個 PSID 可能讀不到（文件未載明，需實測）；名稱已有。
6. 不發 `contact.created`、不送招呼語（§6.6）。

`resolveInboundContact()` 的建立邏輯與本函式相似，但它綁著 `InboundMessageContext`、會呼叫 `getProfile()` 與發事件。本 change **不重構**它（避免改動入站主路徑），新函式只重用 `resolveUidToContact`／`recordStitchedIdentity`／P2002 模式；在 `CHANNEL-PLUGINS.md` 或程式註解標明兩處需同步，日後另案合併。

### 6.4 One ID 合併的影響

- 紀錄**不存 `contactId`**，只存 `channelId`＋`recipientUid`（＋`commenterId`）。要顯示聯絡人時以 `ChannelIdentity(channelId, uid)` 即時 join。
- 合併：`ChannelIdentity` 被合併服務搬到存活者 → 紀錄自動跟著顯示存活者，合併服務不必加表。
- 解除合併：身分搬回 → 紀錄也跟著回去。
- 聯絡人資料刪除（GDPR，`data-erasure`）：依該聯絡人（含併入者）的所有 `(channelId, uid)` 把紀錄的 `commenterName`、`commenterUsername`、`commentText`、內容快照抹除（anonymize）或刪除（delete 模式）。**要改 data-erasure handler**；`data-export` 匯出也要含這些紀錄。這兩處容易漏，列入 QA 與 SRE 對齊。
- 跨渠道：同一人 FB 留言（PSID A）、IG 留言（IGSID B）是兩個身分，照既有 One ID 規則（綁定代碼、email、手機）合併，本功能不自動合併。

### 6.5 收件匣串接

觸發時機：顧客第一次在該渠道回覆（`processInboundMessage` 建立訊息之後）。`attachCommentOrigin()`：

1. 找 `channelId` 相同、`recipientUid = sender uid`、`status=SENT`、`conversationId IS NULL`、`sentAt ≥ now − 30 天` 的紀錄，取 `sentAt` 最新一筆。沒有就結束。
2. 條件更新該紀錄 `conversationId = ?`、`customerRepliedAt = 首則回覆時間`（`WHERE conversationId IS NULL`）。0 列 → 別的請求已處理，結束。
3. 插入系統訊息（`senderType: 'SYSTEM'`，`direction: OUTBOUND`，`metadata: { source: 'comment_private_reply', kind: 'origin_note', logId }`，`createdAt = sentAt − 1ms`）：內容「此對話來自貼文留言：顧客在〈貼文摘要〉留言『…』，系統依規則『…』自動私訊。」（UX §7 第 1 點；連結由前端依 `logId` 與權限決定）。
4. 插入外送訊息（私訊快照，`senderType: 'SYSTEM'`，`metadata: { source: 'comment_private_reply', logId }`，`channelMsgId = 私訊的 message_id`，`createdAt = sentAt`）：客服看得到顧客在回什麼（UX §7 第 2 點）。`channelMsgId` 與既有 `@@unique([conversationId, channelMsgId])` 相容；Meta 的 echo 事件本來就被外掛略過，不會重複。
5. `conversation.metadata.origin = { type: 'comment_private_reply', logId, ruleId, ruleName, postId, postExcerpt, commentText(前 100 字), channelType, at }`（JSON 合併，不覆蓋其他 metadata）。
6. 不改 `lastMessageAt`、`unreadCount`（顧客那則已更新），兩則補進的訊息時間早於顧客訊息，排序自然正確。

只在顧客「第一次」回覆時關聯一次；之後同一人再留言、再收到私訊又回覆，若已有進行中的對話（`conversationId` 不為空），第 1 步會找到新的 SENT 紀錄（conversationId 為空）→ 同樣在**現有對話**補一則系統訊息＋私訊快照，`metadata.origin` 不覆蓋（保留第一個來源），另記 `metadata.commentOrigins[]`（最多 20 筆）。

對話列表的「來自留言」標記：列表 API 回 `origin.type`。顯示期間（7 天或永久）待使用者決定（UX §10）。

聯絡人時間軸：聯絡人 timeline API 加一種事件來源「留言私訊」，從紀錄依該聯絡人的身分查（`(channelId, uid)` in 身分清單）。屬於 contact 模組的讀取擴充，透過 `comment-reply-log.service.ts` 的 `listLogsForIdentities(ctx, identities)` 取得（結構規則 4）。

### 6.6 招呼語與 `contact.created`

身分在私訊時建立 → 顧客第一次回覆時 `resolveInboundContact()` 判定不是首次進站 → **不送招呼語、不發 `contact.created`**。

| 選項 | 行為 | 取捨 |
| ---- | ---- | ---- |
| A（建議） | 私訊建立聯絡人時不發 `contact.created`；顧客第一次回覆時補發一次（`attachCommentOrigin` 第 2 步成功時，以 outbox `publishEvent`）。招呼語不送 | 自動化「聯絡人建立」規則在有對話時才觸發，動作（送訊息、指派）才有對話可用；私訊本身已是第一則訊息，再送招呼語很吵 |
| B | 私訊建立時就發 `contact.created` | 規則觸發時沒有對話、在 24 小時視窗外，送訊息類動作全部失敗並寫失敗紀錄 |
| C | 第一次回覆時也送招呼語 | 顧客會連續收到私訊＋招呼語 |

選 A 要 MODIFIED `first-contact-greeting` 的「聯絡人建立時發布 contact.created 事件」（加上「由留言私訊建立的聯絡人，於第一次回覆時發布」）與「首次進站時送出招呼語」（加上排除情境）。列入使用者決定。

---

## 7. Meta 連結

### 7.1 FB：`feed` 的訂閱策略

訂了 `feed` 會收到粉專的全部動態變更（貼文、按讚、分享、留言、編輯、刪除），全平台所有粉專都訂會讓 webhook 量暴增，而大部分租戶沒有本 feature。

**建議：依渠道開啟，不全面加進 `SUBSCRIBED_FIELDS`。**

```ts
// meta-connect.service.ts
export const BASE_SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'messaging_referrals', 'message_echoes'];
export function subscribedFieldsFor(settings: unknown): string[] {
  return readCommentReceiving(settings) ? [...BASE_SUBSCRIBED_FIELDS, 'feed'] : BASE_SUBSCRIBED_FIELDS;
}
export async function subscribePageFields(pageId: string, pageToken: string, fields: string[], appSecret: string): Promise<void>;
```

- 新連結：租戶方案含 `comment_reply` 時，預設把 `settings.commentReply.receiving = true` 並一併訂 `feed`；否則不訂。
- 重新連結：沿用渠道既有的 `receiving` 旗標決定欄位，**不可**用固定清單覆蓋掉 `feed`（POST 是否覆蓋既有欄位文件未載明，一律送完整清單）。
- 補訂閱（既有粉專）：`POST /comment-replies/channels/:id/subscribe-comments` → `subscribePageFields(…, subscribedFieldsFor({receiving:true}), …)`。
- 自備 App 的 FB 渠道（手動貼權杖）：同一個補訂閱 API 用渠道自己的權杖與 App Secret；App 後台的 Page webhook 也要勾 `feed`（租戶自己做，前置條件卡提示）。
- 方案移除 feature 時不自動取消訂閱：收件 flow 第一步就丟棄（成本是一次查詢）。

### 7.2 scope

| 用途 | FB（Facebook Login） | IG（Instagram Login） |
| ---- | ---- | ---- |
| 收留言 webhook | `pages_manage_metadata`、`pages_read_engagement`、`pages_show_list`（已在 `LEGACY_SCOPES`） | `instagram_business_basic`、`instagram_business_manage_comments` |
| 讀留言者資訊 | `pages_read_user_content`：文件未載明 feed webhook 的 `from` 是否需要，**需實測**；需要就加 | — |
| 私訊回覆 | `pages_messaging`（已有） | `instagram_business_manage_messages`（既有私訊已用） |
| 公開回覆 | `pages_manage_engagement`（**新增**到 `LEGACY_SCOPES`） | `instagram_business_manage_comments` |
| 列貼文 | `pages_read_engagement`（已有） | `instagram_business_basic`（已有） |

- 設了 `loginConfigId`（Facebook Login for Business）時，scope 由 Meta 後台的設定決定，程式改不到：SRE 的上線步驟要同步改 config。
- 送審：`pages_manage_engagement`、IG `instagram_business_manage_comments` 需要 Advanced Access；IG 文件明寫 **`comments` 通知本身需要 Advanced Access**，審核前可能連 App 有角色的帳號都收不到 IG 留言事件，只能用 App 後台的「測試」送範例事件（風險 R2）。

### 7.3 IG `comments`

1. App 後台 Instagram webhook 勾 `comments`（平台 App 由我們做；自備 App 由租戶做）。
2. 每個 IG 帳號 `POST graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages,comments`（＋既有在用的欄位）。目前系統沒有任何 IG 訂閱呼叫（F6），補訂閱 API 是第一次做。
3. 權杖要包含 `instagram_business_manage_comments`：既有 IG 渠道的權杖多半沒有，要重新產生並在渠道管理貼上（前置條件卡顯示「重新產生 Instagram 權杖」，不是 FB 的重新連結）。
4. 文件限制：擁有貼文的帳號必須是公開帳號；直播留言另一個欄位（不做）。

---

## 8. UX §11.7 的 Meta 行為查證

| # | 問題 | 查證結果 | 對文案與程式的影響 |
| - | ---- | ---- | ---- |
| 1 | 留言私訊可用的訊息型態 | FB：Messenger › Private Replies「All messaging types available for using the Send API are available for private replies」，範例是按鈕範本。IG（Instagram Login）：Instagram Platform › Private Replies 只寫「message parameter should contain the text」，範例只有文字 | FB 可用素材（第一版排除 receipt／coupon／feedback 範本）；IG 只開文字（與 IG 沒有素材一致）。`MATERIAL_UNSUPPORTED` 依外掛 `capabilities` |
| 2 | 私訊會不會落在「訊息請求」 | IG：文件明寫「追蹤商家帳號者進 Inbox，未追蹤者進 Request folder」。FB：**文件未載明，需實測** | UX §6 的提醒對 IG 確定成立；FB 段落實測後再決定保留 |
| 3 | 廣告貼文留言的 `post_id` 與能否列出 | IG：廣告貼文留言在 `comments` 事件的 `media` 內帶 `ad_id`、`ad_title`，**可能重複通知**（已由唯一鍵擋下）。FB：Page `feed` 是否包含未發布廣告貼文的留言、`post_id` 形式，**文件未載明，需實測**；`published_posts` 不含未發布貼文 | 「全部貼文含廣告貼文」對 IG 成立；FB 實測後定案。貼網址說明保留「廣告貼文請貼廣告預覽網址」需實測可解析 |
| 4 | 對留言的回覆（有 `parent_id`）能否私訊 | FB：Private Replies「commented on a post or comment」→ 可以。IG：文件只說「commented on … post, reel」，回覆留言**未載明，需實測** | FB 第一層與回覆都比對；IG 預設也比對，實測不行就在外掛 `parseCommentEvents` 略過有 `parent_id` 的事件並改文案 |
| 5 | Meta 錯誤碼與原因代碼對照 | 通用碼（190、10、200、551、4/17/32/613、100+33）有文件；「已私訊過」「超過回覆期限」「Standard Access 對象不在 App 角色內」的碼**文件未載明，需實測** | §4.6 表；上線前實測補 fixture |
| 6 | 全形半形與大小寫正規化 | 系統決定，非 Meta 行為 | 採 NFKC＋小寫（§3.4），UX 說明文字可保留「不分大小寫與全形半形」 |
| 7 | （補）IG 留言事件有沒有留言時間 | 文件列出的欄位（帳號 ID、留言者 IGSID 與 username、留言 ID、media ID、文字）**沒有建立時間** | 以 `entry.time` 判斷 7 天，標 `createdAtSource='notification'`；Meta 重投最長 36 小時，誤差在 7 天內可接受 |
| 8 | （補）FB feed 的 `from` 是否一定存在 | 文件未載明；過去版本對未授權 App 的一般使用者可能省略 | 外掛遇到缺 `from` 的留言略過並計數；實測若常見，改為仍可私訊（只是不能同人去重、名稱用「Facebook 使用者」） |
| 9 | （補）不能對另一個粉專私訊 | 文件明寫「Cannot send private reply message to another facebook page」 | Meta 會回錯誤，記 `FAILED/UNKNOWN`；不另判斷 |
| 10 | （補）IG 直播留言 | 只能在直播進行中私訊；另一個欄位 `live_comments` | 不訂閱、不處理；UX 說明保留 |

---

## 9. 平台層

逐項對照 AGENTS.md 與 proposal「Platform layer」，以及記憶規則「新功能要連同平台層一起做」：

| 項目 | 做法 | 檔案 |
| ---- | ---- | ---- |
| 新 feature | `{ slug: 'comment_reply', label: '留言自動私訊', desc: 'Facebook／Instagram 貼文留言關鍵字自動私訊與公開回覆' }` | `packages/core/src/rbac/features.ts` |
| 權限點掛 feature | `comment_reply.view`／`manage`，`feature: 'comment_reply'`；方案頁從 registry 動態出現（granular-plan-entitlement 主規格已保證） | `packages/shared/src/rbac/permissions.ts` |
| 加進既有方案 | 可重跑的 migration：`UPDATE plans SET features = array_append(...) WHERE slug IN (…) AND NOT ('comment_reply' = ANY(features))`；哪些方案包含**待使用者決定**；改完呼叫 `invalidatePlanPermissions()` 或部署後清權限快取（SRE） | migration（SRE）、`permission.service.ts` |
| 背景工作的 feature 檢查 | 權限天花板不作用在背景（F8）→ `comment-reply-entitlement.ts` 的 `isCommentReplyEnabled(ctx)`：讀 `tenants.planId` → `plans.features`；**租戶沒有方案時視為開啟**（與 `getEffectivePermissionsForTenant` 的「planId null 不套天花板」一致）。收件與消費者都檢查 | 新檔 |
| 上限鍵 | `maxCommentReplyRules`、`monthlyCommentReplies` 加進 `LimitKey`；方案沒設定＝無上限（既有方案不受影響） | `plan-limits.service.ts` |
| 平台方案頁 | `LIMIT_KEYS` 加兩列（「留言規則數（啟用中）」「每月留言私訊數」）。這份清單目前寫死在前端，與 granular-plan-entitlement 的「動態化」原則不一致，本 change 只加列，動態化另案 | `apps/web/src/app/admin/plans/page.tsx` |
| 上限實際檢查 | §4.4 表；前置條件 API 回 `quota` 供頁面顯示 | comment-reply 模組 |
| 佇列監控 | `'comment-reply'` 加進 `API_QUEUES`；`monitored-queues.test.ts` 會核對 API 行程的 Worker 清單；保留期限在 job options（completed 24h、failed 7d），符合 queue-monitoring「各佇列 job 的保留期限」 | `monitored-queues.ts`、`apps/api/src/index.ts` 註冊 Worker |
| 佇列 job 顯示識別欄位 | job data 只有 `tenantId`、`logId`，沒有 PII，符合「job 資料只顯示識別欄位」 | — |
| 測試階段旗標（平台 API） | 鍵 `meta.commentReply.accessLevel`，值 `{ fb: 'standard'\|'advanced', ig: 'standard'\|'advanced' }`，預設（沒設定）視為 standard。沿用 `PUT /api/v1/platform/settings/:key`，在路由內比照 `CONTRACT_REMINDER_DAYS_KEY` 加型別驗證（不合法回 400、不寫入）；寫入已有 `setting.update` 平台稽核，不新增稽核動作 | `platform.routes.ts`、新增 `comment-reply-access.ts`（解析函式，供路由與 entitlement 共用） |
| 測試階段旗標（平台頁面） | `/admin` 目前沒有通用設定頁。建議在 `/admin/plans` 頁頂加一張「Meta 審核狀態」卡（FB、IG 各一個切換），因為它影響方案功能的可用性；或新開 `/admin/settings`。**待使用者決定位置** | `apps/web/src/app/admin/…` |
| 旗標只對平台 App 有意義 | 自備 App 的渠道（`appMode='own_app'`）依租戶自己的 App 審核狀態，前置條件卡改顯示「依你自己的 Meta App 審核狀態」 | readiness |
| 平台看各租戶 Meta 訂閱狀態 | proposal 交給 SRE 評估；架構面可由 `GET /readiness` 的同一個 service 提供平台版（以 `prismaAdmin` 列各租戶渠道的 `lastCommentEventAt`／`settings.commentReply.receiving`），不呼叫 Meta | SRE 決定 |
| 不新增的 | 不呼叫 AI、不新增渠道類型、不新增平台稽核動作（旗標沿用 `setting.update`） | — |
| 權限 reconcile | 部署後跑 reconcile script，既有租戶的 system role 才拿得到新權限點 | 上線步驟（SRE） |

---

## 10. 建議的 OpenSpec capability 與 delta

### 10.1 新 capability：`comment-private-reply`（ADDED）

需求清單（每條都要能寫 WHEN/THEN 並有測試；長需求要拆，change 內不忽略 500 字警告）：

1. 留言關鍵字規則的建立與驗證（渠道限有留言擴充的渠道、建立後不可改渠道、關鍵字數量與長度、指定貼文 1～50、IG 不可選素材、素材不可含顧客券連結）
2. 規則的優先順序與「第一條命中者勝」
3. 關鍵字比對：包含、不分大小寫與全形半形、any／all、貼文範圍
4. 留言事件的收件：只處理新留言、排除自己帳號、沒命中不記錄、方案未含功能時丟棄
5. 同一則留言只私訊一次（Meta 重投不產生第二筆紀錄）
6. 7 天期限與「已過期」
7. 同一位留言者在同一規則只私訊一次（可關閉、失敗不佔名額）
8. 私訊送出與失敗原因（封閉列舉、失敗不只寫 log）
9. 公開回覆（預設關、私訊失敗不公開回覆、輪流文字、失敗不影響私訊狀態）
10. 每月私訊數上限與啟用規則數上限（含降級行為）
11. Meta 限流時延後而不是失敗
12. 觸發紀錄的查詢、摘要、詳情、權限與渠道可見範圍
13. 手動重試的條件
14. 規則試算不送出
15. 前置條件查詢與「測試階段」旗標
16. 補訂閱留言事件（FB `feed`、IG `comments`）與重新連結時保留欄位
17. 貼文挑選（最近貼文、網址解析，不存資料庫）
18. 私訊送出成功時建立或對應聯絡人（uid＝recipient_id），失敗不建立
19. 顧客回覆私訊時對話標記來源並補入私訊（只關聯一次）
20. 留言紀錄隨聯絡人資料刪除與匯出處理

### 10.2 MODIFIED（既有主規格，已搜 `openspec/specs/`）

| 主規格 | 需求名稱 | 改什麼 |
| ---- | ---- | ---- |
| `channel-plugins` | Unified channel plugin interface | 介面加選用 `extensions.comments`；`parseWebhook` 之外另有 `parseCommentEvents` |
| `first-contact-greeting` | 聯絡人建立時發布 contact.created 事件 | 留言私訊建立的聯絡人改於第一次回覆時發布（若使用者選 §6.6 A） |
| `first-contact-greeting` | 首次進站時送出招呼語 | 加「由留言私訊建立身分者，第一次回覆不送招呼語」情境（同上） |
| `inbound-contact-resolution` | 新 UID 首次進站必須建立聯絡人並落地訊息 | 「已綁定身分的使用者傳訊息」情境涵蓋留言私訊建立的身分；可能只需在新 capability 寫，**實作時再判斷是否真的要改這條**（避免 ADDED 與既有需求矛盾） |
| `queue-monitoring` | 列出所有佇列 | 情境列舉的佇列加 `comment-reply`（若決定在情境中列出；否則不改） |
| `plan-limits-core` | （不改既有需求） | 新增兩條 ADDED：「留言規則數啟用時硬擋」「每月留言私訊數於送出前檢查」 |
| `contact-management` 或 `tenant-data-erasure` | 聯絡人資料刪除涵蓋的資料 | 加留言紀錄（實作時讀該需求全文確認名稱） |
| `tenant-data-export` | 匯出內容 | 加留言紀錄 |

### 10.3 ADDED（既有主規格的新需求）

| 主規格 | 新需求 |
| ---- | ---- |
| `threads-channel` | Comment Parsing（`comments` 欄位、排除自己、IGSID）；Comment Private Reply Sending |
| `inbound-message-processing` | 留言私訊的後續回覆關聯來源（呼叫點與失敗不影響落地） |
| `plan-limits-core` | 見上 |
| `permission-model`／`rbac` | 不需要：權限碼由註冊表產生，既有需求已涵蓋 |

### 10.4 與未歸檔 change 的關係

- `fix-meta-webhook-page-routing`：它新增的 `meta-page-connect` capability（含「Tenants connect pages with Facebook Login」寫明訂閱 messaging fields）還沒歸檔。**本 change 要在它歸檔之後才寫 MODIFIED**；若它歸檔時間不確定，先把「連結時依功能訂閱 `feed`」寫進本 change 的 `comment-private-reply`（需求 16），並在 proposal 註明歸檔後改為 MODIFIED `meta-page-connect`。不可在本 change 對尚未存在的主規格寫 MODIFIED。
- 它的 `channel-plugins` delta「Meta webhook events are routed by account ID」也會被本 change 依賴（留言沿用同一套分派）。同理，不改它的文字，只在本 change 寫「留言事件依相同規則分派」。
- `fix-automation-delivery-visibility`、`fix-plain-broadcast-send-362` 等其他未歸檔 change 沒有與本功能重疊的需求。

---

## 11. 風險與取捨

| # | 風險 | 影響 | 對策 |
| - | ---- | ---- | ---- |
| R1 | FB feed `from.id` 與 PSID 的關係、穩定性文件未載明 | 同人去重可能失效；名稱缺漏 | 聯絡人只信 `recipient_id`；去重用 `from.id` 並實測；`from` 缺少時降級（§8 第 8 點） |
| R2 | IG `comments` 通知需要 Advanced Access | 審核前可能完全無法實測 IG 真實留言 | UAT 用 App 後台「測試」送範例事件驗解析與分派；平台旗標預設 standard、頁面顯示測試階段；IG 上線時程跟送審走 |
| R3 | 全面訂 `feed` 讓 webhook 量暴增 | API 負載、Meta 失敗率高時 webhook 被停用 | 依渠道開啟（§7.1）；收件第一步 feature 檢查；只解析 `item=comment&verb=add` |
| R4 | `POST subscribed_apps` 覆蓋或合併欄位未載明 | 重新連結把 `feed` 拿掉，留言默默收不到 | 一律送完整清單；`lastCommentEventAt` 與前置條件卡監看；重新連結測試要涵蓋 |
| R5 | Meta 錯誤碼未知 | 原因顯示成 UNKNOWN | 上線前實測補 fixture；UNKNOWN 帶原始訊息 |
| R6 | 系統當機在 Meta 成功與寫 DB 之間 | 紀錄停在 SENDING | SENDING 復原（§4.3），靠 Meta 一則一次保證不重送 |
| R7 | 熱門貼文瞬間大量留言 | 750／小時限流 | Redis 閘門延後；7 天足以消化；不消耗重試次數 |
| R8 | 公開回覆重複或被判垃圾留言 | 品牌傷害 | 預設關、輪流文字（依 commentId 雜湊選）、SENDING 中斷不重送、私訊失敗不公開回覆 |
| R9 | 聯絡人資料刪除與匯出漏掉留言紀錄 | 個資殘留 | §6.4；列入 QA 與 SRE |
| R10 | 入站關聯與 T2 競態 | 對話沒標來源 | 兩條路都呼叫 `attachCommentOrigin`，條件更新只成功一次（§4.8） |
| R11 | `fix-meta-webhook-page-routing` 未歸檔 | spec delta 無法 MODIFIED | §10.4 |
| R12 | 收件放在 API 行程 | webhook 尖峰時 API 多一點 DB 工作 | 收件只有一次規則查詢＋一次 INSERT；Meta 呼叫都在佇列 |

取捨摘要：

- 消費者放 API 行程（RLS＋TenantCtx＋重用）勝過 workers（只有 BYPASSRLS）。
- 比對放在收件（只記命中的留言、佇列量小），消費者再確認規則仍啟用。
- 紀錄不存 contactId（合併零改動）勝過有外鍵（查詢多一次 join）。
- 私訊補進對話在顧客回覆時做（收件匣不出現大量沒回覆的對話）勝過送出時就建對話。

---

## 12. 給 QA 的交接重點

**入口到改動點經過的層**（記憶規則：mock 會藏住整合 bug）：`/webhooks/meta` 與 `/webhooks/fb/:id`、`/webhooks/threads/:id` 三個入口 → 驗簽 → 外掛解析 → 分派 → 收件 flow（RLS 連線）→ outbox → 佇列 → 消費者 → 外掛送出 → 聯絡人 → 入站回覆關聯。單元測試 mock 了外掛與 executor；至少要有一條 feature test 從 webhook 入口打到紀錄 PENDING＋outbox 列存在，另一條從顧客回覆的 webhook 打到對話出現三則訊息。

必測情境（正向與反向都要，記憶規則：只測壞輸入會漏掉合法輸入被錯殺）：

1. 命中：FB 文字、FB 素材、IG 文字各送出一次，紀錄 SENT、`recipientUid` 有值、聯絡人建立一次。
2. 未命中不記錄；粉專自己的留言（含本功能的公開回覆）不記錄、不迴圈。
3. 同一 webhook 重送 3 次、平台網址與渠道網址同時進來：只有一筆紀錄、一次私訊。
4. 同人連留 5 則：去重開＝1 則 SENT＋4 則 SKIPPED_DUPLICATE；去重關＝5 則 SENT；第一則失敗（封鎖）時第二則仍會嘗試。
5. 7 天：留言時間 7 天前 → EXPIRED；邊界 6 天 23 小時 50 分前 → 依安全邊際 EXPIRED（寫進測試讓邊際值看得見）。
6. 規則在排隊期間被停用／刪除 → SKIPPED/RULE_INACTIVE；素材被停用 → SKIPPED/MATERIAL_UNAVAILABLE。
7. 方案不含 feature：路由 403；webhook 留言丟棄；排隊中的 job → SKIPPED/FEATURE_DISABLED。
8. `maxCommentReplyRules`：建立第 N+1 條啟用規則 403、建立停用規則可以、啟用時 403；降級後只有前 N 條生效。
9. `monthlyCommentReplies`：第 N+1 則 SKIPPED/PLAN_LIMIT_REACHED、可重試；兩個 job 同時跑不超賣（advisory lock）。
10. Meta 錯誤：190、551、限流（重試後成功、重試用盡 FAILED）、已私訊過；每種在後台顯示對應中文與可否重試。
11. SENDING 復原：送出後、寫 DB 前讓行程結束，重啟後紀錄變 SENT 或 SENT_UNCONFIRMED，Meta 只收到一次。
12. 公開回覆：開啟且私訊成功 → 回覆一次；私訊失敗 → 不回覆；缺 `pages_manage_engagement` → 前置條件與規則頁提示，公開回覆 FAILED 但私訊 SENT。
13. 顧客回覆私訊：對到同一位聯絡人（沒有第二位）、對話有系統訊息＋私訊快照＋顧客訊息且順序正確、`metadata.origin` 存在、紀錄 `customerRepliedAt` 有值；招呼語與 `contact.created` 依使用者決定的選項。
14. 舊顧客（已有 PSID 身分）留言：私訊後不建新聯絡人。
15. One ID：合併兩位聯絡人後紀錄顯示存活者；解除合併後顯示回原本的人。
16. 聯絡人資料刪除（anonymize／delete）後，紀錄的名稱與留言內容被抹除；資料匯出含紀錄。
17. 渠道可見範圍：分店帳號只看到自己渠道的規則與紀錄；`read_only` 層級看得到但不能改（`canEdit=false`、PATCH 403）；看不到的規則網址 404。
18. 只有 view 的角色：沒有建立、排序、重試；試算可用；素材下拉在沒有 `marketing.view` 時的行為。
19. 重新連結 FB 粉專後 `feed` 仍在訂閱清單（實際打 `GET subscribed_apps` 確認）。
20. 關鍵字正規化：`＋１` 命中 `+1`；大小寫；關鍵字「1」命中「100 元」（UX 的警示是真的）。
21. 平台旗標：standard 時頁面顯示測試階段、權限錯誤顯示 APP_NOT_APPROVED；advanced 時不顯示；PUT 不合法值 400 且有平台稽核。
22. 佇列監控看得到 `comment-reply` 佇列與 failed job 告警。

突變驗證（AGENTS「測試寫完就通過時」）：拿掉自己帳號排除、拿掉 ON CONFLICT、拿掉 7 天判斷、拿掉 advisory lock、把去重改成收件時判斷，各自要讓對應測試失敗；清單寫進 `tasks.md`。

---

## 13. 需要使用者決定

1. **聯絡人建立時機**：只在私訊送出成功時建立（建議），還是留言命中就建立（FB 會建出無法對應私訊的聯絡人）。
2. **招呼語與 `contact.created`**（§6.6）：建議 A（第一次回覆時補發事件、不送招呼語）。
3. **哪些方案包含 `comment_reply`**，以及兩個上限的預設值（例：基本方案啟用規則 5 條／每月 1,000 則；進階 20 條／5,000 則；企業無上限）。
4. **測試階段旗標的平台頁面位置**：`/admin/plans` 頁頂卡片，或新開 `/admin/settings`。
5. **新連結的粉專是否預設訂 `feed`**（建議：方案含本功能才預設訂）。
6. **關鍵字回覆是否也改 NFKC 正規化**（會改既有主規格，另開 change）。
7. UX 遺留：「來自留言」標記顯示期間、紀錄匯出 CSV、活動期間、側欄位置（見 01 號 §10）。

## 14. 與 SRE（03-sre-db.md）需要對齊的點

1. 兩張表的需求：規則（渠道、關鍵字、比對方式、貼文範圍與快照、內容、去重開關、公開回覆文字、啟用、priority）；紀錄（見下）。
2. 紀錄要記：`channelId`、`ruleId`（規則刪除後保留，SetNull 或不設外鍵）、`commentId`、`postId`、`parentId`、`commenterId`、`commenterName/Username`、`commentText`、`commentCreatedAt`＋來源、`matchedKeywords`、`status`、`reasonCode`、`metaErrorCode/subcode/message`、`attemptCount`、`sendingAt`、`sentAt`、`recipientUid`、`messageId`、`contentSnapshot`、`publicReplyStatus/Text/ReplyId/ReasonCode`、`conversationId`、`customerRepliedAt`、`dedupe 持有旗標`、`retryable`、`createdAt/updatedAt`、`tenantId`。**不存 contactId**（§6.4）。
3. 唯一性：`(channelId, commentId)` 唯一；`(ruleId, commenterId)` 部分唯一（只在持有去重時）。
4. 查詢模式：紀錄列表依 `(tenantId, commentCreatedAt desc, id)` cursor＋狀態／渠道／規則篩選；`q` 名稱與內容部分比對（trigram）；`stats7d` 依 `(ruleId, status)` 近 7 天聚合；月上限依 `(tenantId, sentAt)` 計數；入站關聯依 `(channelId, recipientUid, status, conversationId IS NULL)`。
5. 渠道 `settings.commentReply.receiving` 與 `lastCommentEventAt`（節流寫入，比照 `recordRoutingWarning` 10 分鐘一次）放 settings JSON 還是欄位。
6. 兩張表 ENABLE＋FORCE RLS；`comment-reply` 佇列的告警與保留期限；Redis 鍵（限流、readiness 快取、貼文快取）的 TTL 與命名。
7. 方案 feature migration（可重跑）、權限 reconcile、權限快取清除的上線順序。
8. Meta App 設定：Page webhook 加 `feed`、Instagram webhook 加 `comments`、Facebook Login for Business config 加 `pages_manage_engagement`（及實測後是否要 `pages_read_user_content`）、送審清單；這些動作改到正式 App，執行前要先問使用者。
9. 紀錄的保留期限（個資）與資料刪除、資料匯出的範圍。
10. `META_COMMENT_REPLY_RATE_PER_HOUR`（預設 700）等環境變數。
