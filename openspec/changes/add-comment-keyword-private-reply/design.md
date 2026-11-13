## Context

粉專與 IG 的貼文留言目前完全不進系統：webhook 只讀 `entry.messaging[]`，`entry.changes[]` 被丟掉。本 change 讓租戶設定「留言關鍵字規則」，
命中時以 Meta Private Replies（Send API `recipient: { comment_id }`，每則留言一次、7 天內）私訊留言者，選擇性公開回覆留言，並留下看得到的觸發紀錄。

本文件把 `planning/` 五份規劃彙整成定案。優先順序：

1. `proposal.md`「決定」1～8（2026-11-13 使用者拍板）。
2. 程式結構、租戶隔離、TenantCtx＋flow、消費者行程：以 `planning/02-architecture.md` 為準。
3. 資料表、索引、RLS、容量、保存期限、告警、上線回滾：以 `planning/03-sre-db.md` 為準，但配合 02 的結構調整（取捨寫在各節）。
4. Meta 權限與送審：`planning/04-meta-app-review.md`。驗收情境：`planning/05-qa.md`（本文件逐一定案其 §8.1 的 A1～A24）。

從 main 讀到、影響設計的現況（細節見 02 §0）：

- 新背景工作慣例是「API 行程消費的佇列＋outbox 排入」（`coupon-broadcast`）：service 收 `TenantCtx`，flow 以 `inTenant()` 開交易，outbox 與資料同交易。
- workers 行程只有 BYPASSRLS 連線；權限天花板只作用在 HTTP 路由，背景工作沒有 feature 檢查。
- `routeWebhookMessages()`／`routePlatformMessages()` 只用到 `accountId`，可改泛型讓留言沿用同一套分派。
- 關鍵字比對已抽到 `@open333crm/automation` 的 `matchKeywordTrigger()`。
- FB 外掛 `sendMessage()` 寫死 `recipient: { id }`、丟掉 Meta 回應的 `recipient_id`。
- IG 渠道走 Instagram Login（`graph.instagram.com`），系統從未呼叫 IG 的 `subscribed_apps`。
- Meta 連結精靈 `SUBSCRIBED_FIELDS` 只有 4 個 messaging 欄位；`POST /{page-id}/subscribed_apps` 是**取代**不是附加。
- 平台設定已有 `GET/PUT /api/v1/platform/settings/:key`（寫 `setting.update` 稽核），有型別的鍵在路由內單獨驗證。
- API 的 `job-scheduler.ts`（BullMQ Job Scheduler，`api-scheduler` 佇列）可註冊多個排程，每期只有一個實例執行。

## Goals / Non-Goals

**Goals**

- FB 粉專與 IG 專業帳號的新留言命中規則時，自動私訊留言者一次；可選公開回覆。FB、IG、公開回覆同一版完成程式（決定 1、2、7）。
- 同一則留言最多私訊一次；7 天外不送；同一位留言者在同一規則預設只私訊一次。
- 每則命中的留言都有看得到的紀錄與原因代碼；失敗不能只寫 log。
- 留言命中就建立（或沿用）聯絡人；私訊成功後以 `recipient_id` 接上同一人，不留下重複聯絡人（決定 4、5）。
- 顧客回覆私訊後，收件匣看得到「來自留言」與補入的私訊。
- 方案 feature `comment_reply` 與兩個上限，由平台在 `/admin/plans` 開關與設定；每個上限都有檢查點（決定 3、6）。
- 平台層：能力開關、測試階段旗標、緊急停止、限速、保存天數、`/admin/comment-reply` 健康頁（決定 7、8）。
- 補訂閱與重新連結永遠帶完整欄位，不讓私訊訂閱被蓋掉。

**Non-Goals**

- IG 直播留言（`live_comments`）、FB 留言編輯（`verb=edited`）不處理。
- 不回填歷史留言、不用 Graph API 掃舊留言補私訊。
- 不呼叫 AI、不新增渠道類型。
- 關鍵字回覆（`matchKeywordTrigger`）不改成 NFKC（另開 change，見 Open Questions）。
- 規則活動期間、觸發紀錄匯出 CSV、刪除公開回覆：第二版。
- 不做租戶層級的 feature 覆寫；不做灰度名單（以方案＋能力開關取代，見 D22）。

## Decisions

### D1：消費者在 API 行程，outbox 排入（A1、A2 前半）

- **決定**：新佇列 `comment-reply`，由 API 行程消費；收件 flow 以 `enqueueJob(scope, 'comment-reply', { tenantId, logId })` 寫 outbox，
  與紀錄同一個 `inTenant()` 交易。job 名稱 `deliver`，job id 由 outbox 決定（outbox id）。concurrency 5；`attempts: 5`、
  exponential backoff 10 秒；`removeOnComplete: { age: 86400 }`、`removeOnFail: { age: 604800 }`。加進 `API_QUEUES`（自動進 `ALERTED_QUEUES`）。
  `apps/workers` 不放新的消費程式（只修改既有 data-erasure、data-export handler，見 D27）。
- **理由**：與 `coupon-broadcast` 同模式；`fastify.prisma`（app_tenant）受 RLS；可直接用 API 端素材渲染、聯絡人 service、渠道可見範圍。
- **其他選項**：workers 消費（03、00）——只有 BYPASSRLS 連線，聯絡人與素材要在 workers 再寫一份；webhook 背景直接送——無重試、無法限流。

### D2：遺失的 job 由 API 排程補回，不新增 sweeper 佇列（A2 後半、佇列數量）

- **決定**：outbox relay 處理「job 沒進 Redis」。另在 API `job-scheduler` 註冊 `comment-reply-recover`（每 5 分鐘、`withoutOverlapping`）：
  1. `status='PENDING'` 且 `coalesce(nextAttemptAt, updatedAt) < now − 10 分鐘` → 以 `enqueueJob()` 再排一次（消費者冪等，重複無害）。
  2. `status='SENDING'` 且 `sendAttemptedAt < now − 2 分鐘` → 再排一次（走 D9 的當機復原）。
  3. `PENDING`／`SENDING` 且留言時間超過 7 天 → `EXPIRED`。
  掃描以 `prismaAdmin` 跨租戶只讀出 `(tenantId, logId)`，寫入一律逐租戶 `inTenant()`。
- **理由**：03 的兩個 workers repeating 佇列（sweeper、retention）是因為 workers 的 `registerRepeatingJobs()` 一個佇列只能放一個 repeating job；
  API 的 job-scheduler 沒有這個限制，且 D1 已把消費者放在 API 行程。結果：新佇列只有 1 個（`comment-reply`），排程掛在既有 `api-scheduler`。
- **其他選項**：03 的 `comment-reply-sweeper`、`comment-reply-retention` 兩個 workers 佇列——要在 workers 寫跨租戶寫入，與 D1 衝突。

### D3：webhook 只做最少的事；API 關機等背景處理完成（03 R1、05 §8.1 附註）

- **決定**：`/webhooks/meta`、`/webhooks/fb/:id`、`/webhooks/threads/:id` 維持先回 200、背景處理。背景處理以一個程序內的
  in-flight 集合追蹤；Fastify `onClose` 等待集合清空，最多 10 秒。留言的背景工作只有：解析、分派、讀規則（快取）、比對、命中才寫入。
- **理由**：部署重啟時 Meta 不會重送已回 200 的事件；私訊早有同樣缺口，這個改動一併改善。
- **其他選項**：webhook 內同步寫入再回 200——拉長回應，`feed` 量大時有被 Meta 停用訂閱的風險（私訊一起斷）。

### D4：比對在收件時做，只記命中的留言

- **決定**：收件 flow 讀該渠道啟用中規則（程序內快取 30 秒，規則異動時以 Redis 版本號 `cr:rules-ver:<channelId>` 失效），
  以純函式比對；沒命中不寫任何資料。消費者送出前再確認規則仍啟用（D8）。
- **理由**：佇列量只等於命中數（03 §9.3-1 的容量估算成立）；紀錄頁只列命中的留言（UX §4.2）。

### D5：外掛契約 `extensions.comments`

- **決定**：在 `ChannelPlugin.extensions` 加選用 `comments: ChannelCommentExtension`（型別見「外掛契約」）。能力判斷一律看
  `plugin.extensions?.comments` 是否存在與 `capabilities`，不比對 `channelType`（結構規則 5）。FB、IG 外掛實作；API 與 workers 的
  registry 掛的是同一個實例，加一個單元測試斷言兩邊都有。Meta 錯誤碼正規化在外掛內完成（`MetaErrorInfo.reason`／`transient`）。
- **理由**：沿用 `extensions.{ui,audience,analytics}` 模式；FB／IG 差異（IG 只能文字、沒有素材）以宣告表達。
- **其他選項**：在 `ChannelPlugin` 頂層加 7 個方法——所有外掛都要寫空實作。

### D6：FB 私訊抽出 `postMessage()`，先補特性測試

