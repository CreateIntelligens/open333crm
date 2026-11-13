---
name: feature-comment-reply
description: >
  open333CRM「留言自動私訊」功能顧問：Facebook／Instagram 貼文留言命中關鍵字時自動私訊留言者（Private Replies）、
  選填公開回覆留言、關鍵字規則（比對方式 any/all、NFKC 全形半形、指定貼文、每人一次、排序、啟用、方案上限
  maxCommentReplyRules）、試算 /rules/test、觸發紀錄與手動重試、前置條件卡 readiness、開啟留言接收
  （subscribe-comments、subscribed_apps 的 feed／comments 欄位）、留言收件（webhook 留言分支、cr:rules-ver 規則快取）、
  背景送出（comment-reply 佇列、token bucket 限流、每月私訊數 monthlyCommentReplies、7 天期限、去重 dedupeKey）、
  留言建立的聯絡人（comment_authors、recipient_id 接上身分、不送招呼語、補發 contact.created）、收件匣「來自留言」、
  平台三層開關（方案功能 comment_reply、commentReply.capabilities、緊急停止）、/admin/comment-reply 健康頁、
  補訂閱腳本 comment-reply-subscriptions.ts。
  當需求、bug 或新功能碰到 comment-reply 模組、/dashboard/comment-replies、/admin/comment-reply、comment_reply_* 資料表、
  「留言沒有私訊」「同一人收到兩次私訊」「私訊沒進收件匣」「粉專私訊突然收不到（訂閱欄位被蓋掉）」時使用。
  也在改 Meta 連結、FB／IG 外掛、webhook 帳號分派、入站建立聯絡人、招呼語之前使用，確認不破壞留言自動私訊。
---

# 留言自動私訊

