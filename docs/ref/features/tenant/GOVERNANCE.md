# 稽核、資料權利與對外整合

這一組功能有 API、沒有後台頁面：查詢租戶的操作紀錄、匯出租戶資料、刪除單一客人的個人資料、把系統事件推送給外部系統，以及讓 AI 工具以 MCP 操作租戶資料。稽核、匯出、刪除與對外 Webhook 也沒有 CLI 指令或 MCP 工具，只能直接呼叫 API。

- **資料來源**：`apps/api/src/modules/tenant-audit/*`、`apps/api/src/modules/data-export/*`、`apps/api/src/modules/data-erasure/*`、`apps/api/src/modules/webhook-subscriptions/*`、`apps/api/src/modules/mcp/*`、`apps/workers/src/handlers/data-export.handler.ts`、`apps/workers/src/handlers/data-erasure.handler.ts`
- **核對日期**：2026-11-19

## 負責的模組

| 功能 | 模組 | 路由前綴 | 權限 |
| --- | --- | --- | --- |
| 租戶稽核日誌 | `tenant-audit` | `/api/v1/tenant/audit-logs` | `audit.view` |
| 資料匯出 | `data-export` | `/api/v1/tenant/data-export` | `data.export` 加 `channel.view_all` |
| 資料刪除 | `data-erasure` | `/api/v1/tenant/data-erasure` | `data.erase` |
| 對外 Webhook | `webhook-subscriptions` | `/api/v1/webhook-subscriptions` | `webhook.view`、`webhook.manage` |
| MCP | `mcp` | `/mcp` | 帶 `mcp:read` scope 的 CLI token，再依工具檢查 scope |

系統角色裡只有 admin 有 `audit.view`、`data.export`、`data.erase` 與 `webhook.manage`。supervisor 有 `webhook.view`，所以讀得到訂閱的 `secret`。`data.erase` 的前置權限是 `contact.view`。API 金鑰、CLI token 與 MCP 的設定流程屬於[租戶設定](./SETTINGS.md)。

## 程式的入口

路由前綴登記在 `apps/api/src/index.ts`。下表的路徑省略 `/api/v1`。

