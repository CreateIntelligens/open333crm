# 留言關鍵字 → 自動私訊（FB／IG Private Replies）

## Context
需求：粉專或 IG 貼文有人留言含特定關鍵字時，系統自動用 Messenger／IG 私訊傳指定訊息給留言者（例如活動貼文留「+1」就私訊優惠券連結）。
已定範圍：完整功能（OpenSpec change + 後端 + 後台 UI），FB + IG 都做；規則可指定貼文（不填就是全部貼文）；可選公開回覆留言（預設關閉）。

## Meta 官方規格（從 FB MCP 查到）
- **FB**：訂閱 Page webhook 的 `feed` 欄位。留言事件位在 `entry[].changes[]`，條件是 `field=feed`、`value.item=comment`、`value.verb=add`。事件帶 `comment_id`、`post_id`、`parent_id`、`from{id,name}`、`message`、`created_time`
- **IG**：訂閱 `comments` 欄位，直播留言另有 `live_comments`（先不做）。事件帶 `id`（留言 ID）、`text`、`from{id,username}`、`media{id}`
- **送出私訊**：用 Send API，但 `recipient` 填 `{ "comment_id": "<ID>" }`，`message` 可以是任何 Send API 支援的型態
  - FB：`POST graph.facebook.com/{PAGE_ID}/messages`
  - IG（Instagram Login）：`POST graph.instagram.com/me/messages`
- **限制**：每則留言只能私訊 **1 次**；留言後 **7 天內**才能送；對方回覆私訊後才開 24h 視窗；Standard Access 只對 App 上有角色的帳號生效，給一般用戶用要 **Advanced Access／App Review**
- **權限**：FB 要 `pages_messaging`、`pages_read_engagement`、`pages_manage_metadata`；公開回覆另要 `pages_manage_engagement`。IG 要 `instagram_business_manage_comments`（Instagram Login）
- **目前 App 狀態**：創造智能 App（671495162407854）的 page topic 只訂了 messaging 系列欄位，**沒有訂 `feed`**

## 程式現況（探索結果）
- Webhook 只讀 `entry.messaging[]`，沒有讀 `entry.changes[]`：`packages/channel-plugins/src/facebook/index.ts:24`、`threads.ts:40`
- 發送都寫死 `recipient:{id}`，而且 worker 發送必須有 conversation：`apps/workers/src/lib/channel-delivery.ts:122`
- 訂閱欄位常數 `SUBSCRIBED_FIELDS`（`apps/api/src/modules/meta-connect/meta-connect.service.ts:32`）裡沒有 `feed`
- 關鍵字比對的邏輯可以參考 `checkKeywordTriggers`（`apps/api/src/modules/automation/automation.worker.ts:278`，用 includes 比對，有 any／all 兩種模式）
- 送素材可以參考 `send_material`（`apps/workers/src/lib/automation-actions.ts:376`）
- 資料庫還沒有任何貼文或留言的 model

## 設計
以留言觸發的流程有兩個特性：送出時還沒有 conversation，而且每則留言只能私訊一次。所以另開一個 `comment-reply` 模組，不硬塞進現有的 automation 規則（那條路徑依賴 conversationId）。

### 1. OpenSpec change `add-comment-keyword-private-reply`
proposal、specs、tasks 都寫 WHEN／THEN scenario。測試任務排在實作任務前面。

### 2. 資料庫（`packages/database/prisma/schema.prisma` + 正式 migration + RLS migration）
- `CommentReplyRule`：tenantId、channelId、name、keywords[]、matchMode(any|all)、postIds[]（空陣列 = 全部貼文）、materialId?／messageText?、publicReplyText?、isActive、priority
- `CommentReplyLog`：tenantId、channelId、ruleId、commentId、postId、commenterUid、commentText、status(SENT|FAILED|SKIPPED_EXPIRED)、errorMessage、sentMessageId、createdAt
  - `@@unique([channelId, commentId])` 用來防重複私訊（Meta 會重投 webhook、廣告貼文也會送重複事件）
- 兩張表都要 ENABLE＋FORCE RLS（依 `postgres-rls-tenant-isolation` skill）

### 3. Channel plugin（`packages/channel-plugins`，依結構規則 5 不在別處判斷 channelType）
- `index.ts` 新增型別 `ParsedCommentEvent { accountId, commentId, postId, parentId?, commenterUid, commenterName?, text, createdAt }`，並在 `ChannelPlugin` 介面加兩個 optional 方法：
  - `parseCommentEvents?(rawBody): ParsedCommentEvent[]`
  - `sendPrivateReply?(commentId, payload: OutboundPayload, credentials): Promise<{ messageId, recipientId }>`
  - `replyToComment?(commentId, text, credentials)`：公開回覆
