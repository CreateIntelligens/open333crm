# 03 — SRE／資料庫規劃：留言關鍵字自動私訊

> 範圍：資料模型、migration 與 RLS、索引與容量、維運監控告警、上線與回滾、Meta App 設定（維運面）、資料治理、平台層。
> 模組切分、外掛契約、API 形狀、佇列冪等的程式設計由 `02-architecture.md` 決定；本文件寫到「資料庫與維運需要它長什麼樣子」，
> 兩邊衝突的地方列在 §9.3，以架構文件定案後回頭修正本文件。
> Meta 權限現況、送審材料與順序以 `04-meta-app-review.md` 為準（該文件有 2026-11-13 的唯讀查詢結果），本文件 §5 只補維運面。
> 本文件是規劃：沒有改程式、沒有建 migration、沒有連 UAT、沒有動 Meta App。

---

## 0. 先看結論

1. **新增 5 張租戶表、改 1 張既有表**：`comment_reply_rules`（規則）、`comment_reply_logs`（觸發紀錄）、`comment_authors`
   （留言者與聯絡人、PSID 的對應）、`comment_reply_usages`（每月私訊用量計數）、`comment_reply_posts`（貼文摘要快取，選用）；
   `conversations` 加一個欄位 `originCommentReplyLogId`。5 張表都 ENABLE＋FORCE RLS，並**明確 GRANT 給 `app_tenant`**
   （`20261103110000` 之後預設權限不再自動授權，漏寫會 `permission denied`）。
2. **防重複靠資料庫**：`UNIQUE (channelId, commentId)` 擋同一則留言第二次；規則開「每人一次」時再用部分唯一索引
   `UNIQUE (dedupeKey) WHERE status IN ('PENDING','SENT')` 擋同一人。
3. **真正的瓶頸是 Meta，不是資料庫**：FB 與 IG 的 Private Reply 都是**每個帳號每小時 750 次**（見 04 §7.2）。熱門貼文一小時上萬則
   命中留言，要排隊 13 小時以上；7 天內最多送 126,000 則。資料庫寫入量（每秒十幾筆）不是問題。
4. **`feed` 會帶來大量無關事件**（按讚、分享、編輯），webhook 量可能是留言的數倍。只對「有開留言接收」的粉專訂 `feed`，
   不要部署時替所有粉專一起訂；webhook 只做驗簽、過濾、寫入、丟佇列，馬上回 200。webhook 連續失敗 1 小時，Meta 會把整個粉專
   的訂閱停掉，**私訊也會一起收不到**。
5. **平台層**：新 feature `comment_reply`；兩個上限鍵 `maxCommentReplyRules`（啟用中規則數）與 `monthlyCommentReplies`
   （每月私訊數）；兩個權限點要跑 reconcile；3 個新佇列加進佇列監控；平台設定新增「Meta 存取等級（測試階段）」「開放範圍
   （灰度開關）」「限速」「紀錄保存天數」四個鍵，並新增平台頁 `/admin/comment-reply` 顯示各租戶的訂閱健康狀態。
6. **灰度與緊急停止**用平台設定 `commentReply.rollout`（off／allowlist／all），不必重新部署就能停。資料表是純新增，
   程式回滾不必刪表。

---

## 1. 資料模型

### 1.1 設計原則

| 原則 | 做法 | 依據 |
| ---- | ---- | ---- |
| 每張新表都有 `tenantId` | 直接用標準 `tenant_isolation` policy，不必子查詢；`check-tenant-scoping.mjs` 也能檢查 | RLS skill 陷阱 1 |
| 渠道參照用複合外鍵 | `(channelId, tenantId) → channels(id, tenantId)`，資料庫層擋跨租戶參照 | `coupon_claim_links`（#362 A3） |
| 規則軟刪除 | `deletedAt`，不硬刪；觸發紀錄保留並顯示「（已刪除的規則）」，可以用複合外鍵 Restrict | AGENTS「Soft-delete」；UX §4.1 |
| 狀態用 Postgres enum，原因代碼用 TEXT | 狀態是封閉集合；原因代碼會隨 Meta 錯誤增加，程式驗證、前端對照，未知代碼顯示 `UNKNOWN` | `BroadcastRecipient.skipReason` 的寫法 |
| 留言內容截斷 | `commentText` 只存前 2,000 字 | 控制紀錄表大小、個資最小化 |
| 不存權杖、不存原始 webhook | 權杖在 `channels.credentialsEncrypted`；原始 payload 不落地 | 個資與憑證 |
| 部分索引寫在 migration SQL，schema 加註解 | Prisma 不支援部分索引 | `20261021140000_coupon_shared_code_unique` 的前例 |

### 1.2 `comment_reply_rules`（規則）

| 欄位 | 型別 | 預設 | 說明 |
| ---- | ---- | ---- | ---- |
| `id` | uuid | `gen_random_uuid()` | |
| `tenantId` | uuid | | FK tenants，Restrict |
| `channelId` | uuid | | 複合 FK `(channelId, tenantId)`，Cascade（見 1.8） |
| `name` | varchar(200) | | 管理用名稱 |
| `keywords` | text[] | | 1～20 個，每個 1～50 字（應用層驗證） |
| `matchMode` | text | `'any'` | `any`／`all` |
| `postScope` | text | `'all'` | `all`／`selected` |
| `postIds` | text[] | `{}` | `postScope='selected'` 時 1～50 個 Meta 貼文 ID |
| `contentType` | text | | `material`／`text`（IG 只能 `text`，應用層驗證） |
| `materialId` | uuid? | | FK materials，SetNull（素材被刪時規則顯示「素材已刪除」，送出記 `MATERIAL_UNAVAILABLE`） |
| `messageText` | text? | | `contentType='text'` 時 1～1,000 字 |
| `dedupePerCommenter` | boolean | `true` | 同一位留言者在本規則只私訊一次 |
| `publicReplyEnabled` | boolean | `false` | |
| `publicReplyTexts` | text[] | `{}` | 1～5 則、每則 ≤300 字，輪流使用 |
| `isActive` | boolean | `true` | 啟用開關（計入 `maxCommentReplyRules`） |
| `priority` | int | `0` | 越小越前面；同一則留言只套用第一條命中的規則 |
| `createdById`、`updatedById` | uuid? | | 不設 FK（成員可能被永久刪除，比照稽核欄位） |
| `deletedAt` | timestamp? | | 軟刪除 |
| `createdAt`、`updatedAt` | timestamp | | |

約束與索引：

- `@@unique([id, tenantId])`：給 `comment_reply_logs` 的複合外鍵參照。
- `@@index([tenantId, channelId, priority])`：列表（UX §3.1 依渠道篩選、依順序排）。
- 部分索引 `(channelId) WHERE "isActive" AND "deletedAt" IS NULL`：worker／API 取某渠道的啟用規則；也用來數啟用中規則數。
  規則表很小，這個索引主要是讓「每則留言都要查一次」的路徑穩定（加上程序內快取，見 §3.4）。

活動期間（`startAt`／`endAt`）UX 建議第二版做，本版不加欄位；之後加兩個 nullable 欄位是無鎖的 `ADD COLUMN`。

### 1.3 `comment_reply_logs`（觸發紀錄）

只記「命中規則」的留言（UX §4.2）。Meta 重投同一則留言不產生第二筆。

| 欄位 | 型別 | 預設 | 說明 |
| ---- | ---- | ---- | ---- |
| `id` | uuid | | |
| `tenantId` | uuid | | FK tenants，Restrict |
| `channelId` | uuid | | 複合 FK `(channelId, tenantId)`，**Restrict**（有紀錄的渠道不能硬刪，與對話相同，AUDIT CHAN-01） |
| `ruleId` | uuid | | 複合 FK `(ruleId, tenantId) → comment_reply_rules(id, tenantId)`，Restrict（規則只軟刪） |
| `commentAuthorId` | uuid? | | FK comment_authors，SetNull |
| `contactId` | uuid? | | FK contacts，**Restrict**（硬刪聯絡人前 erasure 必須先處理紀錄，漏處理會直接報錯，見 §7） |
| `conversationId` | uuid? | | FK conversations，SetNull；顧客回覆後寫入 |
| `commentId` | text | | Meta 留言 ID |
| `postId` | text | | Meta 貼文／媒體 ID |
| `parentCommentId` | text? | | 是對另一則留言的回覆時 |
| `commenterExternalId` | text? | | 留言事件的 `from.id`；匿名化時清空 |
| `commenterName` | text? | | FB `from.name`；匿名化時清空 |
| `commenterUsername` | text? | | IG `from.username`；匿名化時清空 |
| `commentText` | text? | | 前 2,000 字；匿名化、留言被刪除時清空 |
| `commentCreatedAt` | timestamp | | Meta 的留言時間（判斷 7 天用） |
| `receivedAt` | timestamp | `now()` | webhook 收到的時間（延遲指標用） |
| `matchedKeywords` | text[] | `{}` | 命中的關鍵字（UX 標示用） |
| `status` | `CommentReplyStatus` | `PENDING` | 見下 |
| `reasonCode` | text? | | 封閉清單（UX §4.3，另加 §8 的 `PLAN_QUOTA_EXCEEDED` 等） |
| `reasonMessage` | text? | | Meta 原始訊息前 200 字 |
| `metaErrorCode`、`metaErrorSubcode` | int? | | |
| `metaTraceId` | text? | | Meta 回應的 `fbtrace_id`，找 Meta 客服用 |
| `dedupeKey` | text? | | 規則開「每人一次」時是 `<ruleId>:<commenterExternalId>`，其餘 NULL |
| `attemptCount` | int | `0` | 呼叫 Send API 的次數 |
| `sendAttemptedAt` | timestamp? | | **呼叫 Meta 之前**寫入；重試時據此判斷「Meta 回已私訊過」是不是自己上一次送成功（§3.6） |
| `sentAt` | timestamp? | | |
| `sentMessageId` | text? | | Send API 回傳的 `message_id` |
| `recipientPsid` | text? | | Send API 回傳的 `recipient_id` |
| `sentContentSnapshot` | jsonb? | | 送出當下的內容（UX §4.5：規則之後改了也不影響） |
| `publicReplyStatus` | text? | | `SENT`／`FAILED`／`SKIPPED`；NULL＝規則沒開 |
| `publicReplyText` | text? | | 實際用的那一則 |
| `publicReplyCommentId` | text? | | Meta 回傳的回覆留言 ID（日後刪除用） |
| `publicReplyReasonCode` | text? | | |
| `publicReplyAt` | timestamp? | | |
| `customerRepliedAt` | timestamp? | | 顧客第一次回覆私訊的時間 |
| `commentDeletedAt` | timestamp? | | 收到 `verb=remove` 時寫入（§7.4） |
| `createdAt`、`updatedAt` | timestamp | | |

狀態 enum `CommentReplyStatus`：`PENDING`、`SENT`、`FAILED`、`EXPIRED`、`SKIPPED_DUPLICATE`、`SKIPPED`（同 UX §4.2）。
「排隊等 Meta 限速」仍是 `PENDING`，`reasonCode='RATE_LIMIT_QUEUED'` 讓前端顯示「排隊中」，不要顯示成「處理時間比平常久」的警告。

約束與索引（依 UX §4.4 的查詢）：