- **決定**：FB 外掛把 `sendMessage()` 的組 body、站內路徑換公開網址抽成私有 `postMessage(recipient, payload, credentials)`；
  `sendMessage()` 與 `sendPrivateReply()` 共用。**重構前**先補 `facebook-send-message.test.ts`，斷言 `recipient: { id }`、`messaging_type`
  與 body 其他欄位（目前沒有直接斷言）。`sendPrivateReply()` 不帶 `messaging_type`，回傳 `recipient_id`、`message_id`。

### D7：資料模型以 03 為基礎，配合 02 調整（A3、A14、A17）

- **決定**：新增 4 張租戶表 `comment_reply_rules`、`comment_reply_logs`、`comment_authors`、`comment_reply_usages`；
  `conversations` 加 `originCommentReplyLogId`。不做 `comment_reply_posts`。紀錄**不存 `contactId`**，改存 `commentAuthorId`
  （NOT NULL，FK Restrict），聯絡人經 `comment_authors.contactId` 取得（Prisma 片段見「資料模型」）。
- **理由**：
  - 決定 5 要求命中就建聯絡人，且 FB 留言者 ID 不保證等於 PSID → 需要 03 的 `comment_authors` 記「留言者 → 聯絡人、PSID」。
  - 紀錄只經留言者連到聯絡人：One ID 合併／解除合併只多搬一張表（`comment_authors`），不必搬紀錄（取 02 的「紀錄不存 contactId」精神）。
  - `commentAuthorId` Restrict：硬刪聯絡人前若 erasure 沒先處理紀錄，交易直接失敗（03 §7.2 的「刻意失敗」改由這條外鍵擔任）。
  - 對話來源用欄位（03）不用 `metadata.origin`（02）：可建索引，日後「來自留言」篩選用得到。補進對話的訊息仍以 `metadata.source` 標記（02）。
  - 貼文摘要快取表不做（02）：FB `pages_read_engagement` 未過審時這張表只會有 `unavailable` 列；紀錄頁顯示貼文 ID 與 Meta 連結，
    規則存檔時帶的貼文快照只做顯示。
- **其他選項**：紀錄存 `contactId`（03）——合併要多搬一張表，且與 `comment_authors.contactId` 可能不一致。

### D8：狀態機與原因代碼單一來源（A6）

- **決定**：狀態 enum `CommentReplyStatus`：`PENDING`、`SENDING`、`SENT`、`FAILED`、`EXPIRED`、`SKIPPED`、`SKIPPED_DUPLICATE`。
  原因代碼存 TEXT，列舉與中文對照放 `packages/shared/src/comment-reply.ts`（前後端同源），未知代碼前端顯示通用失敗文字。

| 狀態 | `reasonCode` |
| ---- | ---- |
| `PENDING` | null；`RATE_LIMIT_QUEUED`（限流排隊，前端顯示「排隊中」） |
| `SENT` | null；`SENT_UNCONFIRMED`（當機復原時 Meta 回已私訊過，前端顯示「可能已送達」） |
| `SKIPPED` | `RULE_INACTIVE`、`MATERIAL_UNAVAILABLE`、`MATERIAL_UNSUPPORTED`、`PLAN_FEATURE_DISABLED`、`CAPABILITY_DISABLED`、`EMERGENCY_STOPPED`、`PLAN_QUOTA_EXCEEDED`、`CHANNEL_INACTIVE`、`TENANT_DISABLED` |
| `EXPIRED` | `WINDOW_EXPIRED`（系統判斷）、`EXPIRED_BY_META`（Meta 回超過期限） |
| `FAILED` | `TOKEN_EXPIRED`、`PERMISSION_MISSING`、`APP_NOT_APPROVED`、`USER_UNAVAILABLE`、`COMMENT_NOT_FOUND`、`ALREADY_REPLIED`、`RECIPIENT_IS_PAGE`、`RATE_LIMITED`、`NETWORK`、`UNKNOWN` |
| `SKIPPED_DUPLICATE` | null（詳情帶 `holderLogId`） |

  公開回覆子狀態 `publicReplyStatus`：`NOT_CONFIGURED`、`PENDING`、`SENDING`、`SENT`、`FAILED`、`SKIPPED`；原因
  `PRIVATE_REPLY_NOT_SENT`、`CAPABILITY_DISABLED`、`RATE_LIMITED`、`PERMISSION_MISSING`、`UNKNOWN_AFTER_CRASH`、`UNKNOWN`。
- **取捨**：保留 02 的 `SENDING` 狀態（D10 的去重鎖要靠它），同時保留 03 的 `sendAttemptedAt`（進入 SENDING 時寫入，當機復原判斷用）。
  名稱取 03 的 `PLAN_FEATURE_DISABLED`、`PLAN_QUOTA_EXCEEDED`（明確指出是方案）；Meta 超過期限歸 `EXPIRED`（使用者看到的狀態與系統判斷一致）。
  灰度相關的 `ROLLOUT_DISABLED` 不用（D22），改為 `EMERGENCY_STOPPED` 與 `CAPABILITY_DISABLED`。

### D9：冪等三層與當機復原（A7）

- **決定**：
  1. 收件：`UNIQUE (channelId, commentId)`，`INSERT … ON CONFLICT DO NOTHING`；沒插入就不排 job、不建聯絡人。
  2. 消費者認領：`UPDATE … SET status='SENDING', sendAttemptedAt=now WHERE id=? AND status='PENDING'`，更新 0 列就結束。
  3. 當機復原：認領時遇到 `SENDING` 且 `sendAttemptedAt < now − 2 分鐘`，視為上次送出途中中斷，再送一次：Meta 成功 → 正常 `SENT`；
     Meta 回 `ALREADY_REPLIED` → `SENT`＋`SENT_UNCONFIRMED`、`recipientUid` 留空、名額不還。Meta 每則留言只允許一次私訊，所以不會重複送達。
- **取捨**：02 的 2 分鐘逾時＋03 的 `sendAttemptedAt` 語意合併；不需要分散式鎖。

### D10：同一位留言者只私訊一次——送出時才佔名額（A8）

- **決定**：規則開 `dedupePerCommenter` 時，收件寫 `dedupeKey = <ruleId>:<commenterId>`；部分唯一索引
  `(dedupeKey) WHERE dedupeKey IS NOT NULL AND status IN ('SENDING','SENT')`。消費者 PENDING→SENDING 撞唯一鍵時讀持有者：
  持有者 `SENT` → 本筆 `SKIPPED_DUPLICATE`（記 `holderLogId`）；持有者 `SENDING` → job 延後 30 秒再判斷（不寫終態）。
  `FAILED`、`EXPIRED` 不佔名額。
- **理由**：前一則失敗（顧客封鎖、權杖過期）時，後一則仍應嘗試（02）。03 的「收件時以 PENDING 佔名額」會讓第二則在第一則失敗前就被判重複。
- **取捨**：範圍是同一條規則；規則刪除後重建是新規則（會再私訊）。FB `commenterId` 是 feed 的 `from.id`，與 PSID 是否相同不影響去重。

### D11：每月私訊數用計數表原子扣減（A5）

- **決定**：`comment_reply_usages (tenantId, month)`，`month` 為台灣時間 `YYYY-MM`（`taipeiMonthStart()`）。消費者在認領交易內：
  `INSERT … ON CONFLICT DO NOTHING` 後 `UPDATE … SET sentCount = sentCount + 1 WHERE … AND ($limit IS NULL OR sentCount < $limit) RETURNING`；
  沒回傳列 → `SKIPPED`/`PLAN_QUOTA_EXCEEDED`（可重試）。紀錄記 `quotaMonth`，同一筆紀錄只扣一次（重試不重扣）。
  Meta **明確拒絕**（`USER_UNAVAILABLE`、`COMMENT_NOT_FOUND`、`RECIPIENT_IS_PAGE`、`ALREADY_REPLIED` 且非當機復原、`PERMISSION_MISSING`、
  `APP_NOT_APPROVED`、`TOKEN_EXPIRED`）→ 同一交易還名額、清 `quotaMonth`。網路逾時等不確定是否送達 → 不還。公開回覆只累計 `publicReplyCount`，不設上限。
- **理由**：保存期限清除後 `COUNT(*)` 會變少；計數表一次 `UPDATE … RETURNING` 就能原子地先佔再送（03）。02 的 advisory lock＋即時 count 被取代。
- **其他選項**：02 的 `count(SENT+SENDING)`＋advisory lock——與保存期限衝突。

### D12：限流——Redis token bucket、數字來自平台設定、不消耗重試次數（A9、A10）