- `facebook/index.ts`：解析 `changes` 中 `field=feed && item=comment && verb=add` 的事件，而且要排除 `from.id === entry.id`（粉專自己的留言，避免無限迴圈）。把 `sendMessage` 組 body 的邏輯抽成共用函式，讓 recipient 可以是 `{id}` 或 `{comment_id}`
- `threads.ts`：解析 `field=comments`，同樣排除自己帳號的留言，送出規則同上
- 單元測試放在 `packages/channel-plugins/tests/unit/`（payload 解析、body 組裝）

### 4. API 入站（`apps/api/src/modules/webhook/webhook.service.ts`）
- 在 `processPlatformMetaWebhook` 及舊的 `/fb/:channelId`、`/threads/:channelId` 路徑中，除了 `parseWebhook`，也呼叫 `plugin.parseCommentEvents`
- 用 `entry.id` 分派到正確的渠道和租戶（沿用 `webhook-account-routing.ts`），然後依 Path B 把工作放進 BullMQ queue（新 queue `comment-reply`），不在 webhook 裡同步發送

### 5. 新模組 `apps/api/src/modules/comment-reply/`
- `comment-reply.service.ts`：規則 CRUD、log 查詢、`matchCommentRule(rules, event)`（純函式，從 `checkKeywordTriggers` 抽出共用的比對邏輯）。所有函式第一個參數都是 executor
- `comment-reply.routes.ts`：Zod 驗證 + `requirePermission('comment_reply.view' | 'comment_reply.manage')`
- 在 `packages/core/src/rbac/permissions.ts` 註冊兩個新權限點，並在 `apps/api/src/index.ts` 註冊 route

### 6. Worker（`apps/workers`）
- 新增 `handlers/comment-reply.handler.ts`，流程如下：
  1. 用 `withTenant` 進入租戶連線
  2. 先寫一筆 `CommentReplyLog`，unique 衝突就略過
  3. 留言超過 7 天 → `SKIPPED_EXPIRED`
  4. 比對規則
  5. 素材沿用 `send_material` 的渲染邏輯
  6. 呼叫 `plugin.sendPrivateReply`
  7. 有設定才呼叫 `replyToComment`
  8. 更新 log 狀態
- 失敗要寫進 log 的 `FAILED` + `errorMessage`，後台看得到，不能只寫 console（記憶規則：失敗不可只寫 log）
- 確認 `apps/workers/src/lib/plugin-registry.ts` 有用到新方法

### 7. 訂閱欄位
- `SUBSCRIBED_FIELDS` 加 `'feed'`；LEGACY_SCOPES 加 `pages_manage_engagement`（公開回覆用）
- 已連結的粉專要重新呼叫 `subscribed_apps`：做一支 script，或在後台「重新連結」時補上
- IG：App 後台要訂 `comments` 欄位；token 權限要包含 `instagram_business_manage_comments`，已連結的 IG 可能需要重新授權

### 8. 前端（`apps/web`）
- 新頁面 `apps/web/src/app/dashboard/comment-replies/page.tsx`，有兩個分頁：
  - 規則列表／編輯：選渠道、關鍵字、比對模式、貼文 ID（選填）、素材或文字、公開回覆文字（選填）
  - 觸發紀錄：狀態 badge、失敗原因
- 參考 `keyword-replies/page.tsx`；不放 emoji
- 加 component test（jsdom）

### 9. 文件
- CHANGELOG（`## [2026-10-21]` 區段）
- `docs/ref/modules/CHANNEL-PLUGINS.md` 補上新方法
- 手冊之後再補

## 需要 Meta 端／人工操作（外部動作，執行前會先問）
1. 在創造智能 App 的 Page webhook 訂閱加上 `feed`；IG App 加上 `comments`（可以用 MCP `devtools_webhook_manage`，但會改到正式 App，要先問你）
2. App Review：`pages_read_engagement`、`pages_manage_metadata` 確認已有 Advanced Access；`pages_manage_engagement`、`instagram_business_manage_comments` 可能要送審。審核過之前，只有 App 上有角色的帳號能實測
3. 部署：跑 migration、reconcile 權限點、重新訂閱既有粉專

## 驗證
- `pnpm test`：plugin 解析與組 body、`matchCommentRule`、worker handler（mock executor：防重複、7 天過期、失敗寫進 log）、routes 權限
- `pnpm test:feature`：新的兩張表的 RLS 跨租戶隔離、unique 防重複
- `node scripts/check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict`、`validate-openspec.mjs`
- 用 MCP `devtools_webhook_test` 送 `feed` 和 `comments` 的測試事件（不帶簽章，只能驗解析和分派）
- UAT 實測：用 App 有角色的帳號在 Open333test 粉專貼文留關鍵字，確認收到私訊、log 是 SENT；同一則留言重投不會再私訊；IG 也照同樣流程跑一次