| 索引 | 用途 |
| ---- | ---- |
| `UNIQUE (channelId, commentId)` | 同一則留言只處理一次（Meta 重投、廣告留言重複事件） |
| 部分唯一 `(dedupeKey) WHERE "dedupeKey" IS NOT NULL AND status IN ('PENDING','SENT')` | 每人一次。`FAILED`、`EXPIRED` 不占名額，之後的留言可以再試 |
| `(tenantId, createdAt DESC, id DESC)` | 預設列表（7 天、全部狀態）、cursor 分頁 |
| `(tenantId, status, createdAt DESC)` | 狀態篩選、摘要列各狀態筆數 |
| `(channelId, createdAt DESC)` | 依渠道篩選；渠道可見性過濾 `channelId IN (...)` |
| `(ruleId, createdAt DESC)` | 依規則篩選；規則列表的 `stats7d` |
| `(contactId)` | erasure、聯絡人時間軸、合併 |
| `(createdAt)` | 保存期限清除（跨租戶，比照 `side_effect_claims`） |
| 部分 `(updatedAt) WHERE status = 'PENDING'` | 卡住的 PENDING 掃描、告警 |
| 部分 `(channelId, recipientPsid) WHERE "customerRepliedAt" IS NULL AND "recipientPsid" IS NOT NULL` | 顧客回覆時找到對應紀錄、寫 `customerRepliedAt` 與 `conversationId` |

搜尋框（留言者名稱或內容）用 `ILIKE`，一律先限縮 `tenantId` 與期間（預設 7 天）。資料庫沒有 `pg_trgm`，第一版不加；
單一租戶 30 天紀錄超過 50 萬筆再評估 trigram 索引。

### 1.4 `comment_authors`（留言者對應）

決定 4 要「沒有聯絡人就建立，顧客回覆時對到同一位」。關鍵是：**FB 留言事件的 `from.id` 不保證等於 Messenger 的 PSID**
（IG 的留言者 ID 一般與私訊 IGSID 相同，但也要實測）。既有進站流程用 `channel_identities (channelId, uid=PSID)` 找聯絡人，
所以要另外一張表記「留言者 ID → 聯絡人、PSID」，PSID 從 Send API 回傳的 `recipient_id` 得到。

| 欄位 | 型別 | 說明 |
| ---- | ---- | ---- |
| `id` | uuid | |
| `tenantId` | uuid | FK tenants |
| `channelId` | uuid | 複合 FK `(channelId, tenantId)`，Cascade |
| `externalUserId` | text | 留言事件的 `from.id` |
| `displayName` | text? | FB 名稱 |
| `username` | text? | IG 帳號名稱 |
| `contactId` | uuid | FK contacts，**Cascade**（純對應資料，聯絡人硬刪時一起刪） |
| `psid` | text? | 私訊成功後填入；與 `channel_identities.uid` 同一個 ID 空間 |
| `firstCommentAt`、`lastCommentAt` | timestamp | |
| `commentCount` | int（預設 1） | 命中規則的留言數（不是全部留言） |
| `createdAt`、`updatedAt` | timestamp | |

- `UNIQUE (channelId, externalUserId)`：同一位留言者只建立一次聯絡人；兩則留言同時進來撞唯一鍵時，後到者改用先到者的資料
  （與 `inbound-contact-resolver.ts` 的 P2002 處理相同）。
- 部分唯一 `(channelId, psid) WHERE psid IS NOT NULL`。
- `(contactId)`、`(tenantId)`。

與 `channel_identities` 的關係（給架構對齊，§9.3）：

1. 私訊成功、拿到 PSID → 若 `channel_identities (channelId, psid)` 不存在，用同一個聯絡人建立一筆（`uid=psid`）。
   顧客之後回覆，既有流程就會找到同一位聯絡人，不會重複建立。
2. 顧客回覆得比 worker 寫入快（先建了聯絡人 B）→ worker 建身分撞 P2002 → 改用 B，並把 `comment_authors.contactId`、
   紀錄的 `contactId` 改指 B，刪掉 worker 剛建、沒有任何資料的聯絡人 A（同 resolver 回收孤兒聯絡人的做法）。
3. 私訊失敗、沒有 PSID → 聯絡人只靠 `comment_authors` 找到。若實測 FB `from.id` ≠ PSID，這位顧客之後自己傳私訊時會產生
   第二位聯絡人（風險 R4），只能靠合併處理。若實測相同，可以在失敗時也用 `from.id` 建身分，這張表的 `psid` 就只是備援。

`channel_identities` 本身**不加欄位**；留言來源記在 `comment_authors`。

### 1.5 `comment_reply_usages`（每月用量）

| 欄位 | 型別 | 說明 |
| ---- | ---- | ---- |
| `tenantId` | uuid | FK tenants，Cascade |
| `month` | char(7) | `YYYY-MM`，**台灣時間**（用 `taipeiMonthStart()` 算） |
| `sentCount` | int（預設 0） | 已送出的私訊數（計入 `monthlyCommentReplies`） |
| `publicReplyCount` | int（預設 0） | 已送出的公開回覆數（只統計，不設上限） |
| `updatedAt` | timestamp | |

主鍵 `(tenantId, month)`。為什麼不直接 `COUNT(*)` 紀錄表：保存期限清除後紀錄會消失、計數要能原子地「先占名額再送出」，
而且 worker 每送一則都要查，計數表只要一次 `UPDATE ... RETURNING`。計算方式見 §8.3。

### 1.6 `comment_reply_posts`（貼文摘要快取，選用）

UX §11.2 的貼文挑選是即時代理 Graph API；但觸發紀錄列表要顯示每筆的貼文縮圖與摘要，逐筆打 Graph API 太貴。
建議在**第一次收到某篇貼文的命中留言時**，worker 打一次 Graph API 寫進快取，之後同一篇貼文的紀錄都讀快取。

| 欄位 | 型別 | 說明 |
| ---- | ---- | ---- |
| `id`、`tenantId` | uuid | |
| `channelId` | uuid | 複合 FK，Cascade |
| `postId` | text | |
| `permalink` | text? | |
| `excerpt` | varchar(200)? | |
| `mediaType` | text? | `text`／`image`／`carousel`／`video`／`reels` |
| `thumbnailUrl` | text? | Meta CDN 網址會過期（帶 `oe=` 參數），`fetchedAt` 超過 24 小時就重抓 |
| `publishedAt` | timestamp? | |
| `unavailable` | boolean（預設 false） | 貼文已刪除或讀不到 |
| `fetchedAt` | timestamp | |

`UNIQUE (channelId, postId)`、`(tenantId)`。貼文是商家內容，不是個資。`pages_read_engagement` 沒過審時（04 §7.1）
FB 讀不到貼文，這張表只會有 `unavailable=true` 的列，紀錄頁顯示「—」。若架構決定不做，紀錄頁只顯示貼文 ID 與 Meta 連結。

### 1.7 既有表的變更

| 表 | 變更 | 理由 |
| ---- | ---- | ---- |
| `conversations` | 加 `originCommentReplyLogId uuid NULL`，FK → `comment_reply_logs(id)` ON DELETE SET NULL；部分索引 `WHERE "originCommentReplyLogId" IS NOT NULL` | 收件匣「來自留言」標記、系統訊息、第二版的「來自留言」篩選都要查得到；放 `metadata` JSON 無法建索引 |
| `messages` | **不加欄位**。系統補進對話的那則私訊用 `metadata.origin = { type: 'comment_private_reply', logId }`，`channelMsgId` 填 Send API 的 `message_id` | 既有 `UNIQUE (conversationId, channelMsgId)` 剛好擋掉 `message_echoes` 回來的同一則訊息被寫兩次 |
| `channel_identities` | 不變 | 見 1.4 |
| `channels` | 不加欄位，`settings.commentReply` 存訂閱狀態（見 §4.4） | 與 `settings.tokenHealth` 同一種做法 |

`ALTER TABLE conversations ADD COLUMN ... NULL`（沒有預設值）在 PostgreSQL 16 只改目錄，不重寫表；建部分索引時欄位全是 NULL，
仍要掃一次表、短暫擋寫入。部署前用 §6.3 的唯讀 SQL 確認 `conversations` 大小；超過 100 萬列時改成另一支 migration
用 `CREATE INDEX CONCURRENTLY`（不能放在交易內，Prisma migration 要單獨一檔並加 `-- prisma-migrate: no transaction` 的做法
需架構確認可行性，否則接受數秒的鎖）。

### 1.8 刪除行為總表

| 父表被刪 | 子表行為 | 結果 |
| ---- | ---- | ---- |
| 渠道硬刪 | 規則 Cascade、留言者 Cascade、貼文快取 Cascade、**紀錄 Restrict** | 有紀錄的渠道刪不掉，`deleteChannel()` 已有「收過對話的渠道刪不掉」的訊息，補一句「或有留言自動私訊紀錄」。渠道一般是停用，不是硬刪 |
| 規則刪除 | 軟刪除，紀錄不動 | 紀錄顯示「（已刪除的規則）」 |
| 素材刪除 | 規則 `materialId` SetNull | 規則顯示素材已刪除，送出記 `MATERIAL_UNAVAILABLE` |
| 聯絡人硬刪（erasure） | 留言者 Cascade；**紀錄 Restrict** | erasure 必須先刪紀錄（§7.2） |
| 對話硬刪 | 紀錄 `conversationId` SetNull；對話的 `originCommentReplyLogId` 隨對話消失 | |
| 租戶 | Restrict（租戶只軟刪，見 trial-data-purge） | |

### 1.9 Prisma schema 片段