- **決定**：每個渠道一個 token bucket（Redis Lua，`cr:rate:pm:<channelId>`），補充速率＝`rateLimits.fbPerHour`／`igPerHour` ÷ 3600 每秒，
  容量＝每小時上限 ÷ 12；公開回覆另一個 bucket（`cr:rate:pr:<channelId>`，`publicReplyPerHour`）。預設 FB 700、IG 700、公開回覆 300。
  - 私訊 bucket 空：紀錄維持 `PENDING`、`reasonCode='RATE_LIMIT_QUEUED'`、`nextAttemptAt`＝下一個 token 時間；`job.moveToDelayed()`＋`DelayedError`，不消耗 attempts。
  - Meta 回限流（code 4、17、32、613、80001～80014）：讀 `X-Business-Use-Case-Usage` 的 `estimated_time_to_regain_access` 暫停該渠道 bucket，
    同上延後；同一筆紀錄累計 10 次 Meta 限流回應 → `FAILED`/`RATE_LIMITED`（可重試）。
  - 公開回覆 bucket 空：`publicReplyStatus=SKIPPED`、`RATE_LIMITED`，不延後私訊。
- **理由**：固定時窗（02）在整點前後可能 2 分鐘送出 1,400 則，超過 Meta 的每小時 750；token bucket 平滑（03）。限流是 Meta 的正常行為，
  不能吃掉 attempts、不能觸發 `queue-failed` 告警。數字放平台設定，平台頁可調（決定 8）。
- **其他選項**：BullMQ 群組限速——付費版功能。

### D13：失敗分類——業務失敗完成 job，系統錯誤才讓 job 失敗（RL-06、RL-07）

- **決定**：外掛回 `{ ok:false, error }` 時：`transient`（`NETWORK`）且 `attemptsMade < attempts − 1` → 紀錄退回 `PENDING`、丟錯讓 BullMQ 退避重試；
  最後一次 → `FAILED`/`NETWORK`、job 正常完成。非 transient → 直接 `FAILED` 並完成 job。只有資料庫或程式例外丟出，重試用完進 failed set，
  `failed-alerts.ts` 發 ops-alert。紀錄的失敗一律寫進資料庫（後台看得到）。

### D14：7 天期限含 10 分鐘安全邊際（A20）

- **決定**：`now − commentCreatedAt ≥ 7 天 − 10 分鐘` → `EXPIRED`/`WINDOW_EXPIRED`，不呼叫 Meta。FB 用 `created_time`（Unix 秒）；
  IG 事件沒有留言時間，用 `entry.time` 並記 `createdAtSource='notification'`（Meta 重投最長 36 小時，誤差可接受）。後台重試同樣檢查。
- **理由**：避免排隊或時鐘誤差剛好跨過期限，Meta 回錯誤反而浪費一次呼叫。邊際值寫成常數並有測試釘住（EX-02）。

### D15：方案降級後超過規則上限——全部照常生效、只擋啟用（A13）

- **決定**：`maxCommentReplyRules` 只在「建立啟用規則、停用改啟用、PATCH 把 isActive 改 true」檢查；降級後已啟用的規則照常比對，
  規則列表帶 `OVER_PLAN_LIMIT` 警示，`readiness.quota` 顯示超出。每月私訊數仍由 D11 擋住實際送出。
- **理由**：與 `maxChannels`「只擋新建」一致；02 的「只套前 N 條」會讓規則看起來啟用卻不生效（03）。

### D16：聯絡人——命中就建立（或沿用），私訊成功後以 `recipient_id` 接上（決定 4、5）

- **決定**：
  1. **收件交易內**（紀錄插入成功後）找留言者：`comment_authors (channelId, externalUserId=commenterId)` 有 → 沿用其聯絡人，更新 `lastCommentAt`、`commentCount`。
  2. 沒有 → 依序找 `ChannelIdentity (channelId, uid=commenterId)`（舊顧客且 ID 相同時）、`resolveUidToContact()`（IdentityMap）；都沒有 → 建立
     `Contact`（`displayName` = FB `from.name`／IG `@username`／`<渠道名稱> User <ID 後 6 碼>`），`comment_authors.createdContact=true`。
     **此時不建 `ChannelIdentity`**（FB 的留言者 ID 不保證可私訊；IG 也等私訊成功再以 `recipient_id` 建，兩邊一致）。
  3. `comment_authors` 以 `INSERT … ON CONFLICT (channelId, externalUserId) DO NOTHING` 寫入；衝突表示並行的另一則留言先建了 → 刪掉本交易剛建、
     沒有任何資料的聯絡人，改用先到者。
  4. **私訊成功後（寫 SENT 的同一交易）**：查 `ChannelIdentity (channelId, uid=recipient_id)`：
     - 不存在 → 在留言者的聯絡人下建立（`uid=recipient_id`），`comment_authors.psid = recipient_id`。P2002（顧客回覆的 webhook 先建了）→ 走下一點。
     - 存在且屬於另一位聯絡人 X：留言者的聯絡人 A 若是 `createdContact=true` 且未封存 → 以既有合併引擎把 A 併入 X（`source='COMMENT_REPLY'`，可解除合併）；
       A 是原本就存在的聯絡人 → 不自動合併，只把 `comment_authors.contactId` 改指 X 並記 warning log。
  5. 不呼叫 `getProfile()`；不發 `contact.created`、不送招呼語（D17）。IG 的 `from.id` 與 `recipient_id` 不同時記 `idMismatch` warning，以 `recipient_id` 為準。
- **理由**：決定 5 要求命中就建、私訊成功後接上、不留重複。用既有合併引擎（`contact-management`「Contact Merging」要求所有合併走同一個引擎）
  保留可逆性與合併紀錄；A 在該渠道沒有身分，所以不違反「Merge Rejects Same-Channel Identities」。不在收件時建身分，避免群發把無法私訊的 FB ID 算進受眾。
- **私訊失敗時**：聯絡人只靠 `comment_authors` 找得到。顧客之後自己私訊粉專時，進站流程對新 UID 先查 `comment_authors`（`psid=uid` 或
  `externalUserId=uid`）→ 命中就把身分建在同一位聯絡人（`inbound-contact-resolution` MODIFIED）。FB 若實測 `from.id ≠ PSID` 且私訊失敗，
  這位顧客會成為第二位聯絡人——無法避免，只能人工合併（風險 R4）。
- **其他選項**：02 的「私訊成功才建」——與決定 5 牴觸；收件時就以 `from.id` 建 `ChannelIdentity`——FB 可能建出無法私訊的身分。

### D17：招呼語與 `contact.created`（first-contact-greeting MODIFIED）

- **決定**：留言建立的聯絡人（`comment_authors.createdContact=true`）建立時**不**發 `contact.created`。該聯絡人第一次在任一渠道有進站訊息時，
  以條件更新 `contactEventPublishedAt IS NULL` 認領後發一次 `contact.created`（outbox `publishEvent`）。第一次進站**不送招呼語**
  （不論身分是私訊成功時建的，或進站時才建的）。一般新顧客第一次私訊仍照舊送招呼語。
- **理由**：建立當下沒有對話、在 24 小時視窗外，`contact.created` 觸發的送訊息動作必然失敗；顧客已收到（或應收到）私訊，再送招呼語很吵（02 §6.6 A）。
- **要 MODIFIED 的既有需求**：`first-contact-greeting`「首次進站時送出招呼語」（以未歸檔 `fix-line-follow-unfollow-events` 的版本為底，
  該 change 須先歸檔）、「聯絡人建立時發布 contact.created 事件」。

### D18：收件匣串接——顧客第一次回覆時補入，只關聯一次（A14）

- **決定**：`processInboundMessage()` 建立顧客訊息後、推播前，對有 `extensions.comments` 的渠道呼叫 `attachCommentOrigin(ctx, …)`：
  1. 找 `channelId` 相同、`recipientUid = 發送者 uid`、`status='SENT'`、`conversationId IS NULL`、`sentAt ≥ now − 30 天` 的最新一筆紀錄。
  2. 條件更新 `conversationId`、`customerRepliedAt`（`WHERE conversationId IS NULL`）；0 列表示別的請求已處理。
  3. 插入系統訊息（`createdAt = sentAt − 1ms`，`metadata.source='comment_private_reply'`、`kind='origin_note'`、`logId`）與私訊快照
     （`createdAt = sentAt`，`channelMsgId = 私訊的 message_id`，既有 `UNIQUE (conversationId, channelMsgId)` 擋掉 echo 重複）。
  4. 對話 `originCommentReplyLogId` 為空才寫入（保留第一個來源）。不改 `lastMessageAt`、未讀數。
  5. 失敗只記 error log，顧客訊息照常落地與推播。
  另外，寫 SENT 的交易提交後，若該身分已有對話且第一則進站時間晚於 `sentAt`（顧客回覆比 T2 先到），再呼叫一次 `attachCommentOrigin`；兩條路都靠條件更新只成功一次。
- **理由**：收件匣不會出現大量沒回覆的對話（02）；補入的訊息讓客服看得到顧客在回什麼。

### D19：Meta 連結與補訂閱——一律帶完整欄位（A22）