## 先讀
- 規劃與決策：`openspec/changes/add-comment-keyword-private-reply/design.md`（D1～D28、資料流、資料模型、API）；任務與突變驗證：同目錄 `tasks.md`；QA 計畫：`openspec/changes/add-comment-keyword-private-reply/planning/05-qa.md`。change 尚未歸檔，規格在 `openspec/changes/add-comment-keyword-private-reply/specs/`（主規格 `comment-private-reply`、`comment-reply-rules`、`comment-reply-contact-linking`、`comment-reply-meta-subscription`、`comment-reply-platform-controls`）。
- 平台控制與 runbook：`docs/ref/features/platform/COMMENT-REPLY.md`
- 外掛的留言擴充、兩處建立聯絡人的邏輯：`docs/ref/modules/CHANNEL-PLUGINS.md`
- 資料表：`docs/ref/DATABASE-ERD.md` 的 N 節、`docs/16_DB_SCHEMA.md` 的決策 8
- 權限：`docs/ref/modules/PERMISSIONS.md`（`comment_reply.view`／`manage`、`PLAN_FEATURE_NOT_INCLUDED`）
- 操作手冊：尚未撰寫（上線後以真實畫面補）
- 影響分析：`node scripts/feature-impact.mjs --domain comment-reply`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限。API 前綴 `/api/v1/comment-replies`，路由在 `apps/api/src/modules/comment-reply/comment-reply-rule.routes.ts`、`comment-reply-log.routes.ts`、`comment-reply-channel.routes.ts`。頁面 `apps/web/src/app/dashboard/comment-replies/page.tsx`（規則、觸發紀錄兩分頁，`?tab=logs`）。

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 前置條件卡 | 頁面頂端 | `GET /readiness` → `readinessFlow`（每渠道查 Meta，快取 5 分鐘、3 秒逾時） | 只讀 | `comment_reply.view` |
| 2 | 規則列表 | 規則分頁 | `GET /rules` | 依渠道可見範圍過濾；每條帶 `canEdit`、7 天統計、警示（`OVER_PLAN_LIMIT`、`CHANNEL_NOT_SUBSCRIBED`、`MATERIAL_INACTIVE`） | view |
| 3 | 建立、修改規則 | 「新增規則」、`/new`、`/[ruleId]` | `POST /rules`、`PATCH /rules/:id` → `comment-reply.flow.ts` | 寫規則與租戶稽核（同一交易）；commit 後遞增 `cr:rules-ver:<channelId>`；啟用中的規則數超過方案上限回 403 `PLAN_LIMIT_EXCEEDED` | `comment_reply.manage`，渠道層級 `full` |
| 4 | 啟用切換、排序、刪除 | 列表 | `PATCH /rules/:id/active`、`PUT /rules/order`、`DELETE /rules/:id`（軟刪除） | 同上，遞增版本號 | manage |
| 5 | 試算 | 規則頁「試算」 | `POST /rules/test` → `testRules`（與收件共用 `listActiveRulesForChannel()`＋`matchCommentRule()`） | 不寫資料 | view |
| 6 | 素材選項 | 規則編輯器 | `GET /material-options?channelId=` | 只回該渠道外掛支援、啟用中、不含券連結的素材 | manage（不需 `marketing.view`） |
| 7 | 指定貼文 | 規則編輯器 | `GET /channels/:id/posts`、`POST /channels/:id/posts/resolve` | 平台未開 `*PostPicker` 時 403，只能手動填 ID | manage |
| 8 | 開關留言接收 | 前置條件卡 | `POST`／`DELETE /channels/:id/subscribe-comments` | Meta `subscribed_apps` 整份取代（一律送完整欄位）；寫 `settings.commentReply.receiving`、稽核 `channel.comment_subscription.update` | `channel.update`＋`comment_reply.view` |
| 9 | 觸發紀錄 | 觸發紀錄分頁 | `GET /logs`、`GET /logs/summary`、`GET /logs/:id` | 只讀；詳情的 `conversationId` 只在有 `inbox.view` 且看得到渠道時回 | view |
| 10 | 重試 | 紀錄「重試」 | `POST /logs/:id/retry` → `retryLogFlow` | 紀錄改回 PENDING、`enqueueCommentReplyDelivery()` 排入、稽核 `comment_reply.log.retry`（同一交易） | manage |
| 11 | 留言收件（系統） | Meta webhook | `/webhooks/meta`、`/webhooks/fb|threads/:channelId` → `webhook.service.ts` 留言分支 → `comment-reply-intake.flow.ts` | 命中才寫 PENDING 紀錄（`ON CONFLICT DO NOTHING`）、找或建聯絡人、排入送出工作 | 簽章 |
| 12 | 背景送出（系統） | `comment-reply` 佇列（API 行程） | `comment-reply.worker.ts` → `comment-reply-delivery.flow.ts` | 送前重新檢查開關、方案、渠道、規則、素材、7 天；限流延後不消耗重試次數；月額度原子扣減；成功後以 `recipient_id` 接上渠道身分 | — |
| 13 | 收件匣「來自留言」 | 顧客回覆私訊 | `processInboundMessage()` → `attachInboundCommentOrigin()` | 關聯紀錄與對話、補入系統訊息與私訊快照，只關聯一次 | — |
| 14 | 平台設定與健康 | `/admin/comment-reply` | `PUT /platform/settings/commentReply.*`、`GET /platform/comment-reply/health` | 見平台文件 | 平台帳號 |

