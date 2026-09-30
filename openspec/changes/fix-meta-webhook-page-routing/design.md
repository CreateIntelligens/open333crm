## Context

- FB／IG webhook 路由：`POST /api/v1/webhooks/fb/:channelId`、`/threads/:channelId` → `processWebhookEvent(prismaAdmin, io, channelId, type, rawBody, headers)`。
- `processWebhookEvent` 以網址 `channelId` 載入渠道、用其 `appSecret` 驗簽、`parseWebhook` 攤平所有 `entry[].messaging[]`，再把**每一則**都以網址渠道與其租戶交給 `processInboundMessage`。`entry.id` 在插件解析時就被丟掉。
- 出站（API `conversation.service`、worker `channel-delivery`、群發）一律以 `conversation.channelId` 取憑證；**入站只要派對渠道，出站自然正確**。
- 粉專 ID 目前只存在加密的 `credentialsEncrypted`（FB 的 `pageId` 選填且沒有程式讀它；IG 沒有帳號 ID 欄位），無法查詢、無法做唯一限制。
- Meta：一個 App 的 `page` 物件只有一個回呼網址；`instagram` 物件可另設。IG Login 的 `/me` 回傳 `id`（App 範圍使用者 ID）與 `user_id`（IG 專業帳號 ID = webhook `entry.id`），系統目前取錯欄位。

## Goals / Non-Goals

**Goals**
- 事件依 `entry.id` 落到真正擁有該粉專／IG 帳號的渠道與租戶；對不上時絕不落進別的租戶。
- 一個粉專／IG 帳號全平台只能連結一次。
- 分派異常要讓後台看得到，不只寫 log。
- 部署過渡期既有渠道不斷線。
- 長期由平台持有 Meta App，租戶不必處理 App Secret。

**Non-Goals**
- 不強制既有「自備 App」渠道遷移到平台 App。
- 不處理 WhatsApp、LINE。
- 第 3 階段的 IG（Facebook Login 路線）只做評估與介面預留，不在本 change 實作送訊。

## Decisions

### D1 外部帳號 ID 欄位
`Channel.externalAccountId String?`，`@@unique([channelType, externalAccountId])`。FB = 粉專 ID；THREADS（IG）= IG 專業帳號 ID（`user_id`）。nullable：Postgres 唯一索引允許多筆 NULL，既有資料不擋建索引。唯一索引為全域檢查、不受 RLS 過濾——正是要的「全平台只能連一次」。

替代方案：把 ID 放 `settings` JSON 加表達式唯一索引。否決：Prisma 無法宣告、`patchChannelSettings` 的原子合併容易誤清，且查詢不走型別。

### D2 分派演算法（`processWebhookEvent`）
1. 以網址渠道驗簽（維持現狀；第 3 階段平台端點改用平台 secret）。
2. `parseWebhook` 回傳的每則帶 `accountId`；依 `accountId` 分組（一個 payload 可能含多個粉專的 entry，Meta 會批次推送）。
3. 每組以 `prismaAdmin.channel.findUnique({ where: { channelType_externalAccountId } })` 找目標渠道（`findUnique` 走複合唯一鍵，`check-tenant-scoping` 歸類為 UNIQUE_BY_KEY）。
4. 目標渠道檢查：`isActive`、`tenant.isActive`、**解密後 `appSecret` 與驗簽用的相同**（同一個 Meta App 才可能合法送達；否則是有人用自己 App 的簽章灌事件到別人的粉專 → 丟棄並警示）。
5. 找不到目標渠道：
   - 網址渠道 `externalAccountId` 為 NULL（尚未回填）→ **相容模式**：交給網址渠道處理（等同舊行為），並在網址渠道記警示「尚未取得帳號 ID，請按驗證」。
   - 網址渠道已有 `externalAccountId` 且不同 → **丟棄**，在網址渠道記警示「收到不屬於本渠道的帳號 {accountId} 的事件」。