| 端點 | flow 或 service 函式 | 要知道的事 |
| --- | --- | --- |
| `GET /tenant/audit-logs?action&actorId&from&to&page&pageSize` | `tenant-audit.flow.ts` 的 `listTenantAuditFlow` → `listTenantAudit()` | `pageSize` 最多 100，預設 20。`action` 只能完全比對，不能用前綴（例如 `agent.*`），也不能依 `targetType`、`targetId` 查詢（HC-GOVERNANCE-13） |
| 各模組寫稽核 | `tenant-audit.service.ts` 的 `recordTenantAudit(ctx, …)`；舊寫法 `writeTenantAudit(prisma, …)` | 見[租戶稽核日誌](#租戶稽核日誌) |
| `POST /tenant/data-export`，body `{ scope? }` | `data-export.flow.ts` 的 `requestExportFlow` → `createExportRequest()` | 同一個交易建立 `pending` 申請、寫 `data.export.request` 稽核、把匯出工作寫進 outbox。`scope` 是任意字串陣列 |
| `GET /tenant/data-export/:id` | `getExportRequestFlow` | |
| `GET /tenant/data-export/:id/download` | `getExportDownloadFlow` → `findDownloadableExport()`、`countExportDownload()` | 回傳 15 分鐘有效的 presigned URL，`downloadCount` 加一。下載不寫稽核（HC-GOVERNANCE-03） |
| `POST /tenant/data-erasure`，body `{ contactId, mode?, reason? }` | `data-erasure.flow.ts` 的 `requestErasureFlow` → `createErasureRequest()` | `mode` 只收 `anonymize`（預設）與 `hard_delete`。聯絡人不屬於這個租戶時回 404 `CONTACT_NOT_FOUND`。不檢查成員看不看得到聯絡人的渠道（HC-GOVERNANCE-05） |
| `GET /tenant/data-erasure/:id` | `getErasureRequestFlow` | 沒有列出刪除申請的端點，只能用 ID 查一筆（HC-GOVERNANCE-07）。回應原樣帶出 `reason`（HC-GOVERNANCE-14） |
| `GET`、`POST /webhook-subscriptions`；`GET`、`PATCH`、`DELETE /webhook-subscriptions/:id` | `webhook-subscription.flow.ts` 的 `listSubscriptionsFlow`、`createSubscriptionFlow`、`getSubscriptionFlow`、`updateSubscriptionFlow`、`deleteSubscriptionFlow` | 建立與修改時以 `isBlockedUrl()` 檢查網址，只接受指向公開位址的 HTTPS 網址。刪除是硬刪除。建立、修改、刪除與測試都不寫稽核（HC-GOVERNANCE-04） |
| `GET /webhook-subscriptions/:id/deliveries?limit` | `listDeliveriesFlow` | `limit` 預設 50，沒有上限，負數也接受（HC-GOVERNANCE-12） |
| `POST /webhook-subscriptions/:id/test` | `webhook-dispatcher.ts` 的 `dispatchWebhook()` | 在請求內送一次 `webhook.test`，不重試 |
| 事件轉送（系統） | `webhook-dispatcher.ts` 的 `setupWebhookDispatcher()`、`processWebhookDelivery()` | 見[對外 Webhook](#對外-webhook) |
| 匯出、刪除的背景工作 | `apps/workers/src/handlers/data-export.handler.ts`、`data-erasure.handler.ts` | 匯出清理是 workers 每小時一次的 `data-export-cleanup` 工作 |

前端沒有任何頁面呼叫這些 API。匯出完成通知的連結 `/dashboard/settings/data-export/<申請 ID>` 打開是 404（EXPORT-01）。Webhook 的 `events` 是任意字串陣列，打錯名稱不報錯（HOOK-01）。

## 租戶稽核日誌

各模組在重要操作後寫入租戶稽核：操作者、動作、對象、`payload` 與 IP。已搬到 `TenantCtx` 的模組（例如 `role`、`agent`）由 flow 在同一個交易內呼叫 `recordTenantAudit()`，稽核與資料一起 commit，寫入失敗時整筆 rollback。其他模組仍在交易外呼叫 `writeTenantAudit()`，寫入失敗只記 log。`writeTenantAudit()` 會接住錯誤，所以不能在交易內呼叫：錯誤被接住時，交易已經失效。系統或排程寫的稽核可以沒有操作者（`actorId` 是空值）。`GET /tenant/audit-logs` 可以依動作、操作者與時間區間查詢，每頁最多 100 筆。

目前會寫稽核的動作：

| 範圍 | 動作 |
| --- | --- |
| 成員 | `agent.create`、`agent.role.assign`、`agent.password.reset`、`agent.deactivate`、`agent.reactivate`、`agent.purge`、`agent.channels.set` |
| 角色 | `role.create`、`role.rename`、`role.delete`、`role.permission.update` |
| 渠道 | `channel.create`、`channel.delete`、`channel.assign_team`、`channel.revoke_team`、`channel.comment_subscription.update`。「用 Facebook 連結粉專」建立渠道寫 `channel.create`，重新連結既有渠道寫 `channel.update` |
| 設定 | `settings.update`，`payload.section` 記錄是哪一類設定：`office-hours`、`tracking`、`identity-binding`、`webtalk`、`chat`、`embedding`、`gemini-key`、`api-keys`（Partner API 金鑰的建立與撤銷）、`cli-sessions`（CLI token 的建立與撤銷） |
| CLI | `cli_session.login`、`cli_session.logout` |
| 留言自動私訊 | `comment_reply.rule.create`、`comment_reply.rule.update`、`comment_reply.rule.delete`、`comment_reply.rule.toggle`、`comment_reply.rule.reorder`、`comment_reply.log.retry` |
| MCP | `mcp.line.<操作>.<結果>`：以 MCP 對 LINE 直接送訊息或群發 |
| 資料 | `contact.merge`、`contact.merge_revert`、`contact.binding_link_send`、`contact.email_registration_link_send`、`contact.phone_registration_link_send`、`case.delete`、`data.export.request`、`data.erasure.request`、`data.erasure.complete` |

`payload` 刻意不放個人資料（email、姓名、密碼），只放 ID 與變更摘要，例如合併聯絡人只記兩個 ID。`agent.purge` 例外記下被刪成員的名稱（`{ name }`），不記 email。

**操作者被永久刪除之後。** 稽核的 `actorId` 外鍵是 `ON DELETE SET NULL`，成員被永久刪除後 `actorId` 變成空值。`purgeAgent()` 在刪除成員之前、同一個交易內，把他的名稱與 email 寫進他當操作者的稽核（`actorName`、`actorEmail`），也寫進他發起的資料匯出與刪除請求（`requestedByName`、`requestedByEmail`）。`purgeAgent()` 先寫兩種申請的快照（`preserveRequester()`），再寫稽核的快照（`preserveAuditActor()`）。原因是資料刪除的 worker 先鎖住申請列，再寫完成稽核：`purgeAgent()` 更新申請時會等 worker commit，之後寫稽核快照時才看得到那筆完成稽核。`GET /tenant/audit-logs` 每筆回傳 `actor`（成員還在時是 `{ id, name, email }`，否則是 `null`）與 `actorSnapshot`（保存的 `{ name, email }`，沒有快照時是 `null`；系統寫的稽核也是 `null`）。這兩個欄位的格式不能改。2026-11-09 之前刪除的成員留下的紀錄沒有快照，查不回來。依 `actorId` 篩選查不到已刪除成員的紀錄。刪除或匯出請求排隊中、發起人被永久刪除時，worker 照常完成：`data.erasure.complete` 稽核的 `actorId` 是空值，`actorName`、`actorEmail` 取自請求的快照；刪除與匯出都不送通知（沒有收件人）。worker 用工作內容裡的成員 ID 寫稽核或送通知之前，先以 `apps/workers/src/lib/requester.ts` 的 `requesterExists()`（底層是 `@open333crm/core` 的 `agentExistsInTenant()`）確認成員還在。這個檢查只看成員存不存在，停用的成員仍可當稽核的 `actorId`。停用的成員收不收通知，由 `notification:dispatch` 的 `createNotificationForActiveAgent()` 決定。

**沒有寫稽核的重要操作**：登入成功與失敗、Passkey 的註冊與刪除、修改渠道（包括更換憑證）、送出群發、自動化規則的增刪改。其中渠道憑證的變更，事後完全無法追查。見 `../../system/AUDIT.md` 的 AUD-01。另外，下載匯出檔（HC-GOVERNANCE-03）；對外 Webhook 訂閱的建立、修改、刪除與測試（HC-GOVERNANCE-04）；修改聯絡人的 email 與電話、門市帳號的操作、會員綁定設定與手動綁定、SLA 政策的增刪改（HC-GOVERNANCE-09），也都不寫稽核。

稽核紀錄沒有保留期限，也沒有清除排程。

## 資料匯出

匯出整個租戶的聯絡人、對話、訊息與工單，用於資料可攜或備份。

**誰能匯出。** 匯出內容是全租戶、所有渠道的資料，不依成員的渠道可見範圍篩選。所以發起、查詢與下載都要同時有 `data.export` 與 `channel.view_all`（檢視所有渠道），兩個權限都由 `data-export.routes.ts` 的 `EXPORT_GUARDS` 檢查。只缺 `channel.view_all` 時回 403，`error.details.requiredPermission` 是 `channel.view_all`，訊息寫明需要「檢視所有渠道」。兩個權限都有的成員可以查詢與下載同租戶其他成員發起的匯出。這是規格的設計；下載連結只回給通過檢查的成員，15 分鐘後失效。`channel.view_all` 不是 `data.export` 的 `dependsOn`：註冊表只允許一層前置權限，而 `channel.view_all` 自己依賴 `channel.view`。所以角色與權限頁不會自動連動勾選，只在 `data.export` 的說明寫明。規格：`openspec/specs/tenant-data-export/spec.md`「匯出只限可查看所有渠道的成員」。

1. `POST /tenant/data-export` 建立一筆 `pending` 的申請，寫稽核，把工作送進 `data-export` queue，立刻回應。這三件事在同一個交易，一起成立或一起 rollback。
2. workers 的 `data-export.handler.ts` 先以條件更新認領申請：只有 `pending` 或 `processing` 的申請改成 `processing`，已經結束（`completed`、`failed`、`expired`）的不重做。`processing` 表示上一次執行中途結束，這次重新處理。接著 handler 分頁讀出資料，打包成 zip：每種資料一份 JSON（保留關聯）與一份 CSV（攤平的主表），加上一份 `manifest.json`。CSV 的每一欄經過 `@open333crm/shared` 的 `csvRow()`：以 `=`、`+`、`-`、`@` 等開頭的文字加 `'`，日期是 ISO 字串；檔案沒有 UTF-8 BOM。
3. 上傳到物件儲存，申請改成 `completed`，並通知申請人。只有仍是 `processing` 的申請改成 `completed`，所以兩次執行同時進行時，後完成的那次不再通知。失敗原因寫在 `data_export_requests.error`。
4. `GET /tenant/data-export/:id` 查詢狀態；`GET /tenant/data-export/:id/download` 取得 15 分鐘有效的下載連結，並累計下載次數。
5. 匯出檔保留 7 天。workers 每小時執行一次 `data-export-cleanup`，刪除過期的檔案，把申請改成 `expired`。

要知道的事：

- **完成通知連到不存在的頁面。** 通知的連結是 `/dashboard/settings/data-export/<申請 ID>`，前端沒有這一頁。
- **`scope` 參數沒有作用。** 申請可以帶 `scope`，系統會存下來，但打包時不讀它，一律匯出聯絡人、對話、訊息與工單。
- **資料全部讀進記憶體。** 打包時把租戶的聯絡人、對話、訊息與工單各自累積在陣列裡再寫成 JSON，資料量大的租戶可能讓 workers 記憶體不足。
- **workers 的物件儲存設定與 api 相同。** workers 讀 `S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY` 與 `S3_BUCKET`（有 `MINIO_ENDPOINT` 時優先用 `MINIO_*`）。連線設定由 `@open333crm/core` 的 `resolveMinioConfig()` 決定。兩邊都沒設定時連本機預設的 `localhost:9000`，並寫一次 warn log（`[storage] 沒有設定 S3_ENDPOINT`）；容器內這樣會連回自己，上傳與刪除失敗。

## 資料刪除

刪除單一客人的個人資料，對應個資法與 GDPR 的被遺忘權。`POST /tenant/data-erasure` 帶 `contactId` 與模式，由 workers 的 `data-erasure.handler.ts` 執行。完成後更新申請狀態與受影響筆數、寫稽核、通知申請人。

- 發起時，申請、`data.erasure.request` 稽核與佇列工作在同一個交易，一起成立或一起 rollback。稽核的 `payload` 只有 `contactId` 與 `mode`，佇列工作也不含 `reason`。
- worker 與匯出相同，以條件更新認領申請（`pending` 或 `processing` 改成 `processing`），已經結束的申請不重做。
- 刪除交易的第一個語句是 `markCompleted()`：只把 `processing` 改成 `completed`，並鎖住申請列。兩次執行同時進行時，後到的交易在這裡等待。
- `data.erasure.complete` 稽核在刪除交易內寫入，`payload` 只有 `contactId`、`mode` 與 `affected`。通知在 commit 之後送出；發起人已被永久刪除時不送。
- 失敗原因寫在 `data_erasure_requests.error`。

| 模式 | 做什麼 |
| --- | --- |
| `anonymize`（預設） | 聯絡人的名稱改成佔位字串，清空頭像、電話與 email；刪除屬性、渠道身分、`IdentityMap` 與長期記憶；清空留言自動私訊的留言者對應與觸發紀錄裡的個資；把客人傳進來的訊息內容換成 `{ redacted: true }`；刪除這些訊息在物件儲存的媒體檔與頭像檔。對話、工單與客服上傳的媒體檔保留，報表數字不變 |
| `hard_delete` | 刪除聯絡人本身，以及他的對話、訊息、工單、積分、活動提交、留言自動私訊的觸發紀錄與留言者對應，並刪除物件儲存裡的媒體檔與頭像檔 |

**被合併的封存聯絡人一起處理。** 兩種模式以 `lockErasureContacts()` 沿 `mergedIntoId` 逐層往下，找出併入這位聯絡人的封存聯絡人（含舊版合併留下的多層），套用相同的規則：匿名化清空名稱、電話、email、頭像並刪除子資料，聯絡人維持封存；硬刪除連同他們的資料一起刪除。筆數記在 `affected.mergedContacts`（硬刪除的 `affected.contacts` 也包含他們）。刪除完成之後，這些合併紀錄不能再解除：被併入方或合併鏈上任何一位有 `completed` 的刪除請求時，`POST /contacts/merge-logs/:id/revert` 與顧客自助解除都回 409 `CONTACT_ERASED`。這個檢查在 `contact-merge.service.ts` 的 `revertMerge()`，檢查前先以 `lockContactsForMerge()` 鎖住聯絡人。刪除還在排隊（`pending`）時可以解除，解除之後被恢復的聯絡人不在合併鏈上，不會被刪除。

**鎖的順序。** 刪除交易依序鎖住：聯絡人（依 id 排序，與合併引擎相同）→ 渠道身分 → 留言者對應 → 對話，然後才讀訊息。聯絡人鎖住之後，新的對話、訊息與留言者對應要等刪除交易結束才能寫入，所以刪除不會漏掉並行寫入的資料。

兩種模式都刪除這些聯絡人在物件儲存的頭像檔。只刪本租戶 `avatars/` 目錄下的檔案；這次刪除處理的聯絡人以外、同租戶其他聯絡人還在用的檔案保留。合併時主聯絡人沿用被併入那位的頭像，兩位一起刪除，所以檔案也會刪。workers 要設定與 api 相同的 `S3_PUBLIC_URL`；沒設定或不同時頭像檔不刪，筆數記在申請的 `affected.avatarObjectsSkipped`。

訊息的媒體檔只刪 `{tenantId}/media/{這位客人的對話}/{uuid}.{副檔名}` 格式的檔案，其他的不刪，筆數記在 `affected.mediaObjectsSkipped`。格式由 `@open333crm/core` 的 `isConversationMediaKey()` 判斷。匿名化要在改寫進站訊息之前讀出 `storageKey`，改寫之後就找不到檔案。匿名化時，客服回覆的出站訊息還在引用的檔案保留，筆數記在 `affected.mediaObjectsShared`。檔案在交易 commit 之後刪，每個最多刪一次、不重試；刪除失敗時申請仍是完成，筆數記在 `affected.mediaObjectsFailed` 與 `affected.avatarObjectsFailed`，失敗的 key 寫進 workers 的 log。

**刪除期間完成的媒體下載不寫回。** 進站媒體在 API 背景下載，下載完成或失敗後才寫回訊息（`apps/api/src/modules/webhook/inbound-side-effects.ts` 的 `resolveInboundMedia()`）。寫回在交易內先以 `FOR SHARE` 鎖住對話，只在訊息內容仍是下載前那份時寫入；資料刪除以 `FOR UPDATE` 鎖住對話才讀訊息，兩者互相等待。內容已被匿名化（或訊息已被硬刪除）時不寫入、不推送，並刪除剛上傳的物件（最多一次，失敗寫 api 的 log）。

**兩種模式都有沒涵蓋的資料：**

| 資料 | `anonymize` | `hard_delete` |
| --- | --- | --- |
| 客服回覆的訊息內容 | 保留 | 刪除 |
| 客服上傳的圖片與檔案 | 保留 | 刪除 |
| 活動提交的表單答案、積分 | 保留 | 刪除 |
| 工單標題、描述、備註與 CSAT 留言 | 保留 | 刪除 |
| 點擊紀錄（`ClickLog`，含 IP、User-Agent、LINE uid） | 保留 | 保留 |
| 群發收件紀錄、知識庫回報、Canvas 執行紀錄 | 保留 | 保留 |

點擊紀錄（`ClickLog`）、群發收件紀錄（`BroadcastRecipient`）、知識庫回報（`KbArticleFeedback`）與 Canvas 執行紀錄（`FlowExecution`）的資料表只存 `contactId`，沒有外鍵，兩種模式都不處理。刪除完成之後才併入的聯絡人也不處理。見 `../../system/AUDIT.md` 的 ERASE-01。outbox 已送出的事件（例如 `case.created` 帶工單標題）、`webhook_deliveries` 的事件原文，以及刪除之前產生、7 天內仍可下載的匯出檔，也都不處理（HC-GOVERNANCE-08）。

硬刪除在刪除 Contact 之前，先刪除以 `Restrict` 關聯到聯絡人的活動提交與積分紀錄，也先刪除以 `Restrict` 關聯到留言者對應的觸發紀錄。新的 `Restrict` 關聯沒有在 `hardDelete()` 先刪時，硬刪除的交易失敗。

刪除沒有防誤刪機制：一次 API 呼叫就排進佇列，沒有影響筆數的預覽、確認步驟或取消，同一位聯絡人可以重複發起（HC-GOVERNANCE-07）。

### 回收匿名化留下的媒體檔

2026-11-09 之前完成的匿名化，留下客人傳來的圖片、影片與檔案在物件儲存的 `{tenantId}/media/{conversationId}/`，資料庫已經沒有指向這些檔案的訊息。一次性腳本 `scripts/recover-erased-media-orphans.mjs` 找出並刪除這些檔案（#474），SQL 在 `scripts/sql/recover-erased-media-orphans.sql`。不需要 migration。

**回收規則**

| 項目 | 規則 |
| --- | --- |
| 對象 | `status` 是 `completed`、`mode` 是 `anonymize` 的刪除請求，其聯絡人目前的對話。硬刪除的對話已刪除，找不到媒體目錄，只列出請求筆數、不處理（硬刪除本來就刪媒體檔） |
| 列出 | 每個對話的 `{tenantId}/media/{conversationId}/` 底下的所有物件（遞迴） |
| 只刪 | `{tenantId}/media/{conversationId}/{uuid}{.副檔名}` 格式的 key，與資料刪除 worker 共用 `@open333crm/core` 的 `isConversationMediaKey()`。格式不符（例如 `report.csv`、多一層路徑）的略過並列出 |
| 保留 | 同一租戶任何訊息的內容仍出現這個 key 的物件（`storageKey`、`url`、`mediaUrl` 都算），例如客服上傳的出站媒體檔 |

**操作步驟**

以下指令在 repo 根目錄執行；在 API 容器內，把 `scripts/` 整個資料夾（含 `sql/`）複製到 `/app/scripts/`，在 `/app` 執行。

- 資料庫連線需要能略過 RLS 的身分：優先用 `MIGRATE_DATABASE_URL`（owner），否則用 `DATABASE_URL`。身分不能略過 RLS 時，腳本直接失敗，不會回報 0 筆。
- 物件儲存用 `@open333crm/core` 的 `MinioStorageProvider`，連線設定與 api 相同：`S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`（有 `MINIO_ENDPOINT` 時優先用 `MINIO_*`）。bucket 是 `S3_BUCKET`，預設 `open333crm`。在 API 容器內執行時，這些變數都已設定。

1. **本機演練**：用 `scripts/sync-uat-db.sh` 把 UAT 資料拉回本機，在本機執行預覽（物件儲存是本機的 MinIO，通常沒有對應的檔案，用來確認對話清單與流程）。
2. **UAT 預覽**（dry-run，預設模式；只讀資料庫與列出物件，不刪除）：

   ```bash
   node scripts/recover-erased-media-orphans.mjs
   node scripts/recover-erased-media-orphans.mjs --tenant <租戶 ID>
   ```

   `--tenant` 可以重複，不帶時處理所有租戶。輸出各租戶的對話數、列出的物件數、仍被訊息引用而保留的數量、格式不符而略過的 key、要刪的 key 清單，以及已完成的硬刪除請求筆數，最後印出建議的 `--expect-objects`。
3. **確認**：對照清單抽查幾個 key（例如以 MinIO 主控台或 `mc ls` 看檔案，確認屬於已匿名化的客人）。物件刪除無法還原。
4. **執行**（先 Demo 租戶並抽查，再真實租戶）：

   ```bash
   node scripts/recover-erased-media-orphans.mjs --tenant <租戶 ID> --apply --expect-objects 12 --out-dir /tmp
   ```

   - `--apply` 一定要帶 `--expect-objects`。這次算出的筆數不同時不刪除，以非零結束，請重新預覽。
   - 刪除前把清單寫成 `media-orphans-<時間>.csv`（`tenantId`、`conversationId`、`key`），放在 `--out-dir`（預設目前目錄），檔案已存在時不覆蓋。
   - 每個 key 最多刪一次、不重試。有失敗時印出失敗的 key 並以非零結束；之後重新預覽，清單只剩沒刪掉的。
5. **確認結果**：再執行一次預覽，要刪的物件是 0。

建議順序：本機演練 → UAT 只跑預覽、確認筆數 → 先清 Demo 租戶並抽查 → 再清真實租戶。

## 對外 Webhook

租戶可以訂閱系統事件，事件發生時系統把事件 POST 到指定網址。

| 端點 | 作用 |
| --- | --- |
| `GET`、`POST /webhook-subscriptions` | 列出、建立訂閱 |
| `GET`、`PATCH`、`DELETE /webhook-subscriptions/:id` | 查看、修改、刪除訂閱 |
| `POST /webhook-subscriptions/:id/test` | 送一個測試事件。在請求內只送一次，不重試，回應帶這次的結果 |

**怎麼送出。** 對外 Webhook 是業務事件的訂閱者之一，從 `event-webhook` 佇列取得事件（見[事件與背景工作](../../modules/EVENTS.md)）。`webhook-dispatcher.ts` 的處理函式只處理對外事件清單內的事件，找出同租戶、啟用中、而且訂閱了這個事件的網址，為每個網址建立一個 `webhook-delivery` job：

- 內容是 `{ id, event, tenantId, timestamp, data }`。`id` 是事件 id，`data` 是事件的原始內容。
- 標頭帶 `X-Webhook-Signature: sha256=<HMAC>`、`X-Webhook-Event`、`X-Webhook-Event-Id` 與 `X-Webhook-Delivery`。HMAC 以訂閱的 `secret` 計算；建立時沒給 `secret` 就自動產生。
- 目標網址指向內網位址時不送出，也不重試。
- 每個網址各自送出與重試：每次逾時 10 秒，共送 3 次，間隔 1 秒、5 秒。重試排在 Redis，API 重新啟動之後照常繼續。一個網址失敗，不會讓其他網址再收到一次。
- 同一個事件送給同一個訂閱只有一筆 `WebhookDelivery`，存事件原文，重試更新同一筆，所以重試時 `X-Webhook-Delivery` 不變。接收端可以用事件 id 去重：事件重送時，`id` 與 `X-Webhook-Event-Id` 相同。

**有些事件不會送出。** 有些事件在介面或文件上存在，卻沒有發布端：`conversation.assigned` 與兩個 SLA 事件。見 `../../system/AUDIT.md` 的 CONV-02 與 APP-05。

**訂閱的事件名稱不檢查。** 訂閱時可以填任意字串，打錯的事件名稱不會報錯，只是永遠收不到。轉送時只送對外事件清單內的事件；第一版清單等於所有事件名稱，所以內部事件也會轉送，見 `../../system/AUDIT.md` 的 HOOK-01。

讀取訂閱的端點會回傳 `secret`，持有 `webhook.view` 的成員就能看到簽章金鑰。

## MCP

`/mcp` 讓 AI 工具以 MCP（Model Context Protocol）操作租戶資料。`authenticateMcp()` 只接受帶 `mcp:read` scope 的 CLI token；只帶客服 JWT 的請求回 403。每個工具再各自檢查所需的 scope：

| 工具 | 作用 | 需要的 scope |
| --- | --- | --- |
| `crm_get_current_agent`、`crm_search_contacts`、`crm_get_contact`、`crm_list_cases`、`crm_get_case`、`crm_get_analytics_overview`、`crm_get_case_statistics` | 讀取 | `mcp:read` |
| `crm_line_list_conversations`、`crm_line_get_conversation`、`crm_line_search_contacts`、`crm_line_get_broadcast` | 讀取 LINE 對話與群發 | LINE 讀取 scope |
| `crm_line_direct_send` | 送一則 LINE 訊息。先預覽，再以 5 分鐘有效的確認 token 送出 | LINE 發送 scope |
| `crm_line_broadcast_initiate` | 建立 LINE 群發 | LINE 群發 scope |

scope 的常數定義在 `mcp.constants.ts`。工具只檢查 scope，不檢查成員的角色與方案，見 `../../system/AUDIT.md` 的 RBAC-02。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 重要操作沒有稽核 | 詳見 `../../system/AUDIT.md` 的 AUD-01 |
| 資料刪除沒有涵蓋所有個人資料 | 詳見 `../../system/AUDIT.md` 的 ERASE-01 |
| MCP 與 CLI 不受角色與方案限制 | 詳見 `../../system/AUDIT.md` 的 RBAC-02 |
| 匯出的 `scope` 參數沒有作用、完成通知連到不存在的頁面 | 詳見 `../../system/AUDIT.md` 的 EXPORT-01 |
| 匯出把所有資料讀進記憶體 | 大租戶可能失敗，詳見 `../../system/AUDIT.md` 的 EXPORT-01 |
| 對外 Webhook 訂閱的事件名稱不檢查 | 打錯不會報錯；對外事件清單第一版等於所有事件，內部事件也會轉送，`message.received` 帶出 `replyToken`。詳見 `../../system/AUDIT.md` 的 HOOK-01 |
| 沒有後台頁面 | 稽核、匯出、刪除與對外 Webhook 只能直接呼叫 API |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