- **決定**：
  - `meta-connect.service.ts` 匯出 `BASE_SUBSCRIBED_FIELDS = ['messages','messaging_postbacks','messaging_referrals','message_echoes']` 與
    `subscribedFieldsFor(channelSettings)`：`settings.commentReply.receiving === true` 時加 `feed`。`subscribePage()` 改成收欄位清單；首次連結、
    重新連結、補訂閱、關閉接收都經它，送出的 `subscribed_fields` 永遠是完整集合。
  - 渠道設定鍵 `settings.commentReply = { receiving, subscribedAt, subscription: { status, fields, checkedAt }, lastCommentEventAt }`
    （取 02 的 `receiving`：與規則的「啟用」不會混淆）。
  - 新連結的粉專：租戶方案含 `comment_reply` 且平台能力 `fbPrivateReply` 開啟時，預設 `receiving=true` 並訂 `feed`；否則不訂。
  - 重新連結沿用渠道既有 `receiving` 決定欄位。方案移除 feature 時不自動取消訂閱（收件第一步就丟棄）。
  - IG：`POST graph.instagram.com/v21.0/me/subscribed_apps`，`subscribed_fields=messages,comments`（＋既有在用欄位）。權杖需含
    `instagram_business_manage_comments`，舊權杖要重新產生後貼回渠道。
  - 自備 App 的 FB 渠道與 IG 渠道用渠道自己的權杖與 App Secret 算 `appsecret_proof`；App 後台的欄位由該 App 擁有者自己勾。
- **理由**：`POST subscribed_apps` 是取代（04 §3.2）；少帶一個 messaging 欄位就是全租戶私訊中斷，是本功能最大的回歸風險。

### D20：權限點與素材選項（A24）

- **決定**：
  ```ts
  { code: 'comment_reply.view',   group: '留言自動私訊', feature: 'comment_reply', label: '檢視留言自動私訊', description: '規則列表、觸發紀錄、試算、前置條件' },
  { code: 'comment_reply.manage', group: '留言自動私訊', feature: 'comment_reply', label: '管理留言自動私訊',
    description: '建/改/刪規則、排序、啟用、重試、選貼文', dependsOn: ['comment_reply.view'], implies: ['channel.view'] },
  ```
  素材下拉改用本模組的 `GET /api/v1/comment-replies/material-options?channelId=`（`comment_reply.manage`），只回該渠道外掛宣告可用、
  啟用中的素材摘要（id、名稱、類型、預覽文字），不 `implies marketing.view`。
- **理由**：`marketing.view` 會連帶開放群發、受眾等資料，超出需要（最小權限）；方案沒有 marketing feature 時也能選素材。
- **其他選項**：02 的 `implies: ['marketing.view']`——方案沒有 marketing 時被天花板濾掉，素材下拉失效（05 PM-18）。

### D21：平台設定鍵與平台頁（A11、決定 7、8）

- **決定**：沿用 `GET/PUT /api/v1/platform/settings/:key`，新增 5 個有型別的鍵（路由內 Zod 驗證，不合法回 400 不寫入；寫入沿用 `setting.update` 平台稽核）：

| 鍵 | 值 | 沒有設定時 |
| ---- | ---- | ---- |
| `commentReply.capabilities` | `{ fbPrivateReply, fbPostPicker, fbPublicReply, igPrivateReply, igPostPicker, igPublicReply }`（布林） | 全部 `false` |
| `commentReply.testPhase` | `{ fb: boolean, ig: boolean }` | `{ fb: true, ig: true }` |
| `commentReply.emergencyStop` | `{ stopped: boolean, reason?: string(≤200) }` | `{ stopped: false }` |
| `commentReply.rateLimits` | `{ fbPerHour, igPerHour, publicReplyPerHour }`（整數 1～30000） | `{ 700, 700, 300 }` |
| `commentReply.logRetentionDays` | 整數 30～730 | `180` |

  另新增 `GET /api/v1/platform/comment-reply/health`（平台 guard、`prismaAdmin`、不呼叫 Meta，加進 `check-prisma-admin-usage.mjs` 白名單）。
  新頁 `/admin/comment-reply`：設定區（上表五項表單，不手打 JSON）、健康區（D25 的指標）。讀取端程序內快取 60 秒。
- **理由**：平台設定是平台層表、app_tenant 有 SELECT，租戶交易內讀得到；沿用既有端點就不必新增平台稽核動作與標籤。
  分項開關讓「FB 私訊先上、貼文清單／公開回覆／IG 審核後再開」不必重新部署（決定 7）。
- **其他選項**：02 的單一鍵 `meta.commentReply.accessLevel`——無法表達決定 7 的分項開放；專用 PUT 端點——要新增平台稽核動作與標籤。

### D22：三層開關；不做灰度名單（A12）

- **決定**：
  1. **方案 feature** `comment_reply`：路由由權限天花板擋；背景由 `isCommentReplyEnabled(ctx)` 自己查（`planId` 為 null 視為開啟，與權限天花板一致）。
  2. **能力開關**：`fbPrivateReply`／`igPrivateReply` 關閉時，該平台渠道的留言收件不建紀錄、已排隊 job 記 `SKIPPED`/`CAPABILITY_DISABLED`、
     規則 API 不可建立該平台規則（403 `CAPABILITY_DISABLED`）；`*PostPicker` 關閉時貼文清單與網址解析回 403 `CAPABILITY_DISABLED`，指定貼文只能手動填 ID；
     `*PublicReply` 關閉時規則不可開公開回覆（400 `CAPABILITY_DISABLED`），已開的規則送出時公開回覆記 `SKIPPED`/`CAPABILITY_DISABLED`。前端依 `readiness` 隱藏或停用。
  3. **緊急停止**：開啟時所有渠道收件不建紀錄、已排隊 job 記 `SKIPPED`/`EMERGENCY_STOPPED`，60 秒內生效；前端顯示「平台暫停中」並停用編輯。
  **測試階段旗標**只影響顯示（測試階段卡）與錯誤對照（平台模式渠道的權限類錯誤記 `APP_NOT_APPROVED`），不擋處理；只對平台模式渠道有意義，
  自備 App／IG 手動權杖渠道顯示「依你自己的 Meta App 審核狀態」。
- **理由**：決定 6 讓平台以方案決定誰能用，內部測試可把測試租戶放進含 feature 的方案；03 的 allowlist 與方案重疊，且多一套「看得到卻不能用」狀態。

### D23：方案 feature 不需要資料 migration（決定 6）

- **決定**：`packages/core/src/rbac/features.ts` 加 `{ slug: 'comment_reply', label: '留言自動私訊', desc: 'Facebook／Instagram 貼文留言關鍵字自動私訊、公開回覆、觸發紀錄' }`；
  `/platform/registry` 動態提供，平台在 `/admin/plans` 勾選。既有方案預設不含——現況就不含，所以**不寫方案資料 migration**、`SEED_PLANS` 不變。
  上限鍵 `maxCommentReplyRules`、`monthlyCommentReplies` 加進 `LimitKey` 與 `/admin/plans` 的 `LIMIT_KEYS`；方案沒有這個鍵＝無上限（null）。
- **理由**：AGENTS 要求「以 migration 加進既有方案」是為了打開 feature；決定 6 是不打開，沒有要改的列。寫一支空 migration 沒有作用（列在 Open Questions 請使用者確認）。

### D24：稽核（A23）

- **決定**：租戶稽核新增 `comment_reply.rule.create`／`update`／`delete`／`toggle`／`reorder`、`comment_reply.log.retry`、
  `channel.comment_subscription.update`（payload 不含留言內容與名稱）。平台設定沿用 `setting.update`，不新增平台稽核動作。

### D25：維運——健康排程、訂閱檢查、告警（A15、A19）

- **決定**：
  - 收到某渠道留言事件：`SET cr:last-event:<channelId> <ts> EX 2592000`；`comment-reply-health`（API 排程，每 5 分鐘）只在值變動時同步到
    `settings.commentReply.lastCommentEventAt`（不在每則留言寫渠道列，避免熱點）。
  - 訂閱檢查併入既有 `meta-token-health`（每 6 小時）：對 `receiving=true` 的渠道 `GET subscribed_apps`，寫 `settings.commentReply.subscription`；
    網路錯誤或限流記 `unknown` 不改狀態。IG 若不提供 GET（待實測）記 `unknown`。
  - `comment-reply-health` 以 `prismaAdmin` 唯讀統計並發 ops-alert：`comment-reply-auth:<channelId>`（15 分鐘內 TOKEN_EXPIRED／PERMISSION_MISSING ≥ 3，另通知租戶管理員）、
    `comment-reply-failure-rate:<channelId>`（15 分鐘內失敗 ≥ 20 且 > 50%，排除使用者端原因）、`comment-reply-stuck`（非排隊中的 PENDING 超過 30 分鐘）、
    `comment-reply-expiring`（PENDING 留言時間超過 6 天）、`comment-reply-subscription:<channelId>`（開了接收、有啟用規則，但訂閱缺 `feed`／`comments`，另通知租戶）、
    `meta-webhook-signature`（5 分鐘驗簽失敗 ≥ 50）。`queue-failed:comment-reply` 由既有機制發出。
  - `readiness` 每個渠道查 Meta 的結果在 Redis 快取 5 分鐘（`cr:readiness:<channelId>`），每渠道 3 秒逾時（逾時回 `subscribed: null`），補訂閱成功清快取。