```prisma
enum CommentReplyStatus {
  PENDING
  SENT
  FAILED
  EXPIRED
  SKIPPED_DUPLICATE
  SKIPPED
}

/// 留言關鍵字自動私訊規則（change add-comment-keyword-private-reply）。軟刪除（deletedAt），紀錄以複合外鍵參照
model CommentReplyRule {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId           String    @db.Uuid
  channelId          String    @db.Uuid
  name               String    @db.VarChar(200)
  keywords           String[]
  matchMode          String    @default("any") // any | all
  postScope          String    @default("all") // all | selected
  postIds            String[]  @default([])
  contentType        String // material | text
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
  // 部分索引 (channelId) WHERE isActive AND deletedAt IS NULL 寫在 migration SQL（Prisma 不支援）
  @@map("comment_reply_rules")
}

/// 留言觸發紀錄：只記命中規則的留言。(channelId, commentId) 唯一＝同一則留言只私訊一次
model CommentReplyLog {
  id                    String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId              String             @db.Uuid
  channelId             String             @db.Uuid
  ruleId                String             @db.Uuid
  commentAuthorId       String?            @db.Uuid
  contactId             String?            @db.Uuid
  conversationId        String?            @db.Uuid
  commentId             String
  postId                String
  parentCommentId       String?
  commenterExternalId   String?
  commenterName         String?
  commenterUsername     String?
  commentText           String?
  commentCreatedAt      DateTime
  receivedAt            DateTime           @default(now())
  matchedKeywords       String[]           @default([])
  status                CommentReplyStatus @default(PENDING)
  reasonCode            String?
  reasonMessage         String?
  metaErrorCode         Int?
  metaErrorSubcode      Int?
  metaTraceId           String?
  dedupeKey             String?
  attemptCount          Int                @default(0)
  sendAttemptedAt       DateTime?
  sentAt                DateTime?
  sentMessageId         String?
  recipientPsid         String?
  sentContentSnapshot   Json?
  publicReplyStatus     String?
  publicReplyText       String?
  publicReplyCommentId  String?
  publicReplyReasonCode String?
  publicReplyAt         DateTime?
  customerRepliedAt     DateTime?
  commentDeletedAt      DateTime?
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt

  tenant        Tenant           @relation(fields: [tenantId], references: [id])
  channel       Channel          @relation(fields: [channelId, tenantId], references: [id, tenantId])
  rule          CommentReplyRule @relation(fields: [ruleId, tenantId], references: [id, tenantId])
  commentAuthor CommentAuthor?   @relation(fields: [commentAuthorId], references: [id], onDelete: SetNull)
  contact       Contact?         @relation(fields: [contactId], references: [id])
  conversation  Conversation?    @relation("CommentReplyLogConversation", fields: [conversationId], references: [id], onDelete: SetNull)
  originOf      Conversation[]   @relation("ConversationOriginComment")

  @@unique([channelId, commentId])
  @@index([tenantId, createdAt(sort: Desc), id(sort: Desc)])
  @@index([tenantId, status, createdAt(sort: Desc)])
  @@index([channelId, createdAt(sort: Desc)])
  @@index([ruleId, createdAt(sort: Desc)])
  @@index([contactId])
  @@index([createdAt])
  // 部分索引寫在 migration SQL：dedupeKey 唯一（PENDING/SENT）、PENDING 掃描、(channelId, recipientPsid) 未回覆
  @@map("comment_reply_logs")
}

/// 留言者 ID（webhook from.id）與聯絡人、PSID 的對應。FB 的 from.id 不保證等於 Messenger PSID
model CommentAuthor {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String   @db.Uuid
  channelId      String   @db.Uuid
  externalUserId String
  displayName    String?
  username       String?
  contactId      String   @db.Uuid
  psid           String?
  firstCommentAt DateTime
  lastCommentAt  DateTime
  commentCount   Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant  Tenant            @relation(fields: [tenantId], references: [id])
  channel Channel           @relation(fields: [channelId, tenantId], references: [id, tenantId], onDelete: Cascade)
  contact Contact           @relation(fields: [contactId], references: [id], onDelete: Cascade)
  logs    CommentReplyLog[]

  @@unique([channelId, externalUserId])
  @@index([contactId])
  @@index([tenantId])
  // 部分唯一 (channelId, psid) WHERE psid IS NOT NULL 寫在 migration SQL
  @@map("comment_authors")
}

/// 每月（台灣時間）私訊用量，monthlyCommentReplies 上限以此原子扣減
model CommentReplyUsage {
  tenantId         String   @db.Uuid
  month            String   @db.Char(7) // YYYY-MM
  sentCount        Int      @default(0)
  publicReplyCount Int      @default(0)
  updatedAt        DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@id([tenantId, month])
  @@map("comment_reply_usages")
}

/// 貼文摘要快取（選用）。thumbnailUrl 會過期，fetchedAt 超過 24 小時重抓
model CommentReplyPost {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String   @db.Uuid
  channelId    String   @db.Uuid
  postId       String
  permalink    String?
  excerpt      String?  @db.VarChar(200)
  mediaType    String?
  thumbnailUrl String?
  publishedAt  DateTime?
  unavailable  Boolean  @default(false)
  fetchedAt    DateTime

  tenant  Tenant  @relation(fields: [tenantId], references: [id])
  channel Channel @relation(fields: [channelId, tenantId], references: [id, tenantId], onDelete: Cascade)

  @@unique([channelId, postId])
  @@index([tenantId])
  @@map("comment_reply_posts")
}

// 既有 model 要補的欄位與反向關聯
model Conversation {
  // ...
  /// 對話的第一個來源是留言私訊時，指向那筆觸發紀錄（收件匣「來自留言」）
  originCommentReplyLogId String?          @db.Uuid
  originCommentReplyLog   CommentReplyLog? @relation("ConversationOriginComment", fields: [originCommentReplyLogId], references: [id], onDelete: SetNull)
  commentReplyLogs        CommentReplyLog[] @relation("CommentReplyLogConversation")
}
// Tenant、Channel、Contact、Material 各補對應的反向關聯陣列（commentReplyRules、commentReplyLogs、commentAuthors、
// commentReplyUsages、commentReplyPosts），不改資料庫。
```

---

## 2. Migration 與 RLS

### 2.1 順序（一個 PR、三支 migration，時間戳以實作當天為準）

| 順序 | 名稱（範例） | 內容 | 可重跑 |
| ---- | ---- | ---- | ---- |
| 1 | `2026MMDD100000_add_comment_reply_tables` | enum、5 張表、索引（含部分索引）、外鍵、RLS、GRANT | 否（DDL，靠 `_prisma_migrations` 只跑一次） |
| 2 | `2026MMDD100100_conversation_comment_origin` | `conversations` 加欄位、FK、部分索引 | 否 |
| 3 | `2026MMDD100200_add_comment_reply_feature_to_plans` | 資料 migration：把 feature 與上限鍵加進既有方案 | **是**（條件式 UPDATE） |

拆成三支的理由：第 2 支動既有大表，失敗時容易看出是哪一步；第 3 支是資料，回滾 SQL 獨立。
三支都由 `docker-entrypoint.sh` 以 `MIGRATE_DATABASE_URL`（owner）執行（RLS skill 陷阱 14）。

### 2.2 第 1 支的 RLS 與權限（寫法）

```sql
-- （CREATE TYPE / CREATE TABLE / 索引 / 外鍵由 prisma migrate dev 產生，以下為手動補上的部分）

-- 部分索引（Prisma 不支援，schema 有註解）
CREATE INDEX "comment_reply_rules_active_channel_idx"
  ON "comment_reply_rules" ("channelId") WHERE "isActive" AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "comment_reply_logs_dedupeKey_active_key"
  ON "comment_reply_logs" ("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL AND "status" IN ('PENDING', 'SENT');
CREATE INDEX "comment_reply_logs_pending_idx"
  ON "comment_reply_logs" ("updatedAt") WHERE "status" = 'PENDING';
CREATE INDEX "comment_reply_logs_unreplied_psid_idx"
  ON "comment_reply_logs" ("channelId", "recipientPsid")
  WHERE "customerRepliedAt" IS NULL AND "recipientPsid" IS NOT NULL;
CREATE UNIQUE INDEX "comment_authors_channelId_psid_key"
  ON "comment_authors" ("channelId", "psid") WHERE "psid" IS NOT NULL;

-- RLS：5 張表都是直接帶 tenantId 的標準 policy（NULLIF 防空字串轉型錯誤，skill 陷阱 5）
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comment_reply_rules','comment_reply_logs','comment_authors',
                           'comment_reply_usages','comment_reply_posts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)$p$, t);
    -- 20261103110000 之後預設權限不再授權 app_tenant，新租戶表一定要明確 GRANT（skill「資料表權限」）
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
```

注意：

- `outbox` 那支 migration 的註解寫「權限由 ALTER DEFAULT PRIVILEGES 自動授予」，那是 `20261103110000` 之前的事，**不要照抄**。
- `platform-table-grants.test.ts` 會檢查每張 FORCE RLS 的表都授權了 `app_tenant` 四種權限；漏 GRANT 會在 feature 測試失敗。
- 第 2 支只改 `conversations`，它已經有 RLS，不必動 policy。外鍵檢查不受 RLS 影響（`conversations` 參照 `comment_reply_logs`
  時 Postgres 以內部權限檢查），所以寫入順序不受 policy 影響，但兩張表都要在同一個 `withTenant` 交易內寫。
- 沒有新的平台層表，所以 AGENTS.md 的平台表清單、`READ_ONLY_TABLES`／`NO_ACCESS_TABLES` 都不變。
- `scripts/check-tenant-scoping.mjs` 的 `TENANT_MODELS` 要加 `commentReplyRule`、`commentReplyLog`、`commentAuthor`、
  `commentReplyUsage`、`commentReplyPost`，否則漏帶 `tenantId` 的查詢不會被抓到。

### 2.3 第 3 支：方案資料 migration（可重跑）

方案內容是業務決定（§8.1 的建議值，待使用者確認）。寫法比照 `20261103120000_enable_channels_on_trial_light`：

```sql
-- change add-comment-keyword-private-reply：把 comment_reply feature 與上限鍵加進既有方案。
-- seed 只建立缺少的方案（#441），既有環境靠這支 migration。只改 features、limits，不動其他欄位。
-- 可重複執行：已含 feature／已有上限鍵的方案不會被改。平台在 /admin/plans 改過的值不會被蓋掉。
-- 權限快取：既有租戶的有效權限在 Redis perms:tenant:* 快取 10 分鐘；要立即生效時用 SCAN 刪這些 key（不可 FLUSHDB）。
-- 回滾：
--   UPDATE plans SET features = features - 'comment_reply', "updatedAt" = now()
--    WHERE slug IN ('professional','enterprise');
--   UPDATE plans SET limits = limits - 'maxCommentReplyRules' - 'monthlyCommentReplies', "updatedAt" = now()
--    WHERE slug IN ('professional','enterprise');

UPDATE plans
   SET features = features || '["comment_reply"]'::jsonb, "updatedAt" = now()
 WHERE slug IN ('professional', 'enterprise')
   AND jsonb_typeof(features) = 'array'
   AND NOT (features ? 'comment_reply');

-- 上限鍵：缺 key＝無上限，所以有上限的方案一定要明確寫入；企業版寫 null 讓方案頁顯示「無上限」
UPDATE plans SET limits = limits || '{"maxCommentReplyRules": 10}'::jsonb, "updatedAt" = now()
 WHERE slug = 'professional' AND jsonb_typeof(limits) = 'object' AND NOT (limits ? 'maxCommentReplyRules');
UPDATE plans SET limits = limits || '{"monthlyCommentReplies": 3000}'::jsonb, "updatedAt" = now()
 WHERE slug = 'professional' AND jsonb_typeof(limits) = 'object' AND NOT (limits ? 'monthlyCommentReplies');
UPDATE plans SET limits = limits || '{"maxCommentReplyRules": null, "monthlyCommentReplies": null}'::jsonb, "updatedAt" = now()
 WHERE slug = 'enterprise' AND jsonb_typeof(limits) = 'object'
   AND NOT (limits ? 'maxCommentReplyRules') AND NOT (limits ? 'monthlyCommentReplies');
```

同時改 `packages/database/prisma/seed-data/plans.ts` 的 `SEED_PLANS`，讓新環境與既有環境一致。

### 2.4 回填策略

| 項目 | 要不要回填 | 說明 |
| ---- | ---- | ---- |
| 歷史留言 | 不回填 | Meta 不提供「補送過去留言」的 webhook；UX 已寫明「只有新留言會觸發」。不要用 Graph API 掃舊留言補私訊（7 天限制、限速、容易被當垃圾訊息） |
| 既有對話的 `originCommentReplyLogId` | 不回填（全為 NULL） | 本功能上線前沒有留言私訊 |
| 既有粉專的 `feed` 訂閱 | 不在 migration 做 | 是外部動作，見 §5.3；由租戶按「開啟留言接收」或經使用者同意後跑腳本 |
| 權限點 | 部署後跑 reconcile | §8.4 |
| `comment_reply_usages` | 不回填 | 第一次送出時以 `INSERT ... ON CONFLICT` 建立當月列 |

### 2.5 回滾 SQL

原則：**程式回滾不刪表**。新表沒有既有程式在讀，留著不影響舊版；`conversations` 新欄位是 nullable，舊程式忽略它。
只有決定整個功能下架時，才寫一支**新的 forward migration** 執行下面的 SQL（不要手動刪 `_prisma_migrations` 列，避免 Prisma
之後判斷錯誤）：

