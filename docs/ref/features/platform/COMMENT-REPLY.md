# 留言自動私訊

顧客在 Facebook 或 Instagram 貼文留言、留言命中租戶設定的關鍵字規則時，系統以 Private Replies 私訊留言者，也可以選擇公開回覆這則留言。本文件的前半段寫租戶端的規則、收件、送出與畫面；後半段寫營運方怎麼控制：哪些租戶能用、哪些能力開放、怎麼緊急停止、怎麼看健康狀況，以及出事時的處理步驟。渠道外掛的留言擴充、兩處建立聯絡人的邏輯，見[渠道外掛](../../modules/CHANNEL-PLUGINS.md#留言擴充)。

- **資料來源**：`apps/api/src/modules/comment-reply/comment-reply-platform-settings.ts`、`comment-reply-entitlement.ts`、`comment-reply-health.ts`、`comment-reply-maintenance.flow.ts`、`comment-reply.scheduler.ts`、`apps/api/src/modules/platform/comment-reply-health.service.ts`、`platform.routes.ts`、`apps/web/src/app/admin/comment-reply/page.tsx`、`apps/api/src/scripts/comment-reply-subscriptions.ts`
- **核對日期**：2026-11-19
- **規格**：規格還在未歸檔的 change 目錄 `openspec/changes/add-comment-keyword-private-reply/`。設計決策 D1～D28、資料流、資料模型與 API 在同目錄的 `design.md`。

## 程式的入口

租戶端的路由前綴是 `/api/v1/comment-replies`，分在三個檔案，全部先經過 `fastify.authenticate` 與 `requirePermission()`，再以 Zod 解析，再呼叫 `comment-reply.flow.ts` 的 flow：

| 檔案 | 路由 | flow |
| --- | --- | --- |
| `comment-reply-rule.routes.ts` | `GET /rules`、`GET /rules/:id`、`POST /rules`、`PATCH /rules/:id`、`PATCH /rules/:id/active`、`PUT /rules/order`、`DELETE /rules/:id`、`POST /rules/test`、`GET /material-options` | `listRulesFlow()`、`getRuleFlow()`、`createRuleFlow()`、`updateRuleFlow()`、`setRuleActiveFlow()`、`reorderRulesFlow()`、`deleteRuleFlow()`、`testRulesFlow()`、`listMaterialOptionsFlow()` |
| `comment-reply-log.routes.ts` | `GET /logs`、`GET /logs/summary`、`GET /logs/:id`、`POST /logs/:id/retry` | `listLogsFlow()`、`summarizeLogsFlow()`、`getLogFlow()`、`retryLogFlow()` |
| `comment-reply-channel.routes.ts` | `GET /readiness`、`GET /channels/:channelId/posts`、`POST /channels/:channelId/posts/resolve`、`POST`、`DELETE /channels/:channelId/subscribe-comments` | `readinessFlow()`、`listPostsFlow()`、`resolvePostFlow()`、`setCommentReceivingFlow()` |

系統端的入口：

| 步驟 | 程式 |
| --- | --- |
| 收到留言 | `/api/v1/webhooks/meta`、`/webhooks/fb/:channelId`、`/webhooks/threads/:channelId` → `webhook.service.ts` 的留言分支 → `comment-reply-intake.flow.ts` |
| 排入送出工作 | `comment-reply-enqueue.ts` 的 `enqueueCommentReplyDelivery()` |
| 送出私訊與公開回覆 | `comment-reply` 佇列（API 行程）→ `comment-reply.worker.ts` → `comment-reply-delivery.flow.ts` |
| 顧客回覆私訊時關聯對話 | `processInboundMessage()` → `apps/api/src/modules/webhook/inbound-comment-origin.ts` 的 `attachInboundCommentOrigin()` → `comment-reply-inbox.service.ts` 的 `attachCommentOrigin()` |
| 補訂閱與停用留言欄位 | `apps/api/src/scripts/comment-reply-subscriptions.ts` |

## 規則

- 一條規則屬於一個渠道，有關鍵字、比對方式（`any` 或 `all`）、選填的指定貼文、「每人一次」（`dedupePerCommenter`）、排序與啟用狀態。比對前以 NFKC 正規化，全形與半形視為相同（`comment-reply-match.ts` 的 `matchCommentRule()`）。
- 試算（`POST /rules/test`）與收件用同一份規則查詢與比對：`comment-reply-rule.service.ts` 的 `listActiveRulesForChannel()` 加上 `matchCommentRule()`。試算不寫資料。
- 建立、修改、刪除、啟用切換、排序都在同一個交易寫規則與租戶稽核。刪除是軟刪除。
- 收件以 `comment-reply-rule-cache.ts` 快取每個渠道的規則，每筆快取最多 30 秒，並比對 Redis 的版本號 `cr:rules-ver:<channelId>`。規則的每一種異動都在 commit 之後呼叫 `bumpCommentReplyRulesVersion()` 遞增版本號（`comment-reply.flow.ts` 的 `bumpRulesVersion`）。漏了遞增時，收件最多 30 秒內仍用舊規則。
- 啟用中的規則數超過方案的 `maxCommentReplyRules` 時，建立或啟用回 403 `PLAN_LIMIT_EXCEEDED`。
- 修改規則要求渠道的層級是 `full`。規則列表依渠道可見範圍過濾，每條規則帶 `canEdit`、最近 7 天的統計，以及警示 `OVER_PLAN_LIMIT`、`CHANNEL_NOT_SUBSCRIBED`、`MATERIAL_INACTIVE`。
- 素材選項（`GET /material-options?channelId=`）只回該渠道外掛支援的內容類型、啟用中、不含券連結的素材。這條路由要求 `comment_reply.manage`，不需要 `marketing.view`。
- 刪除規則再重建時，新規則是另一條規則，「每人一次」重新計算，已私訊過的人會再收到私訊。這是預期的行為。

## 一則留言怎麼處理

**訂閱欄位。** Meta 的 `POST subscribed_apps` 以整份清單取代粉專的訂閱欄位，少送一個私訊欄位，那個粉專的私訊就全部中斷。FB 的欄位一律由 `meta-connect.service.ts` 的 `subscribedFieldsFor()` 產生，IG 的欄位是 `comment-reply-channel.service.ts` 的 `IG_BASE_SUBSCRIBED_FIELDS` 加上 `IG_COMMENT_FIELD`。開關留言接收時一律送完整的欄位清單，並寫 `settings.commentReply.receiving`。

**收件。** `comment-reply-intake.flow.ts` 檢查三層開關（見[三層開關](#三層開關)）、渠道與規則。留言命中規則時：

1. 寫一筆 PENDING 的觸發紀錄。`(channelId, commentId)` 唯一，以 `INSERT … ON CONFLICT DO NOTHING` 寫入，同一則留言只建一筆。
2. 以 `resolveCommentAuthor()` 找到或建立留言者的聯絡人（`comment_authors`）。留言收件不建立 `ChannelIdentity`、不發布 `contact.created`、不送招呼語。
3. 呼叫 `enqueueCommentReplyDelivery()` 排入送出工作。

粉專自己的留言不處理。單一渠道收件失敗時，該渠道記 `comment_intake_failed` 分派警示，並寫 error log `[Webhook] 留言收件失敗`。

**送出工作只有一個排入點。** 收件、重試、`comment-reply-recover` 排程都呼叫 `enqueueCommentReplyDelivery()`：佇列 `comment-reply`、job 名稱 `deliver`、data 只有 `{ tenantId, logId }`、選項是 `COMMENT_REPLY_JOB_OPTIONS`。job 與日誌不放留言內容與留言者名稱。

**送出。** `comment-reply-delivery.flow.ts` 分成幾個短交易，呼叫 Meta 的步驟都在交易外：

1. 讀紀錄。
2. 以 `status='PENDING'` 的條件更新認領紀錄。
3. 在交易外呼叫外掛的 `sendPrivateReply()`。
4. 開新的交易寫結果。
5. 有公開回覆時，再認領、在交易外呼叫 `replyToComment()`、寫結果。

送出前重新檢查開關、方案、渠道、規則、素材與 7 天期限。背景工作不經過權限的方案天花板，所以收件與送出都自己呼叫 `comment-reply-entitlement.ts`（方案用 `isCommentReplyPlanEnabled()`）。每月私訊數 `monthlyCommentReplies` 在送出前原子扣減。私訊成功後，`linkRecipientIdentity()` 以 Meta 回傳的 `recipient_id` 接上留言者的渠道身分。

**失敗與重試。** Meta 明確拒絕的業務失敗（例如錯誤碼 551、已私訊過、超過期限）寫成 FAILED 或 EXPIRED，job 正常完成。只有網路與系統錯誤讓 job 失敗，由 BullMQ 重試。限流時，worker 以 `job.moveToDelayed()` 加 `DelayedError` 延後，不消耗重試次數。

**每人一次。** `dedupeKey` 的部分唯一索引只在 `SENDING`、`SENT` 生效，所以送出時才佔名額；FAILED、EXPIRED、PENDING 不佔名額。

收件的唯一鍵、認領的條件更新、`dedupeKey` 部分唯一索引三者一起避免重複私訊。`comment-reply-dedupe.test.ts` 與 `comment-reply-intake.test.ts` 有並行的案例。

**顧客回覆私訊。** 顧客回覆時，`attachCommentOrigin()` 找同一個渠道、`recipientUid` 等於發送者、狀態 SENT、還沒關聯對話、30 天內送出的最新一筆紀錄，關聯紀錄與對話，並在對話補入「來自留言」的系統訊息與私訊快照。每筆紀錄只關聯一次。私訊進站建立聯絡人時，`inbound-contact-resolver.ts` 以 `findCommentAuthorContact()` 沿用留言者的聯絡人。

**外掛差異。** 渠道之間的差異只經外掛的 `extensions.comments`，`comment-reply` 模組不比對 `channelType`。

**個資。** 留言內容、留言者名稱、PSID 都是個資。資料匯出（`apps/workers/src/handlers/data-export.handler.ts`）、資料刪除（`data-erasure.handler.ts`）與聯絡人合併（`contact-merge.service.ts`）涵蓋留言自動私訊的資料，例如 `comment_reply_rules`、`comment_reply_logs`、`comment_authors`。新增欄位時，這三處一起改。

## 畫面怎麼呼叫 API

租戶頁是 `/dashboard/comment-replies`（`apps/web/src/app/dashboard/comment-replies/page.tsx`），有「規則」與「觸發紀錄」兩個分頁（`?tab=logs`）。規則的編輯頁是 `/dashboard/comment-replies/new` 與 `/dashboard/comment-replies/[ruleId]`。

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 頁面頂端的前置條件卡 | `GET /readiness` | 每個渠道向 Meta 查訂閱狀態，結果快取 5 分鐘，每次查詢 3 秒逾時 |
| 前置條件卡的「開啟留言接收」與關閉 | `POST`、`DELETE /channels/:channelId/subscribe-comments` | 需要 `channel.update` 與 `comment_reply.view`。寫 `channel.comment_subscription.update` 稽核 |
| 規則分頁 | `GET /rules` | 見[規則](#規則)的警示與 `canEdit` |
| 「新增規則」、點規則進編輯頁 | `POST /rules`、`PATCH /rules/:id` | 需要 `comment_reply.manage` 與渠道層級 `full` |
| 列表的啟用開關、排序、刪除 | `PATCH /rules/:id/active`、`PUT /rules/order`、`DELETE /rules/:id` | 需要 `comment_reply.manage` |
| 規則頁的「試算」 | `POST /rules/test` | 需要 `comment_reply.view`。不寫資料 |
| 規則編輯器的素材下拉 | `GET /material-options?channelId=` | 見[規則](#規則) |
| 規則編輯器的指定貼文 | `GET /channels/:channelId/posts`、`POST /channels/:channelId/posts/resolve` | 平台沒開該平台的貼文挑選能力（`fbPostPicker`、`igPostPicker`）時回 403，只能手動填貼文 ID |
| 觸發紀錄分頁 | `GET /logs`、`GET /logs/summary`、`GET /logs/:id` | 詳情的 `conversationId` 只在檢視者有 `inbox.view` 而且看得到渠道時回傳 |
| 紀錄的「重試」 | `POST /logs/:id/retry` | 在同一個交易把紀錄改回 PENDING、排入送出工作、寫 `comment_reply.log.retry` 稽核 |
| 平台後台 `/admin/comment-reply` | `PUT /api/v1/platform/settings/commentReply.*`、`GET /api/v1/platform/comment-reply/health` | 見下方各節 |

操作手冊還沒有寫。

## 三層開關

一則留言要能觸發私訊，三層都要通過。路由與背景（收件、送出）各自檢查，平台改設定後已排隊的工作也會在送出前重新檢查。

| 層 | 設定位置 | 關閉時 |
| --- | --- | --- |
| 方案功能 `comment_reply` | `/admin/plans` 勾選（`packages/core/src/rbac/features.ts`）。租戶沒有方案時視為開啟 | 路由回 403，`details.reason` 是 `PLAN_FEATURE_NOT_INCLUDED`；收件不建紀錄；已排隊的工作記 `SKIPPED`／`PLAN_FEATURE_DISABLED` |
| 平台能力 `commentReply.capabilities` | `/admin/comment-reply` | 私訊能力關閉：該平台收件不建紀錄、已排隊的工作記 `SKIPPED`／`CAPABILITY_DISABLED`、不能建立該平台的規則（403 `CAPABILITY_DISABLED`）。貼文挑選關閉：貼文清單與網址解析回 403。公開回覆關閉：規則不能開公開回覆（400），已開的規則送出時公開回覆記 `SKIPPED` |
| 緊急停止 `commentReply.emergencyStop` | `/admin/comment-reply` | 所有渠道收件不建紀錄；已排隊的工作記 `SKIPPED`／`EMERGENCY_STOPPED`；租戶頁顯示「平台暫停中」。資料保留 |

方案檢查只有一份：`comment-reply-plan.ts` 的 `isCommentReplyPlanEnabled()`（背景收件、送出與 Meta 連結新粉專時決定是否訂 `feed` 共用）。既有方案部署後都不含 `comment_reply`（沒有方案資料 migration），功能對所有租戶不生效，直到平台勾選。

方案上限：`maxCommentReplyRules`（啟用中的規則數，建立或啟用時檢查，403 `PLAN_LIMIT_EXCEEDED`）、`monthlyCommentReplies`（每月私訊數，送出前原子扣減，超過記 `SKIPPED`／`PLAN_QUOTA_EXCEEDED`，升級後可重試）。沒有設定＝無上限。

## 5 個平台設定鍵

沿用 `GET/PUT /api/v1/platform/settings/:key`。這 5 個鍵在路由內以 Zod 驗證（`parseCommentReplySettingValue()`），不合法回 400、不寫入；寫入沿用 `setting.update` 平台稽核（只記鍵名）。

| 鍵 | 值 | 沒有設定時 |
| --- | --- | --- |
| `commentReply.capabilities` | `{ fbPrivateReply, fbPostPicker, fbPublicReply, igPrivateReply, igPostPicker, igPublicReply }`，全部布林、不可多欄位 | 全部 `false` |
| `commentReply.testPhase` | `{ fb, ig }` 布林 | `{ fb: true, ig: true }` |
| `commentReply.emergencyStop` | `{ stopped: boolean, reason?: string（最多 200 字） }` | `{ stopped: false }` |
| `commentReply.rateLimits` | `{ fbPerHour, igPerHour, publicReplyPerHour }`，整數 1～30000 | `{ 700, 700, 300 }` |
| `commentReply.logRetentionDays` | 整數 30～730 | `180` |

讀取端 `readCommentReplyPlatformSettings()` 在每個 API 實例程序內快取 60 秒；平台寫入後清掉寫入那個實例的快取，其他實例最多 60 秒後生效（緊急停止「60 秒內生效」就是這個意思）。資料庫裡存的是舊的不合法值時，讀取端用預設值。

**測試階段**（`testPhase`）不擋處理，只影響兩件事：租戶頁的測試階段卡，以及平台模式渠道的權限類錯誤記成 `APP_NOT_APPROVED`（Meta App 審核通過前只有 App 角色內的帳號收得到私訊）。自備 App 的渠道與 IG 手動權杖渠道不適用。

## `/admin/comment-reply` 頁

- **設定區**：上表 5 個鍵的表單（不手打 JSON），範圍錯誤在欄位下顯示。
- **健康區**：`GET /api/v1/platform/comment-reply/health`（平台 guard、`prismaAdmin`、不呼叫 Meta）。回傳全平台 24 小時的命中數、送出數、失敗率、`comment-reply` 佇列各狀態數量（Redis 讀不到時是 null）、最舊的處理中紀錄時間，以及每個開啟留言接收的渠道：租戶、模式（平台／自備 App）、訂閱狀態、權杖狀態、最後收到留言的時間、啟用規則數、24 小時送出／失敗／排隊數、最常見的失敗原因。

## 背景工作與告警

| 名稱 | 行程 | 頻率 | 做什麼 |
| --- | --- | --- | --- |
| `comment-reply` 佇列 | API（`startQueueWorkers()`，concurrency 5） | — | 送出私訊與公開回覆。業務失敗（例如 551）讓 job 正常完成，只有系統錯誤才讓 job 失敗重試（attempts 5、指數退避 10 秒）。平台佇列監控頁列出這個佇列 |
| `comment-reply-recover` | API 排程 | 5 分鐘 | PENDING 超過 10 分鐘沒有進展、SENDING 超過 2 分鐘 → 重新排入（消費者以 `status='PENDING'` 認領，重複排入無害）；留言時間超過 7 天（含 10 分鐘安全邊際）→ `EXPIRED`／`WINDOW_EXPIRED` |
| `comment-reply-health` | API 排程 | 5 分鐘 | 同步 Redis 的最後留言時間到渠道設定；發 ops-alert（見下表） |
| `comment-reply-retention` | API 排程 | 每小時 | 刪除早於 `logRetentionDays` 的紀錄（每批 5,000 筆、單次最多 60 秒）；每月用量保留 25 個月 |
| `meta-token-health` | API 排程（既有） | 6 小時 | 另外對開啟留言接收的渠道查訂閱欄位，寫 `settings.commentReply.subscription` |

| 告警鍵 | 條件 | 另通知租戶管理員 |
| --- | --- | --- |
| `comment-reply-auth:<channelId>` | 15 分鐘內 `TOKEN_EXPIRED`／`PERMISSION_MISSING` ≥ 3 | 是 |
| `comment-reply-failure-rate:<channelId>` | 15 分鐘內失敗 ≥ 20 且失敗率 > 50%（排除顧客端原因） | 否 |
| `comment-reply-stuck` | 非限流排隊的 PENDING 超過 30 分鐘 | 否 |
| `comment-reply-expiring` | PENDING 的留言時間超過 6 天 | 否 |
| `comment-reply-subscription:<channelId>` | 開了接收、有啟用規則，但訂閱缺 `feed`／`comments` | 是 |
| `meta-webhook-signature` | 5 分鐘內 Meta webhook 驗簽失敗 ≥ 50 | 否 |
| `queue-failed:comment-reply` | 既有佇列失敗告警 | 否 |

## Runbook

UAT 就是正式環境。下列每一步凡是寫入（改設定、跑腳本 `--apply`、改 Meta App）都要先取得使用者同意。

### 留言沒有觸發私訊

1. 租戶頁「留言自動私訊」的前置條件卡：渠道有沒有開啟留言接收、權杖與權限、測試階段、方案。
2. 觸發紀錄有沒有這則留言：
   - **沒有紀錄**：留言沒命中規則，或收件在前置檢查就停了。依序確認：緊急停止、平台能力（`fbPrivateReply`／`igPrivateReply`）、租戶方案含 `comment_reply`、租戶與渠道啟用、渠道有啟用規則、規則的關鍵字與指定貼文（用規則頁的「試算」，它與收件用同一份規則查詢與比對）。都對的話看 Meta 有沒有送事件：健康區的「最後收到留言的時間」、渠道的訂閱狀態（缺 `feed` 就是 Meta 沒在送）。粉專自己的留言一律不處理。
   - **有紀錄**：看狀態與原因。`SKIPPED_DUPLICATE` 是同一位留言者已私訊過（規則的「每人一次」）；`APP_NOT_APPROVED` 是審核前對象不在 App 角色內；`USER_UNAVAILABLE` 是顧客封鎖或關閉訊息。可重試的原因可在紀錄頁按「重試」。
3. webhook 的分派警示：渠道卡片出現 `comment_intake_failed` 表示收件丟錯，查 API 日誌 `[Webhook] 留言收件失敗`（日誌不含留言內容，只有渠道與數量）。

### 緊急停止

私訊內容出錯、收到 Meta 反垃圾警告時：`/admin/comment-reply` 打開「緊急停止」並填原因。60 秒內所有實例生效，新留言不建紀錄、已排隊的工作記 `SKIPPED`／`EMERGENCY_STOPPED`，既有私訊收發不受影響。解除後不會補送停止期間的留言。只想停一個平台或一項能力時，改關對應的能力開關。

### webhook 被 Meta 停用或訂閱被取消

症狀：健康區某渠道的訂閱狀態是 `missing`、`comment-reply-subscription` 告警、最後收到留言的時間停住。

1. 先確認既有私訊還收得到（同一個 App 訂閱；若私訊也停了，是 App 或權杖層級的問題，先處理渠道的權杖失效）。
2. 租戶在渠道端關閉再開啟留言接收，或經同意跑補訂閱腳本：
   ```bash
   # 在 apps/api，DATABASE_URL 指向 owner 或 app_admin；預設 dry-run，只列出目前與會送出的欄位
   npx tsx src/scripts/comment-reply-subscriptions.ts --mode resubscribe --channel <channelId>
   npx tsx src/scripts/comment-reply-subscriptions.ts --mode resubscribe --channel <channelId> --apply
   ```
   腳本一律送完整欄位（FB：4 個私訊欄位＋`feed`；IG：`messages`＋`comments`），寫入前後各查一次訂閱欄位印出對照，單一渠道失敗不中斷，但只要有渠道失敗，最後的結束碼就是 1（看最後一行「完成：成功 N、失敗 M」）；不輸出權杖。
3. 平台 App 本身被 Meta 停用 webhook 時，要到 Meta App 後台重新驗證回呼網址（需使用者本人操作）。

### 大量 PENDING

1. 健康區看佇列數量與最舊的處理中紀錄時間。
2. `reasonCode = RATE_LIMIT_QUEUED` 的 PENDING 是限流排隊（每渠道每小時上限來自 `commentReply.rateLimits`，或 Meta 回限流後暫停），會自己消化，不算卡住。
3. 其他 PENDING 超過 10 分鐘會被 `comment-reply-recover` 重新排入；若一直不減少，檢查 API 行程的佇列 Worker 是否在跑（平台佇列監控頁的 `comment-reply`）、Redis 是否正常。
4. 留言時間接近 7 天的紀錄會被標成 `EXPIRED`（Meta 不允許私訊超過 7 天的留言），無法補救。
5. `feed` 事件量拖慢 webhook 時：緊急停止，再對受影響渠道關閉留言接收（或經同意跑腳本 `--mode disable`，只留私訊欄位）。

### 部署後要做的事

新增了 `comment_reply.view`、`comment_reply.manage` 兩個權限碼：執行 `scripts/reconcile-system-role-permissions.mjs`（或 `grant-new-role-permissions.mjs comment_reply.view comment_reply.manage`），再 SCAN＋DEL Redis 的 `perms:tenant:*`。部署後平台設定沒有任何鍵，能力全關，功能對所有租戶不生效。