- **理由**：03 的監控完整度＋02 的即時前置條件；沒有留言不代表壞了，只能主動查訂閱。

### D26：保存期限（A18）

- **決定**：`comment-reply-retention`（API 排程，每小時，`withoutOverlapping`）刪除 `createdAt` 早於 `logRetentionDays`（預設 180）的紀錄，
  每批 5,000 筆、單次最多 60 秒；`conversations.originCommentReplyLogId` 由外鍵 SetNull。`comment_reply_usages` 保留 25 個月。
  `comment_authors` 在聯絡人存在期間保留。

### D27：資料治理（erasure、export、合併）

- **決定**：
  - `data-erasure` anonymize：該批聯絡人（含併入的封存聯絡人）的 `comment_authors` 清空 `displayName`、`username`、`psid`，`externalUserId` 改為
    `erased:<authorId>`；其紀錄清空 `commenterId`、`commenterName`、`commenterUsername`、`commentText`、`recipientUid`、`dedupeKey`、`sentContentSnapshot`，
    保留 `commentId`（同一則留言重投仍被唯一鍵擋下，不會再私訊）。hard_delete：先刪紀錄再刪 `comment_authors`。`affected` 加 `commentReplyLogs`、`commentAuthors`。
  - `data-export`：加 `comment_reply_rules`、`comment_reply_logs`（不含快照原文）、`comment_authors` 三個 CSV 與 JSON。
  - 合併引擎搬 `comment_authors.contactId`、記入合併紀錄；解除合併搬回。
  - 收到 FB `verb=remove`：清空該紀錄 `commentText`、寫 `commentDeletedAt`（A16，外掛保留 remove 事件只為這件事）。
- **理由**：留言者名稱、留言內容、PSID 都是個資（03 §7.1）。

### D28：其他未定細節的處理（A16、A21）

- `verb=remove`：保留（D27）。`verb=edited` 不處理。
- 留言者是另一個粉專（A21）：無法事先判斷，不額外呼叫 Graph；Meta 錯誤碼實測後在外掛對照為 `RECIPIENT_IS_PAGE`（不可重試），實測前落 `UNKNOWN`。
- FB 留言缺 `from`：外掛略過並計數（02 §8 第 8 點）；UAT 實測若常見再改。
- IG 對另一則留言的回覆能否私訊：預設比對；實測不行就在外掛略過帶 `parent_id` 的事件。
- IG 權杖缺 `instagram_business_manage_comments`：Instagram Login 沒有 `debug_token`，`readiness.missingPermissions` 回 `null`（未知）；
  24 小時內有 `PERMISSION_MISSING` 紀錄時，前置條件卡顯示「Instagram 權杖可能缺少留言權限，請重新產生權杖」。

## 資料流

### 主流程

```
Meta ──POST /webhooks/meta（或 /fb/:id、/threads/:id）──> webhook.routes ──200──> Meta
                                                  │（背景，in-flight 追蹤，D3）
                                                  ▼
webhook.service：驗簽 → parseWebhook()（私訊，既有）→ extensions.comments.parseCommentEvents()
                → routeByAccount(prismaAdmin)（與私訊同一套分派）→ 每個渠道群組：
comment-reply-intake.flow：inTenant(fastify.prisma, tenantId)
   a 緊急停止／能力開關／方案 feature／渠道啟用／租戶啟用 → 任一不成立：結束（不寫資料）
   b 讀啟用規則（快取）→ matchCommentRule() → 沒命中：結束
   c INSERT comment_reply_logs PENDING ON CONFLICT (channelId, commentId) DO NOTHING → 沒插入：結束
   d 找或建聯絡人＋comment_authors（D16-1～3）
   e enqueueJob('comment-reply', { tenantId, logId })（outbox，同交易）
   COMMIT → outbox 快路徑 → BullMQ
comment-reply.worker（API 行程）→ deliverCommentReply(tenantId, logId)
   0 讀紀錄（短交易）；不是 PENDING／逾時 SENDING → 結束
   1 再檢查：租戶、緊急停止、能力、方案、渠道、7 天、規則、素材 → 不送：終態 SKIPPED／EXPIRED
   2 私訊 bucket（Redis）→ 沒有 token：RATE_LIMIT_QUEUED＋moveToDelayed
   3 T1 inTenant：扣月額度（D11）→ PENDING→SENDING（撞去重鍵 → SKIPPED_DUPLICATE 或延後）
   4 交易外：渲染內容 → sendPrivateReply()（POST /me/messages，recipient.comment_id）
   5 T2 inTenant：SENT＋recipientUid＋快照＋接上身分（D16-4）／FAILED（還名額）／退回 PENDING 重試
   6 交易外：有公開回覆 → T3 claim → replyToComment() → T4 結果；T2 後若顧客已回覆 → attachCommentOrigin
```

### 顧客回覆私訊

```
Meta messages（sender.id = PSID／IGSID）→ processInboundMessage()
   resolveInboundContact()：ChannelIdentity(channelId, uid) 已存在（私訊成功時建的）→ 同一位聯絡人
                            不存在 → 先查 comment_authors（psid=uid 或 externalUserId=uid）→ 命中：身分建在那位聯絡人
                            → 都沒有：照舊建新聯絡人
   留言建立的聯絡人第一次進站：不送招呼語；發一次 contact.created（D17）
   createInboundMessage() → attachCommentOrigin()（D18）→ emitInboundSocketEvents()
```

### 每一段用的 Prisma client

| 段落 | Client |
| ---- | ---- |
| webhook 驗簽、依 `entry.id` 找渠道 | `fastify.prismaAdmin`（公開 webhook，已在白名單） |
| 收件 flow、消費者、入站關聯、後台路由 | `inTenant(fastify.prisma, tenantId)`／`TenantCtx`；Meta 呼叫在交易外 |
| `comment-reply-recover`／`health`／`retention` 排程 | 跨租戶唯讀掃描用 `prismaAdmin`（排程在白名單）；寫入逐租戶 `inTenant()` |
| 平台設定寫入、平台健康 API | `fastify.prismaAdmin` |
| 租戶端讀平台設定 | 租戶交易內讀 `platform_settings`（app_tenant 有 SELECT） |

## 資料模型