```sql
-- 功能下架（新 migration）：先關灰度、確認 comment-reply 佇列已清空、匯出需要保留的紀錄
UPDATE plans SET features = features - 'comment_reply',
       limits = limits - 'maxCommentReplyRules' - 'monthlyCommentReplies', "updatedAt" = now();
DELETE FROM role_permissions WHERE "permissionCode" LIKE 'comment_reply.%';  -- 欄位名以實際 schema 為準
DELETE FROM platform_settings WHERE key LIKE 'commentReply.%';
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS "conversations_originCommentReplyLogId_fkey";
DROP INDEX IF EXISTS "conversations_originCommentReplyLogId_idx";
ALTER TABLE conversations DROP COLUMN IF EXISTS "originCommentReplyLogId";
DROP TABLE IF EXISTS comment_reply_logs;      -- 先刪參照 rules/authors 的表
DROP TABLE IF EXISTS comment_authors;
DROP TABLE IF EXISTS comment_reply_rules;
DROP TABLE IF EXISTS comment_reply_usages;
DROP TABLE IF EXISTS comment_reply_posts;
DROP TYPE IF EXISTS "CommentReplyStatus";
```

下架前另外要做外部動作：替訂了 `feed` 的粉專重新呼叫 `subscribed_apps`，只帶原本 4 個 messaging 欄位（§5.3），否則 Meta 仍會
一直送 `feed` 事件進來。

---

## 3. 容量與效能

### 3.1 情境假設

活動貼文「留 +1 送券」，1 小時 10,000 則留言，其中 80% 命中規則；同一篇貼文同時有 30,000 個按讚／表情、500 則留言編輯。
粉絲 1 萬以上的粉專 Meta 不送按讚通知（04 §3.1），但以最壞情況估算。

### 3.2 Webhook 吞吐

| 項目 | 估計 | 說明 |
| ---- | ---- | ---- |
| 事件量 | 平均 11～12 則／秒，開場尖峰 50～100 則／秒 | `feed` 的按讚、編輯也會送；Meta 一個請求最多帶 1,000 筆變更，實際多半是 1～數十筆 |
| 每個請求的成本 | HMAC 驗簽＋JSON 解析＋過濾 `item=comment && verb=add`＋分派 | 不是留言的事件**在解析後立刻丟掉**，不碰資料庫 |
| 分派查詢 | 依 `entry.id` 找渠道 | 加程序內快取（60 秒），否則每個請求一次 `channels` 查詢 |
| 規則比對 | 依渠道取啟用規則 | 程序內快取 30 秒＋規則變更時以 Redis 版本號失效；沒有啟用規則的渠道直接丟棄留言事件 |
| 請求大小上限 | 1,000 筆 × 約 15 個欄位 ≈ 1.5～2 萬個項目 | 低於 `request-payload-limits` 的 10 萬總項目上限；**超過上限會回 400，Meta 會算失敗**，不要把上限調低 |
| 回應時間 | 現行 `/webhooks/meta` 先回 200 再背景處理 | 目標 p99 < 200ms；Meta 要求 5 秒內 |

已知缺口（風險 R1）：現行 `/webhooks/meta` 是「先回 200、同一個行程背景處理」（`processPlatformMetaWebhook().catch()`）。
回 200 之後、寫進資料庫或佇列之前若 API 重啟（部署就會），那批留言會遺失，Meta 也不會重送。私訊早就有同樣的問題。
本功能把背景處理壓到最短（只寫 PENDING 紀錄＋丟佇列），並建議 API 關機時等背景中的 webhook 處理完（Fastify `onClose`），
由架構決定。

### 3.3 Meta 限速（決定實際送出速度）

| 限制 | 數字 | 來源 |
| ---- | ---- | ---- |
| FB Private Reply | 每個粉專每小時 **750 次**（有商店或大型直播的粉專 30,000 次） | 04 §7.2、§9 |
| IG Private Reply（貼文、Reels） | 每個帳號每小時 **750 次** | 本地文件 `graph-api/rate-limiting.md` |
| IG Send API（文字） | 每個帳號每秒 100 次 | 同上（顧客回覆後的對話用） |
| Messenger BUC | 每 24 小時 200 × 互動使用者數 | 同上；一般不會先碰到 |
| Pages BUC（公開回覆） | 每 24 小時 4,800 × 互動使用者數 | 同上；但同一段文字大量留言會被 Meta 反垃圾機制限制 |
| 限流錯誤碼 | 4、17、32、613、80001～80014 | `meta-token-health.ts` 的 `RATE_LIMIT_CODES` 已有同一組 |

推算：8,000 則命中留言 ÷ 750／小時 ≈ **10.7 小時排完**；7 天內單一帳號最多 750 × 168 = **126,000 則**。開「每人一次」通常能
砍掉三到五成。超過 7 天還沒送的記 `EXPIRED`。這個限制要寫進 UX 文案（「熱門活動可能要數小時才會全部私訊完」），並且
「排隊中」用 `reasonCode='RATE_LIMIT_QUEUED'` 顯示，避免小編以為壞了。

限速做法（給架構）：

- 每個渠道一個 Redis token bucket（`cr:rate:<channelId>`），預設 FB 700／小時、IG 700／小時（留 7% 餘裕），公開回覆另一個
  bucket 預設 300／小時。數字放平台設定 `commentReply.rateLimits`，不寫死。
- bucket 空了：`job.moveToDelayed(下一個 token 的時間)` 並丟 `DelayedError`（BullMQ 開源版支援），**不要**讓 job 失敗重試
  （會吃掉 attempts、觸發失敗告警）。BullMQ 的群組限速是付費版功能，不能用。
- Meta 回限流錯誤碼：讀 `X-Business-Use-Case-Usage` 的 `estimated_time_to_regain_access`，把該渠道 bucket 暫停到那個時間，
  job 延後；連續限流記 `RATE_LIMITED` 告警（§4.2）。
- 私訊優先於公開回覆：公開回覆的 bucket 空了就記 `publicReplyStatus=SKIPPED`、`publicReplyReasonCode=RATE_LIMITED`，
  不延後私訊。

### 3.4 佇列與並行

| 佇列 | 行程 | 用途 | 設定建議 |
| ---- | ---- | ---- | ---- |
| `comment-reply` | workers | 每筆命中留言一個 job（私訊＋公開回覆） | concurrency 5；attempts 5、exponential backoff 30 秒；`removeOnComplete: { age: 86400 }`、`removeOnFail: { age: 604800 }`；jobId 用 `cr-<logId>` |
| `comment-reply-sweeper` | workers（repeating，每 5 分鐘） | PENDING 超過 10 分鐘且沒有對應 job → 重新放進佇列；留言超過 7 天的 PENDING → `EXPIRED` | 同 `REPEATING_JOBS` |
| `comment-reply-retention` | workers（repeating，每小時） | 保存期限清除（§3.6） | 同上 |

- **jobId 不要用冒號**：BullMQ 5 拒絕含 `:` 的自訂 job id（`repeating-jobs.ts` 的註解也提到同一個限制），用 `cr-<logId>`。
- **一個佇列只放一個 repeating job**：`registerRepeatingJobs()` 會先刪掉同一佇列的全部 repeatable job 再註冊，兩個 job 放同一佇列
  會互相刪掉，所以清除與掃描分兩個佇列。
- **job 內容只放 `{ logId, tenantId }`**：資料庫是唯一真相，Redis 只當排程。Redis 資料遺失時 sweeper 從 PENDING 補回。
- **不要在交易內呼叫 Meta**：Send API 一次 200～800ms，交易內呼叫會占住連線。流程是「短交易：占名額＋寫 `sendAttemptedAt`」
  → 交易外呼叫 Meta → 「短交易：寫結果」。concurrency 5 時最多同時 5 條連線，加上 sweeper／retention 各 1 條。
- **業務失敗不讓 job 失敗**：`USER_UNAVAILABLE`、`COMMENT_NOT_FOUND`、`ALREADY_REPLIED` 等寫進紀錄後 job 正常完成。
  只有系統錯誤（資料庫連不上、程式例外）才丟錯讓 BullMQ 重試，重試用完進 failed set，`failed-alerts.ts` 自動發 ops-alert。
  否則 Meta 正常的拒絕會變成大量告警。
- 理論吞吐：concurrency 5 × 每則約 0.5 秒 ≈ 每秒 10 則，遠高於 Meta 的每小時 750 則；瓶頸永遠在限速，不必加 worker。

### 3.5 資料庫寫入量

每則命中留言的寫入：

| 步驟 | 寫入 |
| ---- | ---- |
| webhook | `comment_reply_logs` INSERT（`ON CONFLICT DO NOTHING`） |
| worker 第一次見到留言者 | `comment_authors` INSERT、`contacts` INSERT |
| worker 占名額 | `comment_reply_usages` UPDATE（或當月第一次 INSERT）、紀錄 UPDATE（`sendAttemptedAt`） |
| 送出後 | 紀錄 UPDATE；成功時 `channel_identities` INSERT（第一次）、`comment_authors` UPDATE（PSID） |
| 第一次見到貼文 | `comment_reply_posts` INSERT |

約 5～8 筆寫入／則。尖峰命中 100 則／秒時 webhook 端是 100 筆 INSERT／秒，worker 端受限速只有每秒 0.2 則，總量很小。
**熱點**：`comment_reply_usages` 同一租戶同一個月只有一列，並行 5 時會排隊等列鎖，但每次只鎖幾毫秒，可接受。
「最後收到留言時間」不要寫回 `channels` 列（每則留言都更新同一列會變成熱點），改寫 Redis（§4.4）。

### 3.6 紀錄表成長與保存期限

單筆紀錄約 1.2KB（含 2,000 字以內的留言、內容快照），加上 9 個索引約 2.5～3KB。

| 情境 | 每月新增 | 180 天穩定大小 |
| ---- | ---- | ---- |
| 10 個租戶 × 每月 2 萬則命中 | 20 萬列 ≈ 0.6GB | ≈ 3.6GB |
| 50 個租戶 × 每月 2 萬則命中 | 100 萬列 ≈ 3GB | ≈ 18GB |

UAT 是單一 EC2 主機，部署前用 §6.3 確認磁碟餘量（部署流程本身會 `docker builder prune` 以免塞滿磁碟）。

保存期限（待使用者決定，§10）：

- 建議預設 **180 天**，平台設定 `commentReply.logRetentionDays`（允許 30～730）。超過的紀錄整列刪除；`comment_reply_usages`
  保留 25 個月（帳務對照）。`comment_authors` 在對應聯絡人存在期間保留（它是聯絡人資料的一部分）。
- `comment-reply-retention` 每小時跑一次：`DELETE ... WHERE id IN (SELECT id FROM comment_reply_logs WHERE "createdAt" < $1 LIMIT 5000)`
  迴圈，單次最多跑 60 秒，避免長交易。刪除前把 `conversations.originCommentReplyLogId` 交給外鍵 SetNull 處理
  （收件匣的「來自留言」標記會在 180 天後消失，與 UX「7 天後不再顯示」的方向一致）。
- `comment_reply_posts`：`fetchedAt` 超過 30 天且沒有任何紀錄參照的列一起清。
- 清除以 workers 的 `prisma`（app_admin 或 owner 連線）跨租戶執行，屬於可信背景工作（RLS skill 接線規則）。

---

## 4. 維運

### 4.1 佇列監控

`apps/api/src/modules/queue-monitoring/monitored-queues.ts` 的 `WORKERS_QUEUES` 加 `comment-reply`、`comment-reply-sweeper`、
`comment-reply-retention`；`monitored-queues.test.ts` 會核對 workers 的 Worker 清單沒有遺漏。三個都自動進 `ALERTED_QUEUES`，
job 進 failed set 就發 ops-alert（同一佇列 10 分鐘合併一則）。平台佇列頁可以看失敗 job 並重送（重送會寫 `queue.job.retry` 稽核）。

### 4.2 ops-alert 告警條件

