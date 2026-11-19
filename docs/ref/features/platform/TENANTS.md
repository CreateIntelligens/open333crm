# 租戶管理

租戶的開通、停用與基本資料維護。開通邏輯由平台手動開通與試用自動開通共用。

- **資料來源**：`apps/api/src/modules/platform/platform-tenant.service.ts`、`platform.routes.ts`、`ai-privacy.routes.ts`、`trial-admin.service.ts`、`apps/web/src/app/admin/tenants/*`
- **核對日期**：2026-11-19

## 程式的入口

租戶管理的路由在 `apps/api/src/modules/platform/platform.routes.ts`，前綴是 `/api/v1/platform`。個資遮罩的路由在 `ai-privacy.routes.ts`。所有路由只接受平台帳號的 token（`authenticatePlatformSuperuser`），租戶 token 一律回 401。平台帳號沒有權限分級（`../../system/AUDIT.md` 的 AUTH-04）。全程使用 `fastify.prismaAdmin`（BYPASSRLS）。

| 操作 | 服務函式 |
| --- | --- |
| 列表、明細 | `platform-tenant.service.ts` 的 `listTenants()`、`getTenantDetail()` |
| 改名稱或方案 | `updateTenant()` |
| 改成員登入 email | `updateTenantAgentEmail()` |
| 重寄開通信 | `resendWelcomeEmail()` |
| 停用或啟用 | `setTenantActive()` |
| 手動開通 | `provisionTenantViaApi()` → 交易內 `provisionTenant()` |
| 改合約起訖日 | `trial-admin.service.ts` 的 `updateTenantContract()` |
| 復原已清除的試用租戶 | `trial-admin.service.ts` 的 `restorePurgedTenant()` |
| 個資遮罩 | `ai-privacy.service.ts` 的 `getTenantAiPrivacy()`、`setTenantAiPrivacy()` |
| 依租戶查平台稽核 | `platform-audit.service.ts` 的 `listTenantPlatformAuditLogs()` |
| 試用清除（系統） | `apps/api/src/modules/trial/trial.scheduler.ts` 的 `purgeTrials()` |

## 平台能對租戶做什麼