```prisma
enum CommentReplyStatus {
  PENDING
  SENDING
  SENT
  FAILED
  EXPIRED
  SKIPPED
  SKIPPED_DUPLICATE
}

/// 留言關鍵字自動私訊規則。軟刪除（deletedAt）
model CommentReplyRule {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId           String    @db.Uuid
  channelId          String    @db.Uuid
  name               String    @db.VarChar(200)
  keywords           String[]
  matchMode          String    @default("any")   // any | all
  postScope          String    @default("all")   // all | selected
  postIds            String[]  @default([])      // 外掛正規化後的貼文 ID
  postSnapshots      Json      @default("[]")    // 只做顯示：[{ postId, permalink, thumbnailUrl, excerpt, publishedAt }]
  contentType        String                      // material | text
  materialId         String?   @db.Uuid
  messageText        String?
  dedupePerCommenter Boolean   @default(true)
  publicReplyEnabled Boolean   @default(false)
  publicReplyTexts   String[]  @default([])
  isActive           Boolean   @default(true)
  priority           Int       @default(0)
  createdById        String?   @db.Uuid
  updatedById        String?   @db.Uuid
  deletedAt          DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  tenant   Tenant            @relation(fields: [tenantId], references: [id])
  channel  Channel           @relation(fields: [channelId, tenantId], references: [id, tenantId], onDelete: Cascade)
  material Material?         @relation(fields: [materialId], references: [id], onDelete: SetNull)
  logs     CommentReplyLog[]

  @@unique([id, tenantId])
  @@index([tenantId, channelId, priority])
  // migration SQL：部分索引 (channelId) WHERE "isActive" AND "deletedAt" IS NULL
  @@map("comment_reply_rules")
}

/// 留言者（webhook from.id）與聯絡人、私訊 ID 的對應
model CommentAuthor {
  id                     String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId               String    @db.Uuid
  channelId              String    @db.Uuid
  externalUserId         String
  displayName            String?
  username               String?
  contactId              String    @db.Uuid
  createdContact         Boolean   @default(false) // 聯絡人由留言收件建立（D16、D17）
  contactEventPublishedAt DateTime?                // 已補發 contact.created
  psid                   String?                   // 私訊成功後的 recipient_id
  firstCommentAt         DateTime
  lastCommentAt          DateTime
  commentCount           Int       @default(1)
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  tenant  Tenant            @relation(fields: [tenantId], references: [id])
  channel Channel           @relation(fields: [channelId, tenantId], references: [id, tenantId], onDelete: Cascade)
  contact Contact           @relation(fields: [contactId], references: [id], onDelete: Cascade)
  logs    CommentReplyLog[]

  @@unique([id, tenantId])
  @@unique([channelId, externalUserId])
  @@index([contactId])
  @@index([tenantId])
  // migration SQL：部分唯一 (channelId, psid) WHERE psid IS NOT NULL
  @@map("comment_authors")
}

/// 觸發紀錄：只記命中規則的留言
model CommentReplyLog {
  id                    String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId              String             @db.Uuid
  channelId             String             @db.Uuid
  ruleId                String             @db.Uuid
  commentAuthorId       String             @db.Uuid
  conversationId        String?            @db.Uuid
  commentId             String
  postId                String
  parentCommentId       String?
  adId                  String?
  commenterId           String?            // 匿名化時清空
  commenterName         String?
  commenterUsername     String?
  commentText           String?            // 前 2,000 字
  commentCreatedAt      DateTime
  createdAtSource       String             @default("comment") // comment | notification
  receivedAt            DateTime           @default(now())
  matchedKeywords       String[]           @default([])
  status                CommentReplyStatus @default(PENDING)
  reasonCode            String?
  reasonMessage         String?            // Meta 原始訊息前 200 字
  metaErrorCode         Int?
  metaErrorSubcode      Int?
  metaTraceId           String?
  dedupeKey             String?
  holderLogId           String?            @db.Uuid
  attemptCount          Int                @default(0)
  metaRateLimitHits     Int                @default(0)
  nextAttemptAt         DateTime?
  quotaMonth            String?            @db.Char(7)
  sendAttemptedAt       DateTime?
  sentAt                DateTime?
  sentMessageId         String?
  recipientUid          String?
  sentContentSnapshot   Json?
  publicReplyStatus     String             @default("NOT_CONFIGURED")
  publicReplyText       String?
  publicReplyCommentId  String?
  publicReplyReasonCode String?
  publicReplyAt         DateTime?
  customerRepliedAt     DateTime?
  commentDeletedAt      DateTime?
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt

  tenant        Tenant           @relation(fields: [tenantId], references: [id])
  channel       Channel          @relation(fields: [channelId, tenantId], references: [id, tenantId])           // Restrict
  rule          CommentReplyRule @relation(fields: [ruleId, tenantId], references: [id, tenantId])             // Restrict（規則只軟刪）
  commentAuthor CommentAuthor    @relation(fields: [commentAuthorId, tenantId], references: [id, tenantId])    // Restrict
  conversation  Conversation?    @relation("CommentReplyLogConversation", fields: [conversationId], references: [id], onDelete: SetNull)
  originOf      Conversation[]   @relation("ConversationOriginComment")

  @@unique([channelId, commentId])
  @@index([tenantId, commentCreatedAt(sort: Desc), id(sort: Desc)])
  @@index([tenantId, status, createdAt(sort: Desc)])
  @@index([channelId, createdAt(sort: Desc)])
  @@index([ruleId, createdAt(sort: Desc)])
  @@index([commentAuthorId])
  @@index([createdAt])
  // migration SQL：
  //   UNIQUE (dedupeKey) WHERE "dedupeKey" IS NOT NULL AND status IN ('SENDING','SENT')
  //   (coalesce("nextAttemptAt","updatedAt")) WHERE status = 'PENDING'
  //   ("sendAttemptedAt") WHERE status = 'SENDING'
  //   (channelId, recipientUid, sentAt DESC) WHERE status = 'SENT' AND "conversationId" IS NULL
  @@map("comment_reply_logs")
}

/// 每月（台灣時間）私訊用量
model CommentReplyUsage {
  tenantId         String   @db.Uuid
  month            String   @db.Char(7)
  sentCount        Int      @default(0)
  publicReplyCount Int      @default(0)
  updatedAt        DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@id([tenantId, month])
  @@map("comment_reply_usages")
}

model Conversation {
  // ...既有欄位
  originCommentReplyLogId String?           @db.Uuid
  originCommentReplyLog   CommentReplyLog?  @relation("ConversationOriginComment", fields: [originCommentReplyLogId], references: [id], onDelete: SetNull)
  commentReplyLogs        CommentReplyLog[] @relation("CommentReplyLogConversation")
  // migration SQL：部分索引 WHERE "originCommentReplyLogId" IS NOT NULL
}
```

Migration（3 支，時間戳以實作當天為準）：

1. `…_add_comment_reply_tables`：enum、4 張表、索引、部分索引、複合外鍵；4 張表 `ENABLE`＋`FORCE ROW LEVEL SECURITY`、
   `tenant_isolation` policy（`NULLIF(current_setting('app.current_tenant', true), '')::uuid`），並**明確**
   `GRANT SELECT, INSERT, UPDATE, DELETE ON … TO app_tenant`（`20261103110000` 之後預設權限不再自動授權；`outbox` migration 的註解不可照抄）。
2. `…_conversation_comment_origin`：`conversations` 加 nullable 欄位、FK、部分索引（部署前查表大小，超過 100 萬列另評估 `CONCURRENTLY`）。
3. 不寫方案資料 migration（D23）。

`scripts/check-tenant-scoping.mjs` 的 `TENANT_MODELS` 加 `commentReplyRule`、`commentReplyLog`、`commentAuthor`、`commentReplyUsage`。
沒有新的平台層表，AGENTS.md 的平台表清單不變。

刪除行為：渠道硬刪時規則與留言者 Cascade、紀錄 Restrict（有紀錄的渠道回既有 `CHANNEL_IN_USE`）；素材刪除 → 規則 `materialId` SetNull；
聯絡人硬刪 → `comment_authors` Cascade，但紀錄對留言者是 Restrict，erasure 必須先刪紀錄；對話硬刪 → 紀錄 `conversationId` SetNull。

## 外掛契約

```ts
export interface ParsedCommentEvent {
  kind: 'add' | 'remove';
  accountId: string;            // entry.id
  commentId: string;
  postId: string;               // FB `{pageId}_{postId}`；IG media id
  parentId?: string;            // FB parent_id === post_id 時不填
  commenterId: string;          // FB feed from.id（不保證是 PSID）；IG IGSID
  commenterName?: string;       // FB from.name
  commenterUsername?: string;   // IG from.username
  text: string;
  createdAt: Date;
  createdAtSource: 'comment' | 'notification';
  adId?: string;
}

export interface CommentReplyCapabilities {
  platform: 'fb' | 'ig';                          // 對應平台能力開關與測試階段旗標
  privateReplyContentTypes: readonly string[];    // IG：['text']
  publicReply: boolean;
  materialChannelType: string | null;             // IG：null
  postLinkLabel: string;
}

export type MetaErrorInfo = { code?: number; subcode?: number; traceId?: string; message: string; reason: string; transient: boolean; retryAfterMs?: number };
export type CommentSendResult = { ok: true; recipientId: string; messageId: string } | { ok: false; error: MetaErrorInfo };

export interface ChannelCommentExtension {
  readonly capabilities: CommentReplyCapabilities;
  parseCommentEvents(rawBody: Buffer): ParsedCommentEvent[];   // 已排除自己帳號、非 add/remove、直播留言
  /** 手動輸入的貼文 ID 或網址離線正規化；無法辨識回 null */
  parsePostReference(input: string, ctx: { accountId: string }): string | null;
  sendPrivateReply(commentId: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<CommentSendResult>;
  replyToComment(commentId: string, text: string, credentials: Record<string, unknown>): Promise<{ ok: true; replyId: string } | { ok: false; error: MetaErrorInfo }>;
  listRecentPosts(credentials: Record<string, unknown>, cursor?: string): Promise<{ posts: RecentPost[]; nextCursor: string | null }>;
  resolvePostUrl(url: string, credentials: Record<string, unknown>): Promise<RecentPost | null>;   // 只呼叫 Graph API，不 fetch 使用者網址
  getSubscriptionStatus(credentials: Record<string, unknown>, ctx: { accountId: string; appId?: string }): Promise<CommentSubscriptionStatus>;
  subscribeFields(credentials: Record<string, unknown>, ctx: { accountId: string; fields: string[]; appSecret?: string }): Promise<void>;
}
```