6. 每組以目標渠道的憑證、租戶跑既有 `processInboundMessage`。

相容模式的風險：未回填的網址渠道仍可能收進別的粉專事件。緩解：部署後立即跑回填（D6），警示會讓後台看見哪些渠道還沒有帳號 ID。

### D3 分派警示要看得到
寫入網址渠道 `settings.webhookRouting = { reason, accountId, lastAt }`（以 `patchChannelSettings` 原子更新，並加入 `SYSTEM_MANAGED_SETTING_KEYS`）。渠道管理卡片顯示警示與處理建議。對網址渠道的租戶揭露的只有「另一個帳號 ID」，而該租戶本來就持有這個 App——可接受。另寫 `logger.warn` 供維運追查。

同一原因＋同一帳號 10 分鐘內只寫一次（SQL 條件節流），避免每則事件都寫 DB；驗證成功寫入帳號 ID 時清除警示。

### D4 下游轉發
`downstreamWebhook`（immediate／after）轉的是**原始 body 與簽章**，無法拆包重簽。規則：只有當 payload 內所有 entry 都分派到網址渠道本身時才轉發；否則略過轉發並記警示。immediate 模式的短路也只在此條件成立時生效。

### D4b 帳號 ID 只由驗證寫入
帳號 ID 必須來自以該渠道 token 向 Meta 查得的結果（等於證明持有者管理該帳號），**不接受表單手填**：共用同一個 Meta App 時，手填別人的粉專 ID 就能把別的租戶的訊息搶過來。前端移除手填的 Page ID 欄位；更新 FB／IG 渠道的 token 或 App Secret 時清空帳號 ID，等重新驗證（期間走相容模式）。

### D5 重複連結的錯誤
`createChannel`／`updateChannel`／`verifyChannel` 寫入 `externalAccountId` 撞 P2002 → `AppError('此粉專／IG 帳號已連結到其他渠道，同一個帳號只能連結一次', 'CHANNEL_ACCOUNT_ALREADY_LINKED', 409)`。這會揭露「該帳號已被某處連結」，但不揭露是哪個租戶；為防止重複連結所必需，可接受。verify 撞重複時驗證本身仍回報失敗原因，不靜默。

### D6 回填與上線順序
1. migration（加欄位＋唯一索引，須用 owner 的 `MIGRATE_DATABASE_URL`）。
2. 回填腳本（dry-run 預設、`--apply` 才寫）：逐一對既有 FB／IG 渠道呼叫 verify 取得帳號 ID；先在記憶體比對重複，**衝突的全部不寫**並列出（交由人工停用其一）。
3. UAT 已知衝突：Open333test 粉專在預設租戶有 test333、Demo Facebook 兩筆 → 需先停用其一。

### D7 IG 帳號 ID
IG Login 驗證改打 `graph.instagram.com/{v}/me?fields=user_id,username`，以 `user_id` 寫入 `externalAccountId`；`username` 照舊寫 `bindingHandleAuto`。插件的 echo 過濾維持 `sender.id === entry.id`。

