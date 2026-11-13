# 留言自動私訊的平台控制

營運方怎麼控制「FB／IG 貼文留言關鍵字自動私訊」：哪些租戶能用、哪些能力開放、怎麼緊急停止、怎麼看健康狀況，以及出事時的處理步驟。租戶端的規則與觸發紀錄見 `.claude/skills/feature-comment-reply/SKILL.md`；渠道外掛的留言擴充見[渠道外掛](../../modules/CHANNEL-PLUGINS.md#留言擴充)。

- **資料來源**：`apps/api/src/modules/comment-reply/comment-reply-platform-settings.ts`、`comment-reply-entitlement.ts`、`comment-reply-health.ts`、`comment-reply-maintenance.flow.ts`、`comment-reply.scheduler.ts`、`apps/api/src/modules/platform/comment-reply-health.service.ts`、`platform.routes.ts`、`apps/web/src/app/admin/comment-reply/page.tsx`、`apps/api/src/scripts/comment-reply-subscriptions.ts`
- **核對日期**：2026-11-14（change `add-comment-keyword-private-reply`，尚未部署）

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
   腳本一律送完整欄位（FB：4 個私訊欄位＋`feed`；IG：`messages`＋`comments`），寫入前後各查一次訂閱欄位印出對照，單一渠道失敗不中斷，不輸出權杖。
3. 平台 App 本身被 Meta 停用 webhook 時，要到 Meta App 後台重新驗證回呼網址（需使用者本人操作）。

### 大量 PENDING

1. 健康區看佇列數量與最舊的處理中紀錄時間。
2. `reasonCode = RATE_LIMIT_QUEUED` 的 PENDING 是限流排隊（每渠道每小時上限來自 `commentReply.rateLimits`，或 Meta 回限流後暫停），會自己消化，不算卡住。
3. 其他 PENDING 超過 10 分鐘會被 `comment-reply-recover` 重新排入；若一直不減少，檢查 API 行程的佇列 Worker 是否在跑（平台佇列監控頁的 `comment-reply`）、Redis 是否正常。
4. 留言時間接近 7 天的紀錄會被標成 `EXPIRED`（Meta 不允許私訊超過 7 天的留言），無法補救。
5. `feed` 事件量拖慢 webhook 時：緊急停止，再對受影響渠道關閉留言接收（或經同意跑腳本 `--mode disable`，只留私訊欄位）。

### 部署後要做的事

新增了 `comment_reply.view`、`comment_reply.manage` 兩個權限碼：執行 `scripts/reconcile-system-role-permissions.mjs`（或 `grant-new-role-permissions.mjs comment_reply.view comment_reply.manage`），再 SCAN＋DEL Redis 的 `perms:tenant:*`。部署後平台設定沒有任何鍵，能力全關，功能對所有租戶不生效。