| 方法 | FB（`facebook/index.ts`） | IG（`threads.ts`，Instagram Login） |
| ---- | ---- | ---- |
| `parseCommentEvents` | `object=page`、`changes[].field='feed'`、`item='comment'`、`verb` 為 `add`／`remove`；排除 `from.id === entry.id`；`created_time` 秒轉毫秒；缺 `from` 略過 | `object=instagram`、`field='comments'`；排除 `from.id === entry.id` 或帶 `self_ig_scoped_id`；`live_comments` 不處理；時間用 `entry.time` |
| `parsePostReference` | 接受 `{pageId}_{id}`、純數字（補 `{pageId}_`）、`/posts/<數字>`、`story_fbid=`、`fbid=` | 接受數字 media id |
| `sendPrivateReply` | `POST graph.facebook.com/v21.0/me/messages`，`{ recipient: { comment_id }, message }`（共用 `postMessage()`，D6） | `POST graph.instagram.com/v21.0/me/messages`，只送文字；非文字不呼叫 Meta、回 `MATERIAL_UNSUPPORTED` |
| `replyToComment` | `POST /{comment-id}/comments` | `POST /{comment-id}/replies` |
| `listRecentPosts` | `GET /{page-id}/published_posts`（需 `pages_read_engagement`） | `GET /me/media` |
| `resolvePostUrl` | 先 `parsePostReference`，`pfbid` 掃最近 4 頁比對 `permalink_url` | shortcode 掃最近 4 頁比對 `permalink` |
| `getSubscriptionStatus` | `GET /{page-id}/subscribed_apps`＋`debug_token` scopes | `GET /me/subscribed_apps`（待實測，不提供則 `subscribed: null`） |
| `subscribeFields` | `POST /{page-id}/subscribed_apps`＋`appsecret_proof`（與 `meta-connect` 共用同一實作） | `POST /me/subscribed_apps` |

Meta 錯誤正規化（外掛內）：190 → `TOKEN_EXPIRED`；10、200～299 → `PERMISSION_MISSING`；551 → `USER_UNAVAILABLE`；100＋subcode 33 → `COMMENT_NOT_FOUND`；
「已私訊過」（社群經驗 10900，待實測）→ `ALREADY_REPLIED`；「超過期限」（社群經驗 10903，待實測）→ `EXPIRED_BY_META`；對粉專私訊（待實測）→ `RECIPIENT_IS_PAGE`；
4／17／32／613／80001～80014 → `RATE_LIMITED`（transient，帶 `retryAfterMs`）；fetch 丟錯、HTTP 5xx → `NETWORK`（transient）；其他 → `UNKNOWN`。
`APP_NOT_APPROVED` 由 comment-reply 模組依測試階段旗標從 `PERMISSION_MISSING` 轉換（外掛不知道平台旗標）。

## API

前綴 `/api/v1/comment-replies`；全部 `authenticate` → `requirePermission()`（含方案天花板）→ Zod → flow。清單依渠道可見範圍過濾；看不到的資源回 404。
錯誤以 `AppError(message, code, statusCode, details)`。日期一律 `z.coerce.date()`。

| 方法與路徑 | 權限 | 輸入重點 | 回應 | 錯誤碼 |
| ---- | ---- | ---- | ---- | ---- |
| `GET /rules` | view | `channelId?` | `RuleView[]`（含 `canEdit`、`stats7d`、`warnings`） | — |
| `GET /rules/:id` | view | uuid | `RuleView` | `RULE_NOT_FOUND` 404 |
| `POST /rules` | manage | `RuleInput` | 201 `RuleView` | `VALIDATION_ERROR` 400（`details.field`）、`CHANNEL_NOT_SUPPORTED` 400、`POST_ID_INVALID` 400、`MATERIAL_NOT_FOUND` 400、`MATERIAL_UNSUPPORTED` 400、`COUPON_URL_IN_RULE_MESSAGE` 400、`CAPABILITY_DISABLED` 400／403、`CHANNEL_ACCESS_DENIED` 403、`PLAN_LIMIT_EXCEEDED` 403 |
| `PATCH /rules/:id` | manage | `RulePatch`（帶 `channelId` → 400 `CHANNEL_IMMUTABLE`） | `RuleView` | 同上＋`RULE_NOT_FOUND` |
| `PATCH /rules/:id/active` | manage | `{ isActive }` | `RuleView` | `RULE_NOT_FOUND`、`CHANNEL_ACCESS_DENIED`、`PLAN_LIMIT_EXCEEDED` |
| `PUT /rules/order` | manage | `{ ids: uuid[1..500] }` | `{ ok: true }` | `VALIDATION_ERROR`（重複）400、`RULE_ORDER_MISMATCH` 409 |
| `DELETE /rules/:id` | manage | uuid | 204（軟刪除） | `RULE_NOT_FOUND`、`CHANNEL_ACCESS_DENIED` |
| `POST /rules/test` | view | `{ channelId, postId?, text(1..2000) }` | `{ matched, ruleId?, ruleName?, matchedKeywords? }` | `CHANNEL_NOT_FOUND` 404 |
| `GET /material-options` | manage | `channelId` | `[{ id, name, contentType, preview }]` | `CHANNEL_NOT_FOUND` 404 |
| `GET /logs` | view | `status?[]、channelId?、ruleId?、from?、to?、q?(≤100)、cursor?、limit?(1..100)、since?、countOnly?` | `{ items, nextCursor }`／`{ count }` | `VALIDATION_ERROR` |
| `GET /logs/summary` | view | 同篩選 | 各狀態筆數＋`failed24h` | — |
| `GET /logs/:id` | view | uuid | `LogDetail`（`conversationId` 只在有 `inbox.view` 且看得到渠道時回；否則只回 `customerReplied`） | `LOG_NOT_FOUND` 404 |
| `POST /logs/:id/retry` | manage | uuid | 202 `{ status: 'PENDING' }` | `LOG_NOT_FOUND`、`RETRY_NOT_ALLOWED` 409（`details.reason`：`NOT_FAILED`／`NOT_RETRYABLE`／`EXPIRED`）、`CHANNEL_ACCESS_DENIED` |
| `GET /readiness` | view | — | `{ testPhase, capabilities, emergencyStopped, quota: { monthlyUsed, monthlyLimit, activeRules, maxRules }, channels: [{ channelId, channelType, displayName, appMode, receiving, subscribed, missingPermissions, canPrivateReply, canPublicReply, tokenStatus, lastCommentEventAt, capabilities }] }` | — |
| `GET /channels/:channelId/posts` | manage | `cursor?` | `{ posts, nextCursor }` | `CHANNEL_NOT_FOUND` 404、`CAPABILITY_DISABLED` 403、`POSTS_UNAVAILABLE` 502（`details.reason`） |
| `POST /channels/:channelId/posts/resolve` | manage | `{ url(≤2000) }` | `RecentPost` | `POST_NOT_FOUND` 404、`CAPABILITY_DISABLED` 403、`POSTS_UNAVAILABLE` 502 |
| `POST /channels/:channelId/subscribe-comments` | `channel.update`＋`comment_reply.view` | — | `{ receiving: true }` | `CHANNEL_NOT_FOUND`、`REAUTH_REQUIRED` 409、`SUBSCRIBE_FAILED` 502 |
| `DELETE /channels/:channelId/subscribe-comments` | 同上 | — | `{ receiving: false }` | 同上 |

`RuleInput`（Zod）：`channelId` uuid；`name` 1..200；`keywords` 1..20 個、每個 1..50、NFKC 正規化後不可重複；`matchMode` any|all；
`postScope` all|selected；`posts` 0..50（selected 時 1..50），每筆 `{ postId(1..300，外掛正規化), permalink?, thumbnailUrl?, excerpt?(≤200), publishedAt?: z.coerce.date() }`；
`content` = `{ type:'text', text(1..1000) }` | `{ type:'material', materialId }`；`dedupePerCommenter` 預設 true；`publicReply` = `{ enabled 預設 false, texts 0..5、每則 1..300 }`（enabled 時 1..5）；`isActive` 預設 true。

其他：`POST /api/v1/meta-connect/start` 加選填 `returnTo`（只接受 `/dashboard/` 開頭的站內相對路徑，存進 state）。
平台：`GET /api/v1/platform/comment-reply/health`；`PUT /api/v1/platform/settings/:key` 對 D21 的 5 個鍵做型別驗證。

前端：`/dashboard/comment-replies`（規則、觸發紀錄兩分頁，`?tab=logs`）、`/dashboard/comment-replies/new`、`/dashboard/comment-replies/[ruleId]`；
側欄「行銷與渠道」第一層「留言自動私訊」（`comment_reply.view`）；收件匣對話列表「來自留言」標籤；`/admin/comment-reply`；`/admin/plans` 加兩個上限欄位。

## 上限檢查點

| 上限鍵 | 計數 | 檢查點 | 超過時 |
| ---- | ---- | ---- | ---- |
| `maxCommentReplyRules` | 本租戶 `isActive AND deletedAt IS NULL` 的規則（全部渠道） | 建立啟用規則、`PATCH /rules/:id/active` 改 true、`PATCH /rules/:id` 把 isActive 改 true | 403 `PLAN_LIMIT_EXCEEDED`，`details: { limitKey, current, max }` |
| `monthlyCommentReplies` | `comment_reply_usages.sentCount`（台灣月） | 消費者呼叫 Send API 前（D11） | `SKIPPED`/`PLAN_QUOTA_EXCEEDED`，可重試；`readiness.quota` 顯示 |