`sendOpsAlert()` 在 API 行程（會寫 Redis、不讀租戶表）。workers 不直接呼叫它；**下列判斷放在 API 的 Job Scheduler**
（新增 `comment-reply-health`，每 5 分鐘，走既有 `api-scheduler`），用 `prismaAdmin` 唯讀統計後發告警：

| 告警（合併鍵） | 條件 | 嚴重度 | 也通知租戶管理員？ |
| ---- | ---- | ---- | ---- |
| `queue-failed:comment-reply` | job 重試用完（既有機制） | 高 | 否 |
| `comment-reply-auth:<channelId>` | 15 分鐘內該渠道 `TOKEN_EXPIRED`／`PERMISSION_MISSING` ≥ 3 筆 | 高 | 是（站內＋email，沿用 `meta-token-health` 的通知與 3 天提醒節奏） |
| `comment-reply-failure-rate:<channelId>` | 15 分鐘內失敗 ≥ 20 筆且失敗率 > 50%（不含 `USER_UNAVAILABLE`、`COMMENT_NOT_FOUND`、`ALREADY_REPLIED`、`APP_NOT_APPROVED`） | 中 | 否 |
| `comment-reply-stuck` | `PENDING` 且 `updatedAt` 超過 30 分鐘、且 `reasonCode` 不是 `RATE_LIMIT_QUEUED` 的筆數 > 0 | 高（通常是 workers 掛了） | 否 |
| `comment-reply-backlog` | `comment-reply` waiting > 20,000，或最舊的 waiting job 超過 6 小時 | 中 | 否 |
| `comment-reply-expiring` | 有 PENDING 的留言時間超過 6 天（快要過期） | 中 | 否 |
| `comment-reply-subscription:<channelId>` | 訂閱檢查發現該渠道開了留言接收、有啟用規則，但 `subscribed_apps` 沒有 `feed`／`comments`（§4.4） | 高（多半是 Meta 自動停用） | 是 |
| `meta-webhook-signature` | `/webhooks/meta` 驗簽失敗 5 分鐘內 ≥ 50 次 | 高（App Secret 被換或遭攻擊） | 否 |
| `comment-reply-quota:<tenantId>` | 租戶本月用量達 100% | 低（只當商機提示） | 是（每月一次，用 `side_effect_claims` 去重，`kind='comment_reply_quota'`、`subKey=YYYY-MM`） |

另外：Meta 自己會在 webhook 連續失敗 15 分鐘時寄信給開發者帳號（04 §7.3），要確認 App 管理員信箱（`daniel@aicreate360.com`，
目前未驗證）有人看。

### 4.3 儀表板指標

本專案沒有 Prometheus；第一版用平台頁＋SQL。平台頁 `/admin/comment-reply`（§8.6）顯示：

- 每個開了留言接收的渠道：租戶、渠道名稱、連結模式（平台／自備 App）、訂閱狀態與檢查時間、權杖狀態、最後收到留言時間、
  啟用規則數、24 小時送出／失敗／排隊數、最常見的失敗原因。
- 全平台：24 小時命中數、送出數、失敗率、`comment-reply` 佇列 waiting／delayed／failed、PENDING 最舊時間、
  webhook 收到到送出的 p50／p95 延遲（`sentAt - receivedAt`，排除排隊中的）。

### 4.4 訂閱狀態與「最後收到留言」

- 每次收到某渠道的留言事件：`SET cr:last-event:<channelId> <timestamp> EX 2592000`（Redis，30 天）。
  `comment-reply-health` 每 5 分鐘把它同步到 `channels.settings.commentReply.lastCommentEventAt`（只在值變動時寫），
  UX 的前置條件卡（`lastCommentEventAt`）讀資料庫即可。
- 訂閱檢查併進既有 `meta-token-health`（每 6 小時）：對 `settings.commentReply.enabled = true` 的渠道打
  `GET /{page-id}/subscribed_apps`（IG 打 `GET graph.instagram.com/me/subscribed_apps`），結果寫
  `settings.commentReply.subscription = { status: 'ok'|'missing'|'unknown', fields, checkedAt }`，比照 `tokenHealth`
  用「權杖沒變才寫入」的原子更新。網路錯誤、限流記 `unknown`，不改狀態、不通知（避免誤報）。
- 這是偵測「Meta 因 webhook 失敗自動取消訂閱」的唯一方法：沒有留言不代表壞了（小粉專本來就安靜）。

### 4.5 日誌欄位

UAT 的 API 日誌在容器內 `logs/app-<日期>.log`（`LOG_TRANSPORT=file`），`docker logs` 只有 HTTP 請求。統一前綴 `[comment-reply]`。

| 欄位 | 說明 |
| ---- | ---- |
| `tenantId`、`channelId`、`channelType`、`connectMode` | |
| `logId`、`ruleId`、`commentId`、`postId` | Meta ID 本身不是個資內容，可以記 |
| `jobId`、`attempt`、`stage` | `webhook`／`match`／`claim`／`send`／`public_reply`／`finalize` |
| `status`、`reasonCode`、`metaErrorCode`、`metaErrorSubcode`、`fbtraceId` | |
| `latencyMs`（webhook 收到到送出）、`metaLatencyMs`、`rateLimitDelayMs` | |

**不記**：留言內容、留言者名稱、私訊內容、權杖、`appsecret_proof`、完整 Graph 網址（含權杖參數）。

### 4.6 Runbook（常見故障與處理）

所有 SQL 都是唯讀；UAT 是正式環境，連線前要先取得使用者同意（記憶「UAT 就是正式環境」）。

**A. 「留言沒有觸發」**

1. 平台頁看該渠道：訂閱狀態、權杖狀態、最後收到留言時間。
2. 最後收到留言時間很舊或沒有 → Meta 端：App 層是否訂了 `feed`／`comments`（04 §3）、粉專層 `subscribed_apps` 是否含 `feed`、
   是否被自動停用（§4.4）、審核前留言者是否有 App 角色（04 §4）。
3. 有收到但沒有紀錄 → 沒命中規則（只記命中的）。用後台「試試看」比對同一段文字；確認規則啟用、渠道對、貼文範圍對。
4. 確認灰度與方案：
   ```sql
   SELECT key, value FROM platform_settings WHERE key LIKE 'commentReply.%';
   SELECT t.name, p.slug, p.features ? 'comment_reply' AS has_feature
     FROM tenants t LEFT JOIN plans p ON p.id = t."planId" WHERE t.id = '<tenantId>';
   ```
5. API 日誌 `grep '\[comment-reply\]' logs/app-<日期>.log | grep <channelId>`。

**B. 大量 `APP_NOT_APPROVED`／留言者收不到** → 審核前的正常現象（04 §4）。確認平台設定 `commentReply.metaAccess` 是 `standard`，
前端會顯示「測試階段」。不要替租戶重試。

**C. `TOKEN_EXPIRED`／`PERMISSION_MISSING`** → 請租戶到渠道管理重新連結（平台模式）或重新產生權杖（IG、自備 App）。修好後
在紀錄詳情按「重試」（7 天內）。

**D. webhook 被 Meta 自動停用**（API 掛掉 ≥ 1 小時之後最常見）

1. 先修好 API，確認 `/webhooks/meta` 能回 200。
2. 經使用者同意後，對受影響的粉專重新呼叫 `subscribed_apps`，**帶上全部欄位**（messaging 4 個＋有開留言接收的加 `feed`）。
   用補訂閱腳本（§5.3）的 `--dry-run` 先列清單。
3. 平台頁確認訂閱狀態回到 `ok`。停用期間的留言 Meta 不會補送，告知租戶。

**E. 大量 PENDING／卡住**

```sql
SELECT "channelId", status, "reasonCode", count(*), min("updatedAt")
  FROM comment_reply_logs WHERE status = 'PENDING' GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

`reasonCode='RATE_LIMIT_QUEUED'` → 正常排隊，估完成時間＝筆數 ÷ 700 小時。其他 → 看 workers 是否在跑（`docker compose ps`、
workers 日誌），重啟 workers 後 sweeper 會自動補回佇列。

**F. 顧客說收到兩則一樣的私訊** → 同一則留言不可能送兩次（唯一鍵＋Meta 限制）。查：

```sql
SELECT "commentId", "ruleId", status, "createdAt" FROM comment_reply_logs
 WHERE "tenantId" = '<tenantId>' AND "commenterExternalId" = '<from.id>' ORDER BY "createdAt";