### D8 第 3 階段：平台 Meta App
- **設定**：env `META_APP_ID`、`META_APP_SECRET`、`META_WEBHOOK_VERIFY_TOKEN`、`META_LOGIN_CONFIG_ID`（Facebook Login for Business 設定 ID）。沿用 env 與 Gemini 平台金鑰一致；不放 `platform_settings`（該表 GET 會原樣回傳，沒有遮罩）。
- **平台 webhook**：`GET/POST /api/v1/webhooks/meta`。GET 以平台驗證權杖回 challenge；POST 以平台 App Secret 驗簽，依 `object`（`page` → FB、`instagram` → THREADS）與 `entry.id` 走 D2 的分派（沒有網址渠道，所以找不到就一律丟棄＋平台層 log）。
- **渠道連結模式**：credentials 加 `connectMode: 'platform' | 'own_app'`。`platform` 渠道不存 appSecret；D2 步驟 4 的比對改為「驗簽 secret 為平台 secret 且目標渠道為 platform 模式」。
- **連結流程**：
  1. `POST /api/v1/meta-connect/start`（需 `channel.manage`）→ 產生 state（Redis，10 分鐘，綁租戶＋操作者，一次性）→ 回傳 Facebook Login 網址。
  2. `GET /api/v1/meta-connect/callback` → 驗 state、以 code 換 user token → 換長效 user token → `/me/accounts` 取粉專清單與 Page token；user token 與 Page token 以 `encryptCredentials` 加密暫存 Redis（同 state），**不回傳給前端**；轉址回前端選擇頁。
  3. `GET /api/v1/meta-connect/pages?state=` 只回粉專 ID、名稱、頭像、是否已被連結。
  4. `POST /api/v1/meta-connect/pages` 選定 → 建立新渠道（不自動轉換同帳號的既有自備 App 渠道，見 Risks）、寫 `externalAccountId`、呼叫 `POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_referrals,message_echoes` → 成功才完成；失敗回報並不留半套渠道。
- 模組放 `apps/api/src/modules/meta-connect/`，callback 需 `prismaAdmin`（無登入 session）→ 加入 `check-prisma-admin-usage.mjs` 白名單。

### D9 code review 後的修正（2026-09-30）
- **停用的渠道不可佔住帳號 ID**：停用渠道時清空 `externalAccountId`；另以 `SECURITY DEFINER` 函式 `release_inactive_channel_account(type, account)` 只釋放「停用渠道或停用租戶」持有的 ID，驗證／平台連結撞到唯一衝突時先呼叫再重試一次。啟用中的連結一律不動（已以 `app_tenant` 身分實測：看不到別租戶的列，但能釋放別租戶停用渠道的 ID）。
- **分派時目標已停用視同未認領**（不再安靜吞掉），依 D2-5 走相容模式或丟棄＋警示。
- **immediate 下游遇混包**：網址渠道自己的事件改由 CRM 處理（寧可重複不可遺失），並顯示警示。
- **改派到有下游設定的目標渠道**：照常處理並在目標渠道留 `downstream_skipped` 警示。
- **驗證必須取得真正的帳號 ID**：FB 要求回應含 `category`（粉專才有；個人使用者權杖會被擋），IG 回應沒有 `user_id` 時驗證失敗。
- 更新 FB／IG 權杖後自動重新驗證，縮短相容模式空窗；建立渠道時濾掉系統維護的 settings 欄位。
- 平台連結模式的渠道不做下游轉發（平台層事件）。

## Risks / Trade-offs

- **相容模式期間仍可能錯置**（D2-5）：回填完成、警示清零之前，未取得帳號 ID 的網址渠道仍照舊收件。→ 部署清單把回填列為必做，並在渠道卡片顯示「尚未取得帳號 ID」。
- **唯一限制可能擋到既有資料**：索引本身允許 NULL 不會失敗；回填時衝突不寫入並列出。
- **存在性揭露**（D5）：可接受的取捨。
- **Meta 審查時程不可控**（第 3 階段）：程式可先完成並以 App 測試者身分驗證，正式開放給租戶要等審查通過。
- **自備 App 與平台 App 同一粉專**：唯一限制會擋下重複連結；租戶要改用平台模式需先刪除（或停用並清空帳號 ID）舊渠道，UI 提示說明。

## Migration Plan

見 D6；第 3 階段另加：設定平台 env → Meta 後台把平台 App 的 `page`（與日後 `instagram`）回呼網址設為 `/api/v1/webhooks/meta` → 既有自備 App 渠道不受影響。回滾：第 1 階段邏輯可由 feature flag `META_WEBHOOK_ROUTING=legacy` 退回純網址分派（保留一版後移除）；欄位與索引可保留不影響舊邏輯。