null（方案沒設定或覆寫成 null）＝無上限；`tenants.limitOverrides` 依既有「有效上限解析」生效。

## 上線與回滾

順序（與 04 §6 一致）：

1. 合併部署（UAT＝正式環境，需使用者同意）。部署後平台設定沒有任何鍵 → 能力全關、測試階段開：功能對所有租戶不生效。
2. 部署後：跑 `reconcile-system-role-permissions`、SCAN＋DEL `perms:tenant:*`；確認既有私訊收發正常；平台佇列頁看得到 `comment-reply`。
3. Meta App 層：page 主題加 `feed`、instagram 主題加 `comments`（需使用者同意；操作前後截圖欄位清單）。
4. 平台把測試租戶放進含 `comment_reply` 的方案，打開 `fbPrivateReply`；測試粉專「開啟留言接收」；依 tasks 的 UAT 階段一實測。
5. 實測通過：FB 私訊對方案含 feature 的租戶開放（指定貼文手動填 ID）。
6. Meta 審核通過後依序打開 `fbPostPicker`、`fbPublicReply`、`igPrivateReply`、`igPostPicker`、`igPublicReply`，並把 `testPhase` 改 false。

回滾：

| 狀況 | 動作 |
| ---- | ---- |
| 私訊內容出錯、Meta 反垃圾警告 | 平台頁「緊急停止」（60 秒內生效，資料保留） |
| 某一能力出問題 | 關閉該能力開關 |
| `feed` 事件量拖慢 webhook | 緊急停止＋對受影響渠道 `DELETE /subscribe-comments`（或經同意跑補訂閱腳本 `--mode disable`），帶回 4 個 messaging 欄位 |
| 新程式影響既有私訊 | `git revert` → 自動部署；**不刪表**（新表沒人讀，`conversations` 新欄位 nullable） |
| 整個功能下架 | 另寫 forward migration（03 §2.5 的 SQL，去掉 `comment_reply_posts`），先匯出紀錄、先把 `feed` 從粉專訂閱拿掉 |

補訂閱腳本 `apps/api/src/scripts/comment-reply-subscriptions.ts`：`--dry-run`（預設）、`--tenant`、`--channel`、`--mode enable|disable|resubscribe`；
先 `GET subscribed_apps` 記錄原欄位、輸出前後對照、單一粉專失敗不中斷；用 `prismaAdmin`（加入白名單），權杖不輸出。

## Risks / Trade-offs

| # | 風險 | 對策 |
| ---- | ---- | ---- |
| R1 | 補訂閱或重新連結少帶 messaging 欄位 → 全租戶私訊中斷 | D19 單一實作；測試斷言完整集合（排序後 deepEqual＋另一份字面清單）；UAT 前後 `GET subscribed_apps` 對照 |
| R2 | `feed` 帶來大量按讚、分享事件拖慢 webhook，連續失敗 1 小時被 Meta 停用 | 只對開了接收的粉專訂；非留言事件解析後立刻丟；收件快取；訂閱檢查告警；緊急停止 |
| R3 | 同一則留言私訊兩次 | D9 三層；測試斷言 Meta 呼叫次數，不只紀錄筆數 |
| R4 | FB `from.id ≠ PSID` 且私訊失敗 → 顧客日後自己私訊成為第二位聯絡人 | D16 進站先查 `comment_authors`（ID 相同時可接上）；UAT 實測；只能人工合併 |
| R5 | FB 貼文 ID 在挑選清單、手動輸入、webhook 三邊格式不一致 → 指定貼文永不命中 | `parsePostReference` 單一正規化；feature test 用挑選 API 與手動輸入存檔再送 webhook |
| R6 | Meta 每小時 750 則限流，熱門活動排隊十幾小時、7 天外過期 | D12；`RATE_LIMIT_QUEUED` 顯示排隊中；每人一次預設開；文案說明 |
| R7 | 公開回覆被判垃圾留言 | 預設關、輪流文字、公開回覆另一個 bucket、私訊失敗不公開回覆、當機不重送 |
| R8 | 漏 GRANT `app_tenant` → 42501 | migration 迴圈寫法；`platform-table-grants.test.ts` |
| R9 | 方案含 feature 但上限欄位留空 → 無上限 | 決定 6 明訂 null＝不限；`/admin/plans` 欄位 placeholder 顯示「無上限」；平台健康頁顯示各租戶月用量 |
| R10 | 審核前一般顧客的留言可能根本不進 webhook | 測試階段卡文案不依賴「會記為失敗」；UAT 階段一實測（步驟 1-10） |
| R11 | 留言建立的聯絡人在聯絡人列表沒有渠道身分（FB 私訊失敗時） | 不進群發受眾（沒有身分）是刻意的；聯絡人詳情顯示來源紀錄（第二版可加篩選） |
| R12 | 合併引擎自動合併（D16-4）若 `recipient_id` 對應錯人 | 只合併「留言建立」的聯絡人，原本就存在的不自動合併；合併可解除 |
| R13 | 收件交易內建聯絡人讓 webhook 背景工作變長 | 只在命中且首次插入時；每則約 3～4 筆寫入；Meta 呼叫都在佇列 |
| R14 | `fix-meta-webhook-page-routing`、`fix-line-follow-unfollow-events` 未歸檔 | 兩者須先歸檔；本 change 歸檔前重新核對 MODIFIED 內容（見 proposal） |

## 需要 UAT 實測的項目（實測後回填 fixture、外掛對照與文案）

| # | 項目 | 回填到 |
| ---- | ---- | ---- |
| M1 | FB feed `from.id` 是否等於 PSID、同一人是否穩定 | D16、R4、`facebook-comment-events` fixture |
| M2 | 「已私訊過」「超過期限」「對粉專私訊」「Standard Access 對象不在 App 角色內」的 code／subcode | 外掛錯誤對照、`comment-private-reply.test.ts` fixture |
| M3 | 審核前沒有 App 角色的帳號留言會不會送 webhook | 測試階段卡文案 |
| M4 | FB 私訊會不會落在「訊息請求」 | UX 文案 |
| M5 | FB 廣告貼文留言會不會送、`post_id` 形式；廣告預覽網址能否解析 | `parsePostReference`、說明文字 |
| M6 | IG 對另一則留言的回覆能否私訊 | 外掛是否略過帶 `parent_id` 的事件 |
| M7 | IG Instagram Login 是否提供 `GET me/subscribed_apps` | `getSubscriptionStatus` |
| M8 | FB feed webhook 的 `from` 是否需要 `pages_read_user_content`、是否會缺 `from` | scope、外掛略過規則 |
| M9 | `POST subscribed_apps` 帶完整清單後 messaging 欄位全在（前後 `GET` 對照） | R1 驗證紀錄 |
| M10 | webhook 回應時間 p99（真實流量） | D3、容量估算 |

## Open Questions（待使用者確認；括號內為本文件採用的預設值）

1. **觸發紀錄保存天數**（180 天，平台可調 30～730）。替代：90 天、365 天。
2. **AGENT 角色預設權限**（AGENT 給 `comment_reply.view`，收件匣「查看留言紀錄」連結用；ADMIN、SUPERVISOR 給 view＋manage）。替代：AGENT 不給。
3. **規則異動寫租戶稽核**（寫，D24；既有自動化規則沒寫）。替代：只寫重試與補訂閱。
4. **新連結的粉專是否預設訂 `feed`**（方案含 feature 且平台 `fbPrivateReply` 開啟時才訂）。替代：一律不訂，由租戶按「開啟留言接收」。
5. **關鍵字比對正規化**（留言比對用 NFKC＋小寫；關鍵字回覆維持現狀，另開 change）。替代：本 change 一併改關鍵字回覆（要 MODIFIED automation-engine）。
6. **收件匣「來自留言」標籤顯示期間**（對話列表標籤顯示 7 天；對話內的系統訊息永久）。替代：永久顯示。
7. **觸發紀錄匯出 CSV**（第一版不做）。替代：做，權限 `comment_reply.manage`、寫稽核 `comment_reply.log.export`。
8. **規則活動期間**（第一版不做，用停用）。替代：加 `startAt`／`endAt`。
9. **側欄位置**（「行銷與渠道」第一層，URL `/dashboard/comment-replies`）。替代：放進「渠道」群組（需先改該群組的權限邏輯）。
10. **由留言建立的聯絡人第一次進站一律不送招呼語**（D17）。替代：私訊從未送達的聯絡人仍送招呼語。
11. **方案 feature 不寫資料 migration**（D23：既有方案現況就不含，沒有要改的列）。替代：加一支只有註解的 migration 作紀錄。
12. **限速預設值**（FB 700、IG 700、公開回覆 300／小時／渠道）與**上線順序中誰操作 Meta App**（使用者本人，或同意後以 MCP 操作）。