```

多半是同一人留了多則、規則關了「每人一次」，或命中兩條不同的規則（每則留言各一條）。

**G. 租戶達到每月上限** → 紀錄是 `SKIPPED` + `PLAN_QUOTA_EXCEEDED`。由平台調方案或 `tenants.limitOverrides`；被略過的留言
7 天內可以在詳情按重試。

**H. 緊急停止**（例如 Meta 反垃圾警告、私訊內容出錯）→ 平台頁把 `commentReply.rollout.mode` 改成 `off`（程序內快取最多 60 秒生效）。
webhook 照常回 200 但不再建立紀錄；已在佇列的 job 執行時看到 `off` 記 `SKIPPED` + `ROLLOUT_DISABLED`。若 webhook 量本身造成負擔，
再用補訂閱腳本把 `feed` 拿掉。

**I. 磁碟成長** → 確認 `comment-reply-retention` 有在跑（佇列頁的 completed），`SELECT pg_size_pretty(pg_total_relation_size('comment_reply_logs'));`。

---

## 5. Meta App 設定與審核（維運面）

權限現況、送審材料、錄影腳本、申請順序與退件風險，**全部以 `04-meta-app-review.md` 為準**。重點摘錄與本文件的補充：

### 5.1 要訂的欄位與權限（摘要）

| 平台 | App 層欄位 | 帳號層訂閱 | 權限（細節見 04 §2） |
| ---- | ---- | ---- | ---- |
| FB（平台模式，創造智能 App） | page 主題加 `feed` | `POST /{page-id}/subscribed_apps`，`subscribed_fields` **一定要帶完整清單** `messages,messaging_postbacks,messaging_referrals,message_echoes,feed`（POST 是取代，不是附加） | 收留言＋私訊：`pages_manage_metadata`、`pages_show_list`、`pages_messaging`（已有進階存取）；列貼文：`pages_read_engagement`（被退兩次）；公開回覆：`pages_manage_engagement`（沒申請過） |
| IG（Instagram Login） | instagram 主題加 `comments` | `POST graph.instagram.com/me/subscribed_apps`，同樣帶完整清單 | `instagram_business_basic`、`instagram_business_manage_comments`、`instagram_business_manage_messages`（都沒有進階存取） |

`META_LOGIN_CONFIG_ID` 有設定時，新增權限要改 App 後台的 Facebook Login for Business 設定，改 `LEGACY_SCOPES` 沒用（04 §1.5）。

### 5.2 自備 App 渠道與 IG 渠道的責任歸屬（04 沒有展開，維運必須知道）

程式有兩種 Meta 渠道：

| 渠道 | 用誰的 App | 誰訂 `feed`／`comments`、誰送審 |
| ---- | ---- | ---- |
| FB 平台模式（Facebook 登入連結，`connectMode='platform'`） | 創造智能 App（671495162407854） | 平台（我們） |
| FB 自備 App（手動填 App ID／Secret／粉專權杖） | 租戶自己的 App | **租戶自己**：在他的 App 訂 `feed`、取得權限 |
| IG（手動填 Instagram 應用程式編號／密鑰／權杖） | 填進來的那個 App（創造智能 IG 是哪一個 App 要確認，04 §8.8） | 該 App 的擁有者 |

所以平台的「測試階段」旗標只能代表**平台 App**。前置條件 API 對自備 App 與 IG 渠道回 `appAccessLevel: 'unknown'`，前端顯示
「此渠道使用自有的 Meta App，請確認該 App 已訂閱留言事件並取得權限」，不顯示「測試階段」。這點要回饋給 UX（§9.3）。

### 5.3 既有已連結粉專的補訂閱步驟（只規劃，執行前必須問使用者）

不建議部署時替所有粉專一次訂 `feed`：`feed` 會帶來大量按讚與編輯事件，增加整條 webhook 的負擔與被停用的風險，而且多數租戶的方案
沒有這個功能。做法：

1. **租戶自助**（主要路徑，UX 狀態 B）：租戶按「開啟留言接收」→ API 用該渠道的粉專權杖呼叫 `subscribed_apps`（完整欄位清單）
   → 成功後寫 `settings.commentReply = { enabled: true, subscribedAt, fields }`。只有方案含 feature、灰度允許的租戶看得到按鈕。
2. **平台腳本**（被 Meta 停用後的修復、或替測試粉專開啟）：`apps/api/src/scripts/comment-reply-subscriptions.ts`
   - 參數：`--dry-run`（預設）、`--tenant <id>`、`--channel <id>`、`--mode enable|disable|resubscribe`。
   - `enable`：加 `feed`；`disable`：只留 4 個 messaging 欄位；`resubscribe`：依 `settings.commentReply.enabled` 重訂正確清單。
   - 先 `GET subscribed_apps` 記下原本的欄位，輸出前後對照；任一粉專失敗不中斷其他粉專，最後列出失敗清單。
   - 用 `prismaAdmin`；權杖只在容器內解密，不輸出。
3. **IG**：沒有 OAuth 流程，權杖要重新產生（含 `instagram_business_manage_comments`）並貼回渠道後，才能打 `me/subscribed_apps`。
4. 先後順序（與 04 §6 一致）：程式部署完成（能處理 `feed` 並快速回 200）→ App 層訂閱 → 測試粉專補訂閱 → 實測 → 其他粉專。
   **程式沒上線前就在 App 層訂 `feed`，舊程式雖然會回 200，但等於白收事件；順序反過來沒有風險。**

### 5.4 審核前限制與「測試階段」平台旗標

| 平台設定鍵（`platform_settings`） | 值 | 用途 |
| ---- | ---- | ---- |
| `commentReply.metaAccess` | `{ "fbPrivateReply": "standard"\|"advanced", "fbPublicReply": "...", "fbPostList": "...", "igComments": "..." }` | 平台 App 各能力的存取等級。前置條件 API 依此回 `appAccessLevel` 與 `canPublicReply`；`standard` 時前端顯示「測試階段」（UX 狀態 D）。分項是因為各權限核准時間不同（04：FB 私訊已可用，公開回覆、IG 未過） |
| `commentReply.rollout` | `{ "mode": "off"\|"allowlist"\|"all", "tenantIds": [] }` | 灰度與緊急停止（§6） |
| `commentReply.rateLimits` | `{ "fbPerHour": 700, "igPerHour": 700, "publicReplyPerHour": 300 }` | §3.3 |
| `commentReply.logRetentionDays` | `180` | §3.6 |

- 存放：`platform_settings`（KV，平台層表，沒有 RLS）。`app_tenant` 對它只有 SELECT，租戶的前置條件 API 讀得到，寫入一律走
  平台 API（`prismaAdmin`）。
- 平台 API：沿用 `PUT /api/v1/platform/settings/:key`（既有稽核動作 `setting.update`，已有中文標籤，不必新增）。但這個端點對
  一般鍵**沒有型別檢查**（AUDIT TRIAL-02）；這四個鍵要像 `CONTRACT_REMINDER_DAYS_KEY` 一樣加 Zod 驗證，不合法回 400。
- 平台頁：`/admin/comment-reply`（§8.6）提供表單，不要讓平台管理員手打 JSON。
- 讀取快取：API 與 workers 程序內快取 60 秒；改設定後最多 60 秒生效（runbook H 要寫明）。
- 預設值（沒有這個鍵時）：`metaAccess` 全部 `standard`、`rollout` 為 `off`。也就是部署後功能預設關閉，要平台主動打開。

### 5.5 App Review 時程（維運排程用）

04 §5.5：上次送審實際 13 天，每一輪預留 2～3 週。維運排程建議：

| 里程碑 | 預估 |
| ---- | ---- |
| 程式完成並部署（灰度 off） | 依架構與 tasks |
| App 層訂閱＋測試粉專實測（FB 私訊，平台 App 已有進階權限） | 部署後 1～2 天 |
| FB 私訊對灰度名單開放（不必等審核，若實測證實不需要新權限） | 實測通過後 |
| 修 App 基本資料、錄影、送審（`pages_read_engagement`、`pages_manage_engagement`、IG 三項一次送） | 1 週準備＋2～3 週審核，被退再加 2～3 週 |
| 審核通過 → 改 `metaAccess`、請租戶重新連結 | 審核通過當天 |

---

## 6. 上線與回滾計畫

### 6.1 功能旗標（三層）

1. **方案 feature**（`comment_reply`）：決定哪些方案看得到、權限點會不會被方案天花板擋掉。
2. **灰度** `commentReply.rollout`：決定哪些租戶真的會處理留言。`off` 時前置條件 API 回 `rollout: 'disabled'`，頁面顯示
   「此功能尚未開放」並停用編輯（方案含 feature 的租戶看得到入口，但知道還不能用）；webhook 不建立紀錄；worker 不送出。
3. **Meta 存取等級** `commentReply.metaAccess`：只影響顯示（測試階段）與公開回覆開關，不擋處理。

### 6.2 分階段開放

| 階段 | 灰度 | 對象 | 進入下一階段的條件 |
| ---- | ---- | ---- | ---- |
| 0 部署 | `off` | 無 | migration 成功、§6.4 驗證全過 |
| 1 內部測試 | `allowlist: [創造智能租戶]` | Open333test 粉專（FB）、創造智能 IG；留言者用 App 有角色的帳號 | FB 私訊、IG 私訊、每人一次、7 天過期（改時間測試）、重投去重、收件匣串接都通過；24 小時內沒有 ops-alert |
| 2 創造智能正式粉專 | 同上 | 創造智能粉專的一篇真實活動貼文 | 一場活動（至少數百則留言）跑完，限速排隊、紀錄與用量正確 |
| 3 FB 開放 | `all` | 方案含 feature 的租戶；`metaAccess.fbPrivateReply = advanced`（若實測證實已可用） | 一週內失敗率 < 5%（排除使用者端原因） |
| 4 公開回覆、IG | 不變 | 審核通過後改 `metaAccess` | 審核結果 |

創造智能租戶在哪個方案要先查（§6.3）：若不在 professional／enterprise，階段 1 要由平台用 `limitOverrides` 以外的方式開 feature——
目前**沒有租戶層級的 feature 覆寫**，只能換方案。這是要使用者決定的事（§10）。

### 6.3 部署前檢查（唯讀 SQL，要使用者同意後才在 UAT 執行）

```sql
-- 1. 沒有失敗或卡住的 migration
SELECT migration_name, started_at, finished_at FROM _prisma_migrations
 WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;

-- 2. 方案現況（決定 data migration 會改到誰、limits 是否已有同名 key）
SELECT slug, features, limits, "isActive" FROM plans ORDER BY slug;

-- 3. 各方案的租戶數；創造智能租戶在哪個方案
SELECT p.slug, count(*) FROM tenants t LEFT JOIN plans p ON p.id = t."planId" WHERE t."isActive" GROUP BY 1;
SELECT t.id, t.name, p.slug FROM tenants t LEFT JOIN plans p ON p.id = t."planId" WHERE t.name LIKE '%創造智能%';

-- 4. Meta 渠道與連結模式（補訂閱影響範圍）
SELECT "channelType", credentials_mode, count(*) FROM (
  SELECT "channelType", CASE WHEN "externalAccountId" IS NULL THEN 'no_account_id' ELSE 'ok' END AS credentials_mode
    FROM channels WHERE "isActive" AND "channelType" IN ('FB', 'THREADS')) s GROUP BY 1, 2;
-- 連結模式存在加密憑證裡，SQL 看不到；由平台頁或腳本 --dry-run 列出

-- 5. 表名沒有衝突、conversations 大小（決定 §1.7 索引要不要 CONCURRENTLY）
SELECT relname FROM pg_class WHERE relname LIKE 'comment_%';
SELECT pg_size_pretty(pg_total_relation_size('conversations')), (SELECT count(*) FROM conversations);

-- 6. app_tenant 的預設權限確實不含新表（確認 migration 必須自己 GRANT）
SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl;
```

主機面（唯讀）：`df -h /`（磁碟）、Redis `INFO memory`、`docker compose ps`。

### 6.4 部署後驗證

```sql
-- RLS 與 FORCE
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname IN ('comment_reply_rules','comment_reply_logs','comment_authors','comment_reply_usages','comment_reply_posts');
-- policy
SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'comment_%';
-- GRANT
SELECT t, has_table_privilege('app_tenant', t, 'SELECT,INSERT,UPDATE,DELETE')
  FROM unnest(ARRAY['comment_reply_rules','comment_reply_logs','comment_authors','comment_reply_usages','comment_reply_posts']) t;