| 操作 | 路由 | 影響 |
| --- | --- | --- |
| 看清單 | `GET /tenants` | 全部租戶，依建立時間新到舊，不分頁。含方案與成員數 |
| 看明細 | `GET /tenants/:id` | 成員清單，加上渠道、聯絡人、對話、工單的筆數統計 |
| 看平台對這個租戶的操作紀錄 | `GET /tenants/:id/audit-logs` | 對象是該租戶、其成員或其方案申請的平台稽核。`limit` 有預設值與上限 |
| 看個資遮罩政策 | `GET /tenants/:id/ai-privacy` | 回傳 `{ enabled }`，預設 `false` |
| 強制啟用或關閉個資遮罩 | `PATCH /tenants/:id/ai-privacy` | 只接受 `{ "enabled": true }` 或 `false`；設定與平台稽核在同一交易內寫入 |
| 改名稱或方案 | `PATCH /tenants/:id` | 改方案會失效兩層快取，見下文 |
| 改成員登入 email | `PATCH /tenants/:id/agents/:agentId` | 全域唯一，重複回 409。比對區分大小寫，`ADMIN@x` 與 `admin@x` 可以並存（`../../system/AUDIT.md` 的 AUTH-10）。不通知原本的信箱 |
| 重寄成員開通信 | `POST /tenants/:id/agents/:agentId/resend-welcome` | 信裡沒有密碼。不檢查成員或租戶是否停用，停用的成員也收得到（HC-PLATFORM-TENANTS-13） |
| 停用或啟用 | `PATCH /tenants/:id/active` | 只改 `isActive`，沒有任何防呆，不處理 `trialEndsAt` 與 `purgedAt`。啟用已過期的試用租戶，下一輪排程又會停用，見 `../../system/AUDIT.md` 的 TRIAL-04 |
| 手動開通 | `POST /tenants` | 建租戶、角色與管理員帳號。email 已存在回 409，密碼不足 8 字回 400，方案不存在回 404 |
| 改合約起訖日 | `PATCH /tenants/:id/contract` | 見[合約日期](#合約日期) |
| 復原已清除的試用租戶 | `PATCH /tenants/:id/restore` | 只清除 `purgedAt`，不改 `isActive`。租戶沒有清除標記時回 422 `NOT_PURGED`。入口是 `/admin/trial` 的「復原」，見[試用管理](./TRIALS.md) |

**沒有刪除租戶的途徑。** 停用只是把 `isActive` 設成 `false`。試用排程每小時把停用、而且 `trialEndsAt` 超過保留天數的試用租戶標上 `purgedAt`，寫稽核 `tenant.trial.purge`（`platformUserId` 為 null）。`purgedAt` 只是標記，業務資料一直留在資料庫裡（`../../system/AUDIT.md` 的 TRIAL-03）。「延長」與「轉正式」才會同時清除 `purgedAt` 並啟用租戶，見[試用管理](./TRIALS.md)。

開通與改名稱的 API 接受只有空白的值：站台名稱、管理員姓名、8 個空白的密碼都能開通（HC-PLATFORM-TENANTS-07）。API 對非 UUID 的 `:id`、`:agentId` 回 400 `DATABASE_ERROR`，不是欄位驗證錯誤（HC-PLATFORM-TENANTS-09）。

## 平台控制個資遮罩

平台租戶詳細頁 `/admin/tenants/:id` 的「個資遮罩」區塊（`apps/web/src/app/admin/tenants/components/AiPrivacyControl.tsx`）顯示目前設定。所有租戶預設關閉，平台管理員可逐租戶強制啟用或關閉；租戶設定頁不提供覆寫入口。開關載入與儲存時停用，失敗時顯示重試訊息並保留已確認的值。

政策存放於 `PlatformSetting` 的 `ai.privacy.<tenantId>`，值為 `{ enabled: boolean }`。每次 AI 作業起始都重新讀取，跨 API 行程不使用政策快取。設定損壞或讀取失敗時停止該次模型呼叫。專用 API 沿用平台帳號認證與強制改密碼限制；目標租戶不存在回 404，無效 UUID、非 boolean 或額外欄位回 400。成功寫入 `tenant.ai_privacy.update` 稽核，payload 只有 `enabled`。通用的 `PUT /settings/:key` 也寫得進這個鍵，見[平台設定](./SETTINGS.md#個資遮罩)。

啟用後，待處理原文會先送至 `https://2md.aiurl.tw/api/deid`，使用完整類別標記遮罩後再送往 Chat、Agent 或 Embedding 模型。2md 異常時（短暫故障先重試一次）停止該次模型呼叫；進站訊息改為存原文並標記未遮罩、不送模型、轉真人，並發出維運告警。原始客服紀錄依既有規則保存；文字遮罩的完整範圍見[知識庫與 AI](../tenant/KNOWLEDGE.md#模型輸入的個資遮罩)。

## 開通一個租戶建立了什麼

`provisionTenant()` 在同一個交易內依序做下列事情：

1. 建 `Tenant`，綁上方案。
2. `seedRolesForTenant()` 建三個系統角色與各自的預設權限。
3. 建管理員 `Agent`，`role` 為 `ADMIN`，並綁上剛才建好的 admin 角色。

開通不建立 `TenantSettings`。

這個函式收呼叫端傳入的 transaction client，因此各條開通路徑共用同一份邏輯。新的開通路徑也要把呼叫端的交易傳進來：

| 路徑 | 呼叫者 | 差異 |
| --- | --- | --- |
| 平台手動開通 | `provisionTenantViaApi()` | 自行開交易。不設 `trialEndsAt`，租戶一開始就不在試用排程的掃描範圍內 |
| 試用自動開通 | `trial` 模組 `trial.service.ts` 的 `verifyAndProvision()` | 與驗證 token 的消耗放在同一個交易內。設定 `trialEndsAt` |

手動開通不設 `trialEndsAt`，只有試用開通才設。手動開通若設了 `trialEndsAt`，試用排程到期時會停用這個租戶。

`provisionTenant()` 只收雜湊過的密碼。兩個呼叫者都在開交易之前雜湊密碼：手動開通用表單上填的密碼，試用開通用申請人在驗證頁設定的密碼。

email 的唯一檢查刻意放在交易外先做，讓衝突回 409 `CONFLICT`，而不是交易內的 Prisma `P2002`。

## 手動開通的信裡沒有密碼

平台手動開通時，管理員密碼由操作者在表單上自己填，至少 8 字元。開通信（`apps/api/src/modules/trial/trial-emails.ts` 的 `sendManualProvisionedEmail()`）只有站台名稱與登入網址 `loginUrl`（`WEB_BASE_URL/login`），**密碼要線下轉交**。API 也在回應中回傳 `loginUrl`。

這與平台帳號的開通信相反，那一封帶系統產生的臨時密碼，見[平台帳號管理](./PLATFORM-USERS.md#建立帳號時不輸入密碼)。兩者的差別在於誰知道密碼：平台帳號的密碼連建立者都不知道，租戶管理員的密碼則是建立者自己設的。

手動開通的寄信是 fire-and-forget，寄不出去只寫 log（`[TrialEmail] send failed`），開通仍然成功。重寄開通信會等寄信完成，但寄信函式內的 `safeSend()` 把錯誤吞掉，所以寄送失敗時 API 仍回 `{ ok: true }`，畫面顯示「開通信已重寄」，稽核也照寫（HC-PLATFORM-TENANTS-06）。

開通信請收件者「登入後立即修改密碼」，但租戶端沒有任何強制機制，也沒有忘記密碼流程，見 `../../system/AUDIT.md` 的 AUTH-01。

## 改方案的連帶效果

`PATCH /tenants/:id` 帶 `planSlug` 時，服務會比對是否真的換了方案；有換才失效權限天花板快取（`invalidatePlanPermissions`，Redis）與租戶方案快取（`invalidateTenantPlan`，行程內 60 秒）。租戶方案快取在 `apps/api/src/services/tenant-plan.cache.ts`，每個行程只清得掉自己的快取。這是改動租戶方案的入口之一，其餘入口與各自要失效的快取見[平台後台](./README.md#方案異動的連鎖效果)。

這條路徑不檢查方案是否停售（`../../system/AUDIT.md` 的 PLAN-01），也不檢查是升級還是降級。換方案只寫 `planId`，既有的超額資源不會被回收，詳見 `../../system/AUDIT.md` 的 PLAN-03。新方案的 AI 月額度較高時，系統清除這個租戶本月的額度告警旗標。加購只計入核准當月，不寫 `limitOverrides`，見[方案異動審核](./PLAN-CHANGES.md#加購只計入核准當月)。

換方案也不會讓試用租戶脫離試用，`trialEndsAt` 維持不變，到期仍會被停用。頁面在方案欄位下方提示這一點。要轉為付費，使用試用管理的「轉正式」，見[試用](./TRIALS.md#哪些操作會讓租戶脫離試用)。

## 合約日期

`PATCH /tenants/:id/contract` 收 `contractStartDate`、`contractEndDate`，兩者都可以省略或送 `null`（清除）。後端以 `z.coerce.date()` 解析，存成 UTC 午夜。服務把傳入的值與現有的值合併後檢查，迄日早於起日回 422 `CONTRACT_DATE_INVALID`，只送一個日期也會檢查。迄日改變時，系統清除已寄出的提醒檔位，依新的迄日重新提醒。這個路由寫稽核 `tenant.contract.update`，payload 是修改後的兩個日期。

API 送 `{}` 不改任何欄位，仍回 200 並寫一筆稽核；送數字 `0` 會被解析成 1970-01-01（HC-PLATFORM-TENANTS-11）。前端不會送這兩種值。

合約日期唯一的自動行為是到期前寄提醒信給平台帳號（`contract-reminder.scheduler.ts`，天數設定見[平台設定](./SETTINGS.md#目前有哪些鍵)）。合約到期不停用租戶、不清除資料、不改方案（主規格 `tenant-contract-dates`）。

## 平台稽核

租戶管理的稽核由路由寫，服務不寫，因為服務拿不到 `request.platformUser.id`。新增異動路由時，路由要自己呼叫 `writePlatformAudit()`。沒有任何檢查會攔下漏寫的路由；`apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 的「列出的寫入操作都寫入稽核」列出每個寫入操作，新增路由時要加進這份清單。

稽核在異動完成之後另外寫入，不在同一個交易：稽核寫入失敗時，異動已經生效，API 回 500。個資遮罩是唯一在同一個交易寫入稽核的操作（HC-PLATFORM-TENANTS-15）。

| 操作 | `action` | payload |
| --- | --- | --- |
| 手動開通 | `tenant.provision` | 只有 `name`、`planSlug`。不可含密碼，有測試保護 |
| 改名稱或方案 | `tenant.update` | 送出的欄位，只有新值 |
| 停用、啟用 | `tenant.disable`、`tenant.enable` | 沒有 payload |
| 改合約 | `tenant.contract.update` | 修改後的兩個日期 |
| 改成員 email | `tenant.agent.email.update` | `tenantId` 與新的 email，沒有原本的 email（HC-PLATFORM-TENANTS-15） |
| 重寄開通信 | `tenant.agent.resend_welcome` | `tenantId` |
| 個資遮罩 | `tenant.ai_privacy.update` | `enabled` |
| 復原 | `tenant.trial.restore` | 沒有 payload |
| 試用清除（系統） | `tenant.trial.purge` | `platformUserId` 為 null |

新的稽核動作要在 `apps/web/src/app/admin/lib/audit-log.ts` 的 `PLATFORM_AUDIT_ACTION_LABELS` 加上標籤。

## 停用租戶多久生效

答案依存取面而不同。

| 存取面 | 會不會被擋 | 最長延遲 |
| --- | --- | --- |
| REST | 會 | 一個 access token 的有效期 |
| Socket.IO 既有連線 | 不會 | 連線不中斷就一直有效 |
| CLI token | 不會 | CLI session 自己的有效期 |
| Partner API 金鑰 | 不會 | 金鑰自己的有效期，建立時不指定就永不過期。見 `../../system/AUDIT.md` 的 AUTH-02 |
| 進站訊息（LINE、Facebook、Instagram、網站聊天室） | 會 | 立即。webhook 提早丟棄，`processInboundMessage()` 共用入口再擋一次；網站聊天室建立工作階段、送訊息與訪客 socket 回 404 |
| 排程群發、附券群發的佇列 job | 會 | 立即。到期時不送出，群發標為 `failed`（`TENANT_DISABLED`） |
| 滿意度問卷排程 | 會 | 立即。不處理停用租戶的工單 |

REST 這一面是有界的。`authenticate` 只驗 JWT 簽章不回查資料庫，停用當下已經發出的 access token 仍然可用；但續命與重新登入都被擋住：

- `POST /auth/refresh` 用 `getActiveAgentForAuth()` 重查資料庫，條件包含 `tenant: { isActive: true }`，停用的租戶換不到新的 access token。
- `login()` 在驗完密碼之後才檢查租戶狀態，停用回 403 `TENANT_DISABLED`。順序是刻意的：放在密碼驗證之後，未通過驗證的人就無法用錯誤碼的差異推測某個 email 屬於哪個租戶。

另外兩面沒有這層保護，詳見 `../../system/AUDIT.md` 的 AUTH-02。

進站這一面的檢查點是 `apps/api/src/modules/webhook/webhook.service.ts`、`apps/api/src/modules/webhook/webhook-account-routing.ts`、`processInboundMessage()`，以及網站聊天室的 `apps/api/src/modules/chatbox/chatbox.service.ts`（`resolveChatboxChannel()`、`verifyChatboxSession()`）。新增進站入口或憑證類型時，也要檢查 `tenant.isActive`。

平台帳號那邊是每個請求都回查資料庫，停用即時生效，而且沒有 Socket 與 CLI 通道，見[平台帳號認證](./AUTH.md#停用帳號多久生效)。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 租戶列表 `/admin/tenants`（`apps/web/src/app/admin/tenants/page.tsx`） | `GET /tenants` | 狀態欄只顯示啟用或停用，看不出試用中、試用到期、已清除。已清除的租戶在列表上是「停用」，旁邊的「啟用」會造成 TRIAL-04 的情況（HC-PLATFORM-TENANTS-12）。合約欄可依迄日排序，並標示到期狀態。讀取失敗時沒有錯誤訊息 |
| 列表頁下方的開通表單 | `POST /tenants`，`{ name, planSlug, adminEmail, adminName, adminPassword }` | 方案下拉寫死 `trial`、`light`、`standard`、`professional`、`enterprise`，不讀 `/plans`（HC-PLATFORM-TENANTS-10）。預設是「免費試用」，但手動開通不設 `trialEndsAt`：用預設值開通的租戶一直停在試用方案，不會到期，也不出現在 `/admin/trial`（HC-PLATFORM-TENANTS-05）。`adminEmail` 是 `type=email`，不 trim。成功訊息附 `loginUrl` 與「密碼請自行轉交給管理員」 |
| 列表列的「停用」「啟用」 | `PATCH /tenants/:id/active`，`{ isActive }` | 沒有確認框（HC-PLATFORM-TENANTS-02）。`toggleActive` 沒有 try/catch，失敗時畫面沒有訊息，錯誤只在 console（HC-PLATFORM-TENANTS-03） |
| 列表列的「合約」→ 兩個日期欄位 → 儲存 | `PATCH /tenants/:id/contract` | 送 `YYYY-MM-DD`，空白轉成 `null`；畫面以 `iso.slice(0,10)` 顯示。前端先擋迄日早於起日 |
| 列表頁的所有訊息 | — | 錯誤訊息（409、迄日早於起日、開通失敗）也用綠色的成功樣式顯示（HC-PLATFORM-TENANTS-08） |
| 列表頁的「合約到期提醒」設定卡 | `GET`、`PUT /settings/contract.reminderDaysBefore` | 按「儲存」才送出，見[平台設定](./SETTINGS.md#目前有哪些鍵) |
| 點租戶名稱 → 詳細頁 `/admin/tenants/[id]` | `GET /tenants/:id`、`GET /plans`、`GET /tenants/:id/audit-logs` | 租戶不存在或 id 不是 UUID 時，畫面一直停在「載入中…」（HC-PLATFORM-TENANTS-09）。操作紀錄載入失敗時顯示錯誤訊息。已清除的租戶在名稱旁顯示「（已清除 日期）」，沒有復原按鈕 |
| 詳細頁「基本資料」：改名稱、方案 | `PATCH /tenants/:id`，`{ name, planSlug? }` | `name` 已 trim。沒有方案的租戶 `planSlug` 是空字串，送出時省略這個欄位。試用租戶的方案欄位下方提示改方案不會脫離試用 |
| 詳細頁「停用租戶」「啟用租戶」 | `PATCH /tenants/:id/active` | 沒有確認框（HC-PLATFORM-TENANTS-02）。失敗時顯示紅色訊息 |
| 詳細頁「合約期間」 | `PATCH /tenants/:id/contract` | 錯誤用紅色訊息顯示 |
| 成員表的「改 Email」 | `PATCH /tenants/:id/agents/:agentId`，`{ email }` | 送出輸入的原值，不 trim、不轉小寫。格式錯時只顯示通用訊息「輸入內容有誤，請檢查後重新送出」（HC-PLATFORM-TENANTS-14） |
| 成員表的「重寄開通信」 | `POST /tenants/:id/agents/:agentId/resend-welcome` | 寄送失敗時仍顯示「開通信已重寄」（HC-PLATFORM-TENANTS-06） |
| 詳細頁「個資遮罩」 | `GET`、`PATCH /tenants/:id/ai-privacy` | 見[平台控制個資遮罩](#平台控制個資遮罩) |
| `/admin/trial` 試用租戶分頁的「復原」 | `PATCH /tenants/:id/restore` | 復原的入口不在租戶管理頁 |

沒有刪除租戶的路由。依時間查詢全部平台稽核的端點也沒有，見[平台後台](./README.md)。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