## 不可破壞的規則
- **訂閱欄位一律送完整清單。** `POST subscribed_apps` 是整份取代，少一個私訊欄位就是那個粉專的私訊全部中斷。FB 一律經 `meta-connect.service.ts` 的 `subscribedFieldsFor()`，IG 經 `comment-reply-channel.service.ts` 的欄位常數；不要在別處寫欄位清單。
- **試算與收件用同一份規則查詢與比對。** `listActiveRulesForChannel()` 只在 `comment-reply-rule.service.ts`；收件的規則快取讀 `comment-reply-rule-cache.ts` 的 `cr:rules-ver:<channelId>`，規則的每一種異動（建立、修改、刪除、啟用切換、排序）都要在 commit 後呼叫 `bumpCommentReplyRulesVersion()`，否則收件最多 30 秒內用舊規則。
- **送出工作只有一個排入點。** 收件、重試、補回排程都呼叫 `comment-reply-enqueue.ts` 的 `enqueueCommentReplyDelivery()`（佇列 `comment-reply`、job `deliver`、data 只有 `{ tenantId, logId }`、`COMMENT_REPLY_JOB_OPTIONS`）。job 與日誌不放留言內容與名稱。
- **Meta 呼叫不在交易內。** 讀紀錄與認領各一個短交易，呼叫外掛在交易外，再開交易寫結果。
- **冪等三層**：收件 `(channelId, commentId)` 唯一＋`ON CONFLICT DO NOTHING`；認領以 `status='PENDING'` 條件更新；每人一次的 `dedupeKey` 部分唯一索引只在 `SENDING`／`SENT` 生效（送出時才佔名額）。改這三處要跑 `comment-reply-dedupe.test.ts` 與 `comment-reply-intake.test.ts` 的並行案例。
- **業務失敗不讓 job 失敗。** Meta 明確拒絕（551、已私訊過、期限已過等）寫 FAILED／EXPIRED 後 job 正常完成；只有網路與系統錯誤讓 BullMQ 重試。限流延後用 `DelayedError`，不消耗 attempts。
- **背景自己查方案與開關。** 背景工作不經權限天花板，收件與送出都要呼叫 `comment-reply-entitlement.ts`（方案用 `isCommentReplyPlanEnabled()`，沒有方案視為開啟）。
- **兩處建立聯絡人要同步。** 留言收件（`resolveCommentAuthor()`、`linkRecipientIdentity()`）與私訊進站（`inbound-contact-resolver.ts` 經 `findCommentAuthorContact()`）的規則見 `docs/ref/modules/CHANNEL-PLUGINS.md`。留言收件不建 `ChannelIdentity`、不發 `contact.created`、不送招呼語。
- **外掛差異只經 `extensions.comments`**（結構規則 5），`comment-reply` 模組不比對 `channelType`。
- **個資**：留言內容、留言者名稱、PSID 都是個資，資料匯出、刪除與聯絡人合併已涵蓋 4 張表（`apps/workers/src/handlers/data-erasure.handler.ts`、`data-export.handler.ts`、`contact-merge.service.ts`）；新增欄位時一併處理。

## 跨功能牽連
執行 `node scripts/feature-impact.mjs --domain comment-reply` 看最新版本。重點：
- **依賴**：渠道（外掛、Meta 連結、webhook 分派、可見範圍）、聯絡人（建立、合併引擎）、收件匣（對話關聯、招呼語）、行銷（素材）、平台方案、平台設定、佇列監控、治理（稽核、匯出、刪除）。
- 改 `webhook.service.ts`、`meta-connect.service.ts`、`inbound-contact-resolver.ts`、`first-contact-greeting`、`contact-merge.service.ts` 時，要跑本領域的 feature 測試。

## 回歸清單
- 自動測試：`pnpm --filter @open333crm/api test -- comment-reply`；`pnpm --filter @open333crm/channel-plugins test -- comment`；`pnpm --filter @open333crm/web test -- comment-replies`。feature 測試（獨立資料庫）：`TEST_DATABASE_NAME=<自己的測試庫> pnpm --filter @open333crm/api test:feature modules/comment-reply modules/meta-connect modules/platform/platform-comment-reply modules/queue-monitoring`。
- 手動（UAT 是正式環境，任何寫入、改 Meta App、開能力都要使用者同意）：測試租戶放進含 `comment_reply` 的方案 → 平台打開 `fbPrivateReply` → 開啟留言接收前後各 `GET subscribed_apps` 對照私訊欄位都在 → 立刻傳一則私訊確認仍進收件匣 → 留言命中規則收到私訊 → 回覆進收件匣且有「來自留言」。

## 常見 bug 從哪裡查
- 「留言沒有私訊」：`docs/ref/features/platform/COMMENT-REPLY.md` 的 runbook；先看觸發紀錄有沒有這則留言（沒有＝收件前置檢查或沒命中；有＝看原因代碼）。
- 「粉專私訊突然收不到」：某處送了不完整的訂閱欄位。查 `subscribeFields` 的呼叫端是否都經 `subscribedFieldsFor()`；補救用 `apps/api/src/scripts/comment-reply-subscriptions.ts --mode resubscribe`（預設 dry-run）。
- 「同一人收到兩次私訊」：`dedupePerCommenter`、`dedupeKey` 部分唯一索引、規則刪除重建（新規則會再私訊，這是預期）。
- 「改了規則收件沒變」：規則異動有沒有遞增 `cr:rules-ver:<channelId>`（`comment-reply.flow.ts` 的 `bumpRulesVersion`）。
- 「私訊沒進收件匣」：`comment-reply-inbox.service.ts` 的 `attachCommentOrigin`（30 天內、`recipientUid` 等於發送者 UID 的 SENT 紀錄）。