-- 方案
SELECT slug, features ? 'comment_reply' AS has_feature, limits->'maxCommentReplyRules', limits->'monthlyCommentReplies' FROM plans;
-- conversations 新欄位
SELECT column_name FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'originCommentReplyLogId';
```

另外：

1. 跑權限 reconcile（§8.4），刪 `perms:tenant:*` 快取（SCAN＋DEL，不可 FLUSHDB）。
2. 平台佇列頁看得到 3 個新佇列，`comment-reply-sweeper`、`comment-reply-retention` 有 completed 紀錄。
3. 平台頁 `/admin/comment-reply` 能開，灰度是 `off`。
4. 既有私訊收發不受影響：用 Open333test 粉專傳一則私訊，確認進收件匣（`/webhooks/meta` 的改動是最大的回歸風險）。
5. API 日誌沒有 `[comment-reply]` 的 error。

### 6.5 回滾步驟

| 狀況 | 動作 | 影響 |
| ---- | ---- | ---- |
| 留言處理出錯、私訊內容出錯 | 灰度改 `off`（runbook H） | 60 秒內停；資料保留 |
| `feed` 事件量拖慢 webhook | 灰度 `off`＋補訂閱腳本 `--mode disable`（經使用者同意） | 停收留言事件；私訊不受影響 |
| 新程式影響既有私訊 | `git revert` 合併到 main → 自動部署舊程式 | 資料表與欄位保留（舊程式不讀）；**不要刪表** |
| 方案 feature 要撤回 | 執行 §2.3 檔頭的回滾 SQL（或在 `/admin/plans` 取消勾選） | 權限快取 10 分鐘內失效 |
| 整個功能下架 | §2.5 的 forward migration | 不可逆，先匯出紀錄 |

---

## 7. 資料治理

### 7.1 哪些是個資

| 資料 | 位置 | 個資？ |
| ---- | ---- | ---- |
| 留言者 ID、名稱、IG 帳號名稱 | `comment_reply_logs`、`comment_authors`、`contacts` | 是 |
| 留言內容 | `comment_reply_logs.commentText` | 是（可能含電話、地址） |
| PSID | `comment_reply_logs.recipientPsid`、`comment_authors.psid`、`channel_identities.uid` | 是（識別碼） |
| 送出的私訊內容快照 | `sentContentSnapshot` | 一般不是（商家內容）；含變數時可能帶個資 |
| 留言 ID、貼文 ID | 紀錄表 | 留言 ID 可經 Graph API 找回留言者，視同識別碼 |
| 貼文摘要快取 | `comment_reply_posts` | 否 |

### 7.2 匿名化與刪除（data-erasure）

`apps/workers/src/handlers/data-erasure.handler.ts` 要處理新表（在既有交易內、沿用「先鎖聯絡人」的順序）：

| 模式 | `comment_reply_logs`（`contactId IN 這批聯絡人`） | `comment_authors` | 其他 |
| ---- | ---- | ---- | ---- |
| `anonymize` | 清空 `commenterExternalId`、`commenterName`、`commenterUsername`、`commentText`、`recipientPsid`、`dedupeKey`，`sentContentSnapshot` 若含變數展開則清空；**保留** `commentId`（防止同一則留言被重送）、狀態、時間、規則 | 刪除 | `channel_identities` 既有邏輯已刪除 |
| `hard_delete` | 刪除（外鍵是 Restrict，漏刪會讓整個硬刪交易失敗，這是刻意的） | 隨聯絡人 Cascade | 刪除前把筆數記進 `affected.commentReplyLogs` |

- `affected` 計數加 `commentReplyLogs`、`commentAuthors`（不含個資）。
- 匿名化後同一個人再留言：`comment_authors` 已刪，會建立新的聯絡人，這是預期行為。
- 沒有聯絡人的紀錄（建立聯絡人失敗的極少數情況）無法經由聯絡人刪除，依保存期限清除。

### 7.3 匯出（data-export）

`apps/workers/src/handlers/data-export.handler.ts` 的租戶匯出加三個 CSV：`comment_reply_rules.csv`、`comment_reply_logs.csv`
（不含 `sentContentSnapshot` 的 JSON 原文，改成摘要欄位）、`comment_authors.csv`。分頁讀取沿用 `fetchAllPaged`。
匯出本身已寫 `data.export.request` 稽核。

UX 待決的「觸發紀錄匯出 CSV」（行銷要名單）是另一件事：它是把留言者名單交給租戶使用者，屬於個資匯出。若第一版做，建議需要
`comment_reply.manage`（不是 view），並寫租戶稽核 `comment_reply.log.export`（帶篩選條件與筆數，不帶內容）。

### 7.4 保存期限與留言刪除

- 紀錄預設 180 天（§3.6），待使用者決定。
- 收到 `feed` 的 `verb=remove`（FB）或 IG 留言刪除事件時：清空該筆紀錄的 `commentText`、寫 `commentDeletedAt`（只做資料庫更新，
  不呼叫 Meta）。顧客刪了留言，系統不應繼續保存內容。這需要架構在解析時多保留 `remove` 事件（§9.3）。
- 公開回覆會留在 Meta 上；租戶要刪的話用 `publicReplyCommentId`。本版不做刪除功能，但欄位先留。

### 7.5 聯絡人合併

`apps/api/src/modules/contact/contact-merge.service.ts` 要把 `comment_reply_logs.contactId`、`comment_authors.contactId` 一起搬到
目標聯絡人，並記進合併紀錄的搬移清單，解除合併時搬回（同 `couponInstance`、`broadcastRecipient` 的做法）。漏了會讓解除合併後
紀錄指向錯的人。

### 7.6 稽核紀錄

| 動作 | 要不要寫 | 理由 |
| ---- | ---- | ---- |
| 規則建立／修改／刪除／啟用切換 | **建議寫**租戶稽核 `comment_reply.rule.create`／`update`／`delete`／`toggle` | 公開回覆是以粉專身分公開發言，出錯時要查得到是誰改的。既有自動化規則沒有稽核，這是待決定事項（§10） |
| 紀錄「重試」 | 建議寫 `comment_reply.log.retry` | 重試會對顧客送出訊息 |
| 開啟／關閉留言接收（補訂閱） | 建議寫 `channel.comment_subscription.update` | 會改 Meta 端設定 |
| 紀錄匯出 CSV（若做） | 必寫 | 個資匯出 |
| 平台改 `commentReply.*` 設定 | 已有 `setting.update` 平台稽核 | 不必新增動作與標籤 |

---

## 8. 平台層（逐項對照 AGENTS.md「Plan the platform layer in the same change」）

| AGENTS.md 項目 | 適用？ | 本 change 做什麼 |
| ---- | ---- | ---- |
| 新增權限點 | 是 | §8.4 |
| 新增方案可開關的功能區塊 | 是 | §8.1 |
| 新增要限制的資源 | 是 | §8.2、§8.3 |
| 呼叫 AI 模型 | 否 | 本功能只做關鍵字比對、送固定內容，不呼叫 AI |
| 新增渠道類型 | 否 | 沿用 FB、THREADS |
| 新增平台要看到或控制的租戶設定或狀態 | 是 | §8.6：訂閱健康狀態、灰度、Meta 存取等級 |
| 寫新的平台稽核動作 | 否（建議） | 平台設定沿用 `setting.update`。若架構改成專用端點（不走 settings），要新增動作並在 `PLATFORM_AUDIT_ACTION_LABELS` 加標籤 |
| 新增 BullMQ 佇列 | 是 | §4.1：3 個佇列加進 `monitored-queues.ts` |
| 租戶與平台之間的請求 | 否 | 沒有申請流程；租戶達上限走既有的方案升級申請（`PlanChangeRequest`） |

### 8.1 Feature

`packages/core/src/rbac/features.ts`：

```ts
{ slug: 'comment_reply', label: '留言自動私訊', desc: 'FB 粉專與 IG 貼文留言關鍵字自動私訊、公開回覆、觸發紀錄' },
```

| 方案 | 建議包含？ | 建議上限（規則數／每月私訊） | 理由 |
| ---- | ---- | ---- | ---- |
| trial（免費試用） | 否 | — | 審核前只有測試帳號能用，試用租戶多半不是 App 角色；要給試用時可改為 2／100 |
| light（輕量版） | 否 | — | |
| standard（標準版） | 否 | — | |
| professional（專業版） | 是 | 10／3,000 | 已有 marketing（優惠券），留言領券是主要玩法 |
| enterprise（企業版） | 是 | 無上限／無上限 | |

可重跑的 data migration 見 §2.3；`SEED_PLANS` 同步改。平台方案頁的 feature 清單由 `/platform/registry` 動態提供，不必改前端。

### 8.2 上限鍵

| 上限鍵 | `LIMIT_KEYS` 標籤 | 計數方式 | 檢查點 | 超過時 |
| ---- | ---- | ---- | ---- | ---- |
| `maxCommentReplyRules` | 留言私訊啟用規則數 | 本租戶 `isActive = true AND deletedAt IS NULL` 的規則數（全部渠道合計） | (1) 建立規則且 `isActive=true`；(2) 停用→啟用；(3) 修改時把 `isActive` 改成 true。停用中的規則不計 | `AppError('已達方案留言自動私訊規則數上限，請停用其他規則或升級方案', 'PLAN_LIMIT_EXCEEDED', 403, { limitKey, current, max })`，與 `maxChannels` 相同格式 |
| `monthlyCommentReplies` | 留言私訊每月則數 | `comment_reply_usages.sentCount`（台灣時間當月）；只算私訊，公開回覆不計 | worker 呼叫 Send API **之前**原子占名額（§8.3） | 紀錄 `SKIPPED` + `reasonCode='PLAN_QUOTA_EXCEEDED'`，不送出；當月第一次達上限通知租戶管理員 |

- `plan-limits.service.ts` 的 `LimitKey` 型別加這兩個；`resolveEffectiveLimit` 不必改（只有 `monthlyTokens` 有加購）。
- `apps/web/src/app/admin/plans/page.tsx` 的 `LIMIT_KEYS` 加兩行。
- 降級（換到較低方案）時**不自動停用**超過上限的規則，與 `maxChannels`「只擋新建」一致；方案頁換方案時若超過，提示平台管理員。
  替代方案（worker 只套用前 N 條）會讓規則「看起來啟用卻不生效」，不建議。
- 方案拿掉 feature 時：權限被天花板擋掉（頁面消失），worker 在送出前檢查 feature，記 `SKIPPED` + `PLAN_FEATURE_DISABLED`。
- 新增的原因代碼 `PLAN_QUOTA_EXCEEDED`、`PLAN_FEATURE_DISABLED`、`ROLLOUT_DISABLED`、`RATE_LIMIT_QUEUED` 要補進 UX §4.3 的對照表。

### 8.3 每月私訊數的原子計數

在 worker 的「占名額」短交易（`withTenant`）內：

```sql
INSERT INTO comment_reply_usages ("tenantId", month, "sentCount", "updatedAt")
VALUES ($tenant, $month, 0, now()) ON CONFLICT DO NOTHING;

UPDATE comment_reply_usages SET "sentCount" = "sentCount" + 1, "updatedAt" = now()
 WHERE "tenantId" = $tenant AND month = $month
   AND ($limit IS NULL OR "sentCount" < $limit)
RETURNING "sentCount";
-- 沒有回傳列＝已達上限 → 記 PLAN_QUOTA_EXCEEDED
```

- Meta 明確拒絕（沒有送達：`USER_UNAVAILABLE`、`COMMENT_NOT_FOUND`、`ALREADY_REPLIED` 且不是自己上一次送的）→ 同一個短交易把
  `sentCount - 1` 還回去。網路逾時、不確定有沒有送達 → 不還（寧可少算給租戶一則，也不要超發）。
- `$month` 用 `taipeiMonthStart()` 的月份，與 AI 月額度同一套時間切法。
- 租戶覆寫：`tenants.limitOverrides.monthlyCommentReplies` 自動生效（`resolveEffectiveLimit` 既有邏輯）；目前平台前端沒有覆寫的
  編輯畫面，要調整只能經 API，這是既有狀況。
- 用量顯示：租戶頁面摘要列加「本月已私訊 X／Y」（讀 `comment_reply_usages`）；平台 `/admin/usage` 的租戶詳情建議加一欄。

### 8.4 權限點與 reconcile

`packages/shared/src/rbac/permissions.ts`：

```ts
// ── 留言自動私訊（feature: comment_reply）──
{ code: 'comment_reply.view', group: '留言自動私訊', feature: 'comment_reply', label: '檢視留言自動私訊', description: '規則列表、觸發紀錄、試算' },
{ code: 'comment_reply.manage', group: '留言自動私訊', feature: 'comment_reply', label: '管理留言自動私訊', description: '建/改/刪規則、排序、重試', dependsOn: ['comment_reply.view'], implies: ['channel.view'] },
```

`implies` 是否要加素材檢視權限由架構依素材挑選 API 決定。預設角色建議：admin、supervisor 兩個都給；agent 給 `view`
（收件匣的「查看留言紀錄」連結用），待使用者決定。

部署後（`project` 記憶「新增權限點要跑 reconcile」）：

```bash
# 在 UAT 主機（要先取得使用者同意）；用 owner 連線，腳本會對每個租戶重建 system role 權限
docker compose exec api sh -c 'DATABASE_URL="$MIGRATE_DATABASE_URL" node scripts/reconcile-system-role-permissions.mjs'
# 然後用 SCAN 刪 Redis 的 perms:tenant:* （不可 FLUSHDB）
```

（執行前確認 `scripts/` 在 API 映像內的實際路徑；不在映像內時改在主機 `/srv/open333crm` 以 node 映像執行。）
只動 system role；租戶自訂角色不會自動拿到新權限，要租戶自己勾。

### 8.5 佇列

`comment-reply`、`comment-reply-sweeper`、`comment-reply-retention` 加進 `WORKERS_QUEUES`（§4.1）。workers 的 `plugin-registry.ts`
要有 FB 與 THREADS 外掛的新方法（結構規則 5：兩個行程都要註冊）。

### 8.6 平台頁 `/admin/comment-reply`

提案說「平台團隊是否要看到各租戶 Meta 訂閱狀態，由 SRE 評估」——**建議要**，理由：

1. 「測試階段」旗標與灰度本來就需要平台頁面設定（不能讓人手打 JSON）。
2. webhook 被 Meta 停用會同時影響多個租戶，平台要一眼看出是哪些粉專；否則只能 SSH 進 UAT 查。
3. 記憶「新功能要連同平台層一起做」。

內容：

- 設定區：灰度（off／指定租戶／全部，租戶用下拉選）、Meta 存取等級（四個能力各一個開關）、限速、保存天數。走 `PUT /platform/settings/:key`。
- 健康區：§4.3 的渠道表與全平台指標。API `GET /api/v1/platform/comment-reply/health`（`prismaAdmin`，平台 guard），
  加進 `check-prisma-admin-usage.mjs` 的白名單（平台層路徑）。
- 平台佇列頁已能看失敗 job，不重複做。

---

## 9. 風險、QA 交接、與架構對齊

### 9.1 風險

| 編號 | 風險 | 影響 | 緩解 |
| ---- | ---- | ---- | ---- |
| R1 | webhook 先回 200 再在同一行程處理，部署重啟時遺失事件 | 少數留言沒觸發，Meta 不重送 | 背景處理只做最少的事；API 關機等背景處理完成；runbook 告知部署時段可能漏 |
| R2 | `feed` 事件量（按讚、編輯）拖慢 webhook，連續失敗 1 小時被 Meta 停用 | **私訊也一起收不到**，影響所有租戶 | 只替開了留言接收的粉專訂 `feed`；非留言事件解析後立刻丟；訂閱檢查告警；補訂閱腳本 |
| R3 | 補訂閱時只帶 `feed` | 粉專 messaging 訂閱被取代掉，私訊收不到 | 補訂閱程式一律帶完整清單並在測試中斷言；腳本先 GET 再 POST，輸出前後對照 |
| R4 | FB 留言 `from.id` ≠ PSID | 私訊失敗的留言者之後自己傳私訊會變成第二位聯絡人 | `comment_authors` 對應表；階段 1 實測確認；若相同則簡化 |
| R5 | Meta 每小時 750 則限速 | 熱門活動排隊十幾小時，超過 7 天的過期 | 限速排隊不算失敗、UX 文案、`RATE_LIMIT_QUEUED` 顯示、每人一次預設開 |
| R6 | 公開回覆被 Meta 判定垃圾留言 | 粉專被限制留言 | 預設關閉、輪流文字、公開回覆限速 300／小時、私訊失敗不公開回覆 |
| R7 | 漏 GRANT `app_tenant` | 租戶 API 全部 `permission denied`（42501） | §2.2 的迴圈寫法；`platform-table-grants.test.ts` |
| R8 | 方案缺上限鍵＝無上限 | professional 租戶無限私訊 | data migration 明確寫入；部署後驗證 SQL |
| R9 | 紀錄表成長塞滿 UAT 磁碟 | 整個系統停擺 | 保存期限清除、平台頁顯示表大小、部署前看磁碟 |
| R10 | 自備 App／IG 渠道的權限不在平台掌控 | 租戶以為壞了 | 前置條件回 `unknown` 並說明；訂閱檢查告訴租戶缺什麼 |
| R11 | `sendAttemptedAt` 後程式中斷，重試收到「已私訊過」 | 被誤記成失敗 | 重試且 `sendAttemptedAt` 有值時，把 `ALREADY_REPLIED` 視為已送出（`reasonCode='SENT_UNCONFIRMED'`），不還名額 |
| R12 | 灰度 off 但方案含 feature | 租戶看到入口卻不能用、客訴 | 頁面明確顯示「尚未開放」；或延後執行方案 migration（§10 決定） |

### 9.2 給 QA 的交接重點

資料庫與 RLS（`pnpm test:feature`）：

1. 5 張新表都 FORCE RLS：未綁定租戶 count = 0；綁 A 看不到 B；INSERT 別的租戶的 `tenantId` 被 policy 擋下。
2. `app_tenant` 對 5 張表有四種權限（`platform-table-grants.test.ts` 自動涵蓋）。
3. 複合外鍵：用 A 租戶的 `tenantId` 參照 B 租戶的 `channelId`／`ruleId` → 外鍵錯誤。
4. `UNIQUE (channelId, commentId)`：同一則留言並行兩次寫入，只有一筆。
5. 部分唯一 `dedupeKey`：同一人兩則留言並行 → 一筆 `PENDING`、一筆 `SKIPPED_DUPLICATE`；第一筆改成 `FAILED` 後第三則留言可以 `PENDING`。
6. `monthlyCommentReplies` 邊界：上限 3、並行 5 個 job → 恰好 3 個 `SENT`、2 個 `PLAN_QUOTA_EXCEEDED`；Meta 拒絕會還名額；
   跨月（台灣時間 00:00）重新計算。
7. `maxCommentReplyRules`：上限 2，建立第 3 條啟用規則 403 `PLAN_LIMIT_EXCEEDED`；建立停用規則可以；啟用時再擋。
8. erasure：匿名化後紀錄的名稱、內容、外部 ID 清空，`commentId` 保留；硬刪除會刪紀錄，漏刪時整個交易失敗。
9. 合併與解除合併：紀錄、留言者跟著搬、搬回。
10. 匯出 zip 含三個新 CSV，且只有本租戶資料。
11. 保存期限清除：建立 181 天前的紀錄 → 清除後消失，對話的 `originCommentReplyLogId` 變 NULL。

維運：

12. 3 個新佇列在 `monitored-queues.test.ts` 通過；job 重試用完會產生 ops-alert。
13. 業務失敗（`USER_UNAVAILABLE`）不讓 job 失敗、不產生 ops-alert。
14. 限速：bucket 空時 job 延後、不消耗 attempts；Meta 回 613 時該渠道暫停。
15. 補訂閱：POST 的 `subscribed_fields` 一定包含原本 4 個 messaging 欄位（這條最重要，壞了會讓私訊全斷）。
16. 灰度：`off` 時 webhook 不寫紀錄、已排隊 job 記 `ROLLOUT_DISABLED`；`allowlist` 只處理名單內租戶。
17. 平台設定鍵型別檢查：不合法的值回 400。
18. 回歸：既有 FB／IG 私訊收發、`message_echoes` 不會讓補進對話的私訊重複。

實機（UAT，要使用者同意，04 §4.2）：Open333test 粉專留關鍵字收私訊；同一則留言 Meta 重投不重送；IG 同流程；看 webhook 有沒有
帶留言者名稱；確認 FB `from.id` 與 PSID 是否相同（R4）。

### 9.3 要與架構 agent（02）對齊的點

1. **比對放在哪裡**：本文件假設 API 在 webhook 背景處理時就比對規則（有快取），只有命中的才寫 `PENDING` 紀錄與丟佇列。
   若架構改成「全部留言丟佇列、worker 比對」，佇列量會變成 10 倍以上，§3.4 的設定與 Redis 記憶體估算要重算。
2. **紀錄由誰建立**：本文件假設 webhook 端 `INSERT ... ON CONFLICT DO NOTHING` 建立 `PENDING`，job 只帶 `logId`；
   sweeper 依資料庫補回。
3. **jobId**：`cr-<logId>`，不能有冒號。
4. **不在交易內呼叫 Meta**；`sendAttemptedAt` 的語意與 `ALREADY_REPLIED` 的判斷（R11）。
5. **`comment_authors` 與 `channel_identities` 的建立時機**、P2002 時改用先到者、孤兒聯絡人回收（§1.4）。
6. **對話與補進的私訊**：誰建立對話、何時寫 `originCommentReplyLogId`；補進的私訊用 `channelMsgId=message_id`，與 echo 處理對齊，
   避免既有 echo 流程另外建對話或重複寫入。
7. **解析時保留 `verb=remove`**（只用來清 `commentText`，§7.4）。
8. **限速**：Redis token bucket＋`moveToDelayed`，數字來自平台設定。
9. **ops-alert 在 API 行程**：判斷放 API 的 `comment-reply-health` 排程，workers 不直接發告警。
10. **原因代碼清單**加 `PLAN_QUOTA_EXCEEDED`、`PLAN_FEATURE_DISABLED`、`ROLLOUT_DISABLED`、`RATE_LIMIT_QUEUED`、`SENT_UNCONFIRMED`，
    UX §4.3 要同步。
11. **前置條件 API** 回 `rollout`、依連結模式回 `appAccessLevel`（平台 App 才看 `metaAccess`，自備 App／IG 回 `unknown`）。
12. **審核前留言事件可能根本進不來**：IG 文件寫 `comments` 通知需要 Advanced Access，FB 也可能只送 App 角色的留言。UX 狀態 D 說
    「一般顧客留言會記為失敗：不在 App 的測試名單內」，實際上可能**連紀錄都沒有**。文案要改成不依賴這個行為，以階段 1 實測為準。
13. **貼文快取** `comment_reply_posts` 要不要做（§1.6）。
14. **服務函式形狀**：新服務收 `TenantCtx`、副作用放 flow（記憶 #337），`check-tenant-ctx.mjs --strict` 要過。

### 9.4 Definition of done 中與本文件有關的項目

- `scripts/check-tenant-scoping.mjs` 的 `TENANT_MODELS` 加 5 個 model；`check-prisma-admin-usage.mjs` 白名單加平台健康 API 與補訂閱腳本。
- `docs/ref/DATABASE-ERD.md`、`docs/16_DB_SCHEMA.md` 補新表與索引理由；`docs/ref/modules/CHANNEL-PLUGINS.md` 補新方法；
  `docs/ref/features/platform/` 補四個平台設定鍵與 `/admin/comment-reply`。
- CHANGELOG `## [YYYY-MM-DD]` 區段。

---

## 10. 需要使用者決定的事

1. **哪些方案包含、上限多少**：建議 professional（10 條啟用規則／每月 3,000 則）與 enterprise（無上限）；trial 要不要給（例如 2／100）。
2. **灰度期間方案 migration 何時執行**：A（建議）部署時就加進方案，灰度 off 時頁面顯示「尚未開放」；B 等階段 3 才執行方案 migration，
   期間其他租戶完全看不到入口。但目前沒有租戶層級的 feature 覆寫，選 B 時創造智能租戶必須本來就在含 feature 的方案（例如企業版），否則它也用不到。要先查創造智能在哪個方案（§6.3）。
3. **紀錄保存天數**：建議 180 天（可在平台調 30～730）。
4. **規則異動要不要寫租戶稽核**（既有自動化規則沒有寫）：建議寫，因為公開回覆是公開發言。
5. **agent 角色預設要不要有 `comment_reply.view`**。
6. **觸發紀錄匯出 CSV**（UX 待決）若做，權限用 `manage` 並寫稽核。
7. **平台頁 `/admin/comment-reply` 這一版就做**（建議）或延後。
8. **UAT 上的動作**（都要你同意才做）：部署前後的唯讀 SQL、reconcile、App 層訂閱、測試粉專補訂閱、審核相關操作（見 04 §8）。
9. **Meta 審核時程**（提案待決 5）：04 §6 的「FB 私訊先上線、IG 與公開回覆等審核」節奏，本文件的分階段計畫照這個節奏排；
   若要全部等審核通過一起上，階段 3 延到審核通過之後。
