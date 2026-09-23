# API 功能模組與所屬後台

本文件說明 `apps/api/src/modules/` 的每個模組服務哪一群使用者，並列出每個模組的路由前綴、對應的前端頁面與權限要求。模組之間的程式碼相依請看[應用程式與共用套件](../system/COMPONENTS.md)。

- **資料來源**：`apps/api/src/index.ts` 的路由註冊、`apps/api/src/modules/*`、`apps/api/src/plugins/auth.plugin.ts`、`apps/web/src/app/*`、`apps/web/src/components/layout/Sidebar.tsx`
- **核對日期**：2026-09-23

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 系統分成幾個使用者面？怎麼判斷一個模組屬於哪一面？ | [三個使用者面](#三個使用者面) |
| 平台營運方能操作哪些功能？ | [平台後台](#平台後台admin) |
| 租戶的客服與管理員能操作哪些功能？ | [租戶後台](#租戶後台dashboard) |
| 終端使用者與外部系統呼叫哪些端點？ | [對外端點](#對外端點) |
| 哪些模組沒有路由？誰在呼叫它們？ | [沒有路由的模組](#沒有路由的模組) |
| 哪些 API 還沒有對應的後台頁面？ | [有 API、沒有頁面的功能](#有-api沒有頁面的功能) |
| 排程與背景工作屬於哪個模組？跑在哪個行程？ | [背景工作的歸屬](#背景工作的歸屬) |

## 三個使用者面

系統有兩個後台，再加上一組給終端使用者與外部系統的對外端點。本文件把這三群使用者稱為「面」。三個面各自有獨立的認證機制。

| 面 | 使用者 | 認證裝飾器 | 請求身分 | 前端進入點 |
| --- | --- | --- | --- | --- |
| 平台後台 | 平台營運方 | `authenticatePlatformSuperuser` | `request.platformUser` | `/admin/*` |
| 租戶後台 | 租戶的客服與管理員 | `authenticate`、`authenticateCliSession`、`authenticateJwtOrCliSession`、`authenticateJwtOrPartnerKey` | `request.agent` | `/dashboard/*` |
| 對外端點 | 終端使用者、渠道平台、外部系統 | 各端點自備驗證（粉絲 token、chatbox session、渠道簽章） | 無統一身分 | widget、LIFF、`/chatbox`、`/trial` |

兩個後台的登入互不相通。平台後台把 token 存在 localStorage 的獨立 key，由 `apps/web/src/app/admin/lib/platform-api.ts` 的 axios 實例管理。租戶後台用 `apps/web/src/lib/api.ts` 的另一個 axios 實例，token 也存在另一個 key。平台後台的 JWT 由 `PLATFORM_JWT_SECRET` 簽發；未設定這個變數時，`/api/v1/platform/auth/login` 回 503 `PLATFORM_DISABLED`。

**判斷一個路由屬於哪一面，要看它掛哪個 `authenticate`，不是看模組放在哪個目錄。** `apps/api/src/modules/platform/plan-change.routes.ts` 放在 platform 目錄下，但這個檔案掛在 `/api/v1/plan-change`，用的是租戶的 `fastify.authenticate` 加 `settings.manage` 權限。租戶在這個路由提出升級申請，平台營運方在 `/api/v1/platform/plan-change-requests` 審核。platform 目錄因此同時服務兩個面。

## 平台後台（/admin）

所有路由掛在 `/api/v1/platform`，由 `platform` 模組提供，全部經過 `authenticatePlatformSuperuser`。平台層的資料表沒有 RLS，因此這個模組使用 `fastify.prismaAdmin`。

| `/admin` 頁面 | API 路由 | 功能 |
| --- | --- | --- |
| `/admin/login`、`/admin/forgot-password`、`/admin/reset-password`、`/admin/change-password` | `POST /auth/login`、`POST /auth/change-password` | 平台帳號登入與密碼復原 |
| `/admin/platform-users` | `GET、POST /platform-users`、`PATCH /platform-users/:id`、`PATCH /platform-users/:id/active`、`POST /platform-users/:id/resend-welcome`、`GET /platform-users/:id/audit-logs` | 平台帳號管理與操作稽核 |
| `/admin/tenants` | `GET、POST /tenants`、`PATCH /tenants/:id`、`PATCH /tenants/:id/active`、`PATCH /tenants/:id/contract`、`PATCH /tenants/:id/restore` | 租戶開通、合約與停用復原 |
| `/admin/plans` | `GET /plans`、`PATCH /plans/:id` | 方案與用量上限 |
| `/admin/usage` | `GET /usage/overview`、`GET /usage/tenants`、`GET /usage/tenants/:tenantId` | 跨租戶用量與成本統計 |
| `/admin/plan-changes` | `GET /plan-change-requests`、`PATCH /plan-change-requests/:id/approve`、`PATCH /plan-change-requests/:id/reject` | 審核租戶提出的方案異動 |
| `/admin/trial` | `GET /trial-signups`、`POST /trial-signups/:id/resend`、`PATCH /trial-signups/:id/fail`、`GET /trial-tenants`、`PATCH /trial-tenants/:id/extend`、`PATCH /trial-tenants/:id/convert` | 試用申請與試用租戶管理 |
| 無頁面 | `GET /registry`、`GET、PUT /settings/:key` | 權限註冊表查詢與平台設定 |

試用功能跨兩個面：對外的申請流程在 `trial` 模組，平台後台的審核邏輯在 `platform/trial-admin.service.ts`。

## 租戶後台（/dashboard）

路由掛在 `/api/v1` 下，經過 `fastify.authenticate` 取得 `request.agent`，再由 `requirePermission()` 檢查權限碼。資料存取用 `request.tenantPrisma` 或 `withTenant()`，兩者都受 RLS 約束。

### 對話與工單

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `conversation` | `/api/v1/conversations` | `/dashboard/inbox` | 僅需登入 |
| `case` | `/api/v1/cases` | `/dashboard/cases` | 僅需登入 |
| `notification` | `/api/v1/notifications` | `/dashboard/notifications` | 僅需登入 |
| `ai` | `/api/v1/ai` | 收件匣內的 AI 輔助 | `inbox.view`、`inbox.reply` |

`conversation` 提供收送訊息、轉接、關閉對話與開立工單。`case` 提供指派、升級、結案、重開、備註與發送滿意度調查。

### 聯繫人與標籤

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `contact` | `/api/v1/contacts` | `/dashboard/contacts` | 僅需登入 |
| `tag` | `/api/v1/tags` | `/dashboard/settings/tags` | 僅需登入 |
| `canvas`（identity 部分） | `/api/v1/identity` | 無頁面 | `identity.review` |

`contact` 含跨渠道身分合併（`GET /merge-preview`、`POST /merge`）。`/api/v1/identity` 是另一組端點，用來人工審核系統自動產生的合併建議。

### 知識庫與 AI

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `knowledge` | `/api/v1/knowledge` | `/dashboard/knowledge` 及其子頁 | `knowledge.manage`、`knowledge.admin` |

知識庫路由另外接受 `authenticateJwtOrPartnerKey`，讓外部夥伴系統以 API 金鑰匯入文件。

### 行銷與粉絲經營

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `marketing` | `/api/v1/marketing` | `/dashboard/marketing` 及 campaigns、broadcasts、segments | `marketing.view`、`marketing.manage`、`marketing.broadcast` |
| `marketing`（素材） | `/api/v1/marketing/materials` | `/dashboard/marketing/materials` | 同上 |
| `shortlink` | `/api/v1/shortlinks` | `/dashboard/shortlinks` | 僅需登入 |
| `portal` | `/api/v1/portal` | `/dashboard/portal` | `portal.view`、`portal.manage` |

### 渠道

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `channel` | `/api/v1/channels` | `/dashboard/settings/channels` | `channel.view`、`channel.create`、`channel.update`、`channel.delete`、`channel.assign_team` |
| `line` | `/api/v1/line/rich-menus`、`/api/v1/line/quick-reply-presets` | `/dashboard/line/*` | `richmenu.manage`、`quickreply.manage` |
| `storage` | `/api/v1/files` | 各上傳介面 | 僅需登入 |

### 自動化

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `automation` | `/api/v1/automation` | `/dashboard/automation` | `automation.view`、`automation.manage` |
| `canvas` | `/api/v1/canvas` | 無頁面 | `canvas.use` |
| `sla` | `/api/v1/sla-policies` | `/dashboard/settings/sla` | `sla.manage` |

`canvas` 是多步驟的聯繫人旅程引擎，機制見[互動流程引擎](./CANVAS-FLOW-ENGINE.md)。

`sla` 模組只有政策的 CRUD。逾時的判定與處置在 `apps/workers`，機制見[服務水準協議](./SLA.md)。

### 分析

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `analytics` | `/api/v1/analytics` | `/dashboard/analytics`、`/dashboard/analytics/my` | `analytics.view`、`analytics.export` |

### 帳號、設定與治理

| 模組 | 路由前綴 | 後台頁面 | 權限碼 |
| --- | --- | --- | --- |
| `auth` | `/api/v1/auth` | `/login`、`/dashboard/settings/passkeys` | 僅需登入 |
| `agent` | `/api/v1/agents` | `/dashboard/settings/agents` | `agent.view`、`agent.manage`、`agent.role.assign`、`agent.password.reset`、`agent.deactivate`、`agent.purge` |
| `role` | `/api/v1/roles` | `/dashboard/settings/roles` | `role.view`、`role.manage` |
| `settings` | `/api/v1/settings` | `/dashboard/settings/*` | 僅需登入 |
| `cli` | `/api/v1/cli` | `/dashboard/settings/cli-sessions` | CLI session 驗證 |
| `mcp` | `/mcp` | 無頁面 | JWT 或 CLI session，再依工具檢查 scope |
| `webhook-subscriptions` | `/api/v1/webhook-subscriptions` | 無頁面 | `webhook.view`、`webhook.manage` |
| `tenant-audit` | `/api/v1/tenant/audit-logs` | 無頁面 | `audit.view` |
| `data-export` | `/api/v1/tenant/data-export` | 無頁面 | `data.export` |
| `data-erasure` | `/api/v1/tenant/data-erasure` | 無頁面 | `data.erase` |
| `platform`（plan-change 部分） | `/api/v1/plan-change` | `/dashboard/plan` | `settings.manage` |

`auth` 模組涵蓋密碼登入、token 更新、Passkey 註冊與驗證，以及 CLI 登入。設定頁有哪些分頁，定義在 `apps/web/src/app/dashboard/settings/page.tsx` 的 `SETTINGS_TABS`。

## 對外端點

下列路由不屬於任何一個後台。這些路由服務終端使用者或外部系統，每個路由各自驗證呼叫者。

| 模組 | 路由前綴 | 呼叫者 | 驗證方式 |
| --- | --- | --- | --- |
| `webhook` | `/api/v1/webhooks/line/:channelId`、`/fb/:channelId`、`/threads/:channelId` | LINE、Facebook、Threads | 渠道簽章，無 JWT |
| `webchat` | `/api/v1/webchat/:channelId/sessions`、`/messages`、`/media` | 網站訪客（widget） | 訪客 session |
| `chatbox` | `/api/v1/chatbox/sessions`、`/sessions/verify`、`/messages`、`/media` | 嵌入式 chatbox | `chatboxSessionVerifier` |
| `portal`（public 部分） | `/api/v1/fan` | LINE 粉絲（LIFF） | `authenticateFan` |
| `trial` | `/api/v1/trial/signups`、`/verify`、`/resend` | 試用申請者 | 信箱驗證 token |
| `line-login`、`fb-login` | `/api/v1/auth/line`、`/api/v1/auth/fb` | OAuth 授權流程 | `/authorize` 與 `/callback` 公開；`/request-email` 需客服登入 |
| `shortlink`（redirect 部分） | `/s/:slug`、`/s/track` | 點擊短連結的人 | 無 |
| `storage`（imagemap 部分） | `/line-imagemap/:tenantId/:imageId/:width` | LINE 平台抓圖 | 無 |

這些端點在辨識出租戶之前就必須查資料，因此使用 `fastify.prismaAdmin`。`scripts/check-prisma-admin-usage.mjs` 的白名單已涵蓋這個用法。

## 沒有路由的模組

下列模組不掛路由，由其他模組呼叫。

| 模組 | 內容 | 呼叫者 |
| --- | --- | --- |
| `csat` | 滿意度調查的發送與計分 | `case.routes.ts`、`csat.scheduler.ts`、`webhook/inbound-postback-interceptors.ts` |
| `email` | Resend 寄信封裝 | `platform-user-emails.ts`、`trial-emails.ts`、`usage-alert-emails.ts`、`canvas.worker.ts` |
| `embedding` | Ollama BGE-M3 向量生成與 pgvector 檢索，設定依租戶 | `ai.service.ts`、`kb-autoreply.service.ts`、`knowledge.service.ts`、`partner-ingest.service.ts` |
| `socket` | Socket 房間授權與訂閱頻率限制 | `plugins/socket.plugin.ts`、`services/channel-visibility.ts` |
| `upload` | 上傳內容型別偵測與驗證 | `storage`、`conversation`、`channel`、`knowledge` 的路由 |

## 有 API、沒有頁面的功能

下列功能的 API 已存在，租戶後台目前沒有對應頁面。要操作這些功能，只能透過 CLI、MCP，或直接呼叫 API。

| 功能 | 路由 |
| --- | --- |
| 租戶稽核日誌查詢 | `GET /api/v1/tenant/audit-logs` |
| 資料匯出申請 | `POST /api/v1/tenant/data-export` |
| 資料刪除申請 | `POST /api/v1/tenant/data-erasure` |
| 對外 Webhook 訂閱管理 | `/api/v1/webhook-subscriptions` |
| Canvas 自動化流程 | `/api/v1/canvas` |
| 身分合併建議審核 | `/api/v1/identity` |

## 背景工作的歸屬

背景工作分在兩個行程執行，兩邊的機制不同。

- **API 行程**跑的是 in-process 的 eventBus 監聽器與 `setInterval` 排程。函式名稱裡的 `Worker` **不代表 BullMQ consumer**：`setupNotificationWorker` 與 `setupAutomationWorker` 訂閱 eventBus，再把工作送進 BullMQ queue，扮演的是 producer。
- **`apps/workers` 行程**是唯一的 BullMQ consumer。

在 API 行程啟動（`apps/api/src/index.ts`）：

| 啟動函式 | 所屬模組 | 機制 |
| --- | --- | --- |
| `setupNotificationWorker` | `notification` | 訂閱 eventBus，送入 `notification` queue |
| `setupAutomationWorker` | `automation` | 訂閱 eventBus，送入 `automation` queue |
| `setupCanvasWorker` | `canvas` | 訂閱 eventBus，直接執行動作 |
| `setupWebhookDispatcher` | `webhook-subscriptions` | 訂閱 eventBus，發送對外 Webhook |
| `setupCanvasScheduler` | `canvas` | `setInterval` 週期執行 |
| `setupTrialScheduler` | `trial` | `setInterval` 週期執行 |
| `setupAnalyticsScheduler` | `analytics` | `setTimeout` 排定下一次執行 |
| `setupBroadcastScheduler` | `marketing` | `setInterval` 週期執行 |
| `setupCsatScheduler` | `csat` | `setInterval` 週期執行 |
| `setupInactivityCloseWorker` | `conversation` | `setInterval` 週期執行 |
| `startA2ABridgeWorker` | `settings` | 常駐輪詢 A2A Hub，由 `A2A_BRIDGE_ENABLED` 控制 |

在 `apps/workers` 行程消費的 BullMQ queue（`apps/workers/src/index.ts`）：

| queue | 對應的 API 模組 | 觸發方式 |
| --- | --- | --- |
| `notification` | `notification` | 由 API 行程送入 |
| `automation` | `automation` | 由 API 行程送入 |
| `rich-menu-bind` | `line` | 由 API 行程送入 |
| `data-erasure` | `data-erasure` | 由 API 行程送入 |
| `data-export` | `data-export` | 由 API 行程送入 |
| `sla` | `sla` | workers 自行註冊重複工作 |
| `data-export-cleanup` | `data-export` | workers 自行註冊重複工作 |
| `agent-retention-cleanup` | `agent` | workers 自行註冊重複工作 |

`workers` 行程另外會清掉 `broadcast` queue 的舊重複工作，避免與 API 行程的 `setupBroadcastScheduler` 重複發送。

## 自己驗證分類的方法

本文件的表格是 2026-09-23 的快照。要確認當下的狀態，執行下列指令。

```bash
# 每個模組掛在哪個路由前綴
grep -n "app.register(.*prefix" apps/api/src/index.ts

# 某個模組用哪種認證與權限
grep -rn "authenticate\|requirePermission" apps/api/src/modules/<模組>/

# 平台後台專屬的路由
grep -rn "authenticatePlatformSuperuser" apps/api/src/modules/

# 某個路由前綴有沒有前端在呼叫
grep -rn "'/<前綴>" apps/web/src
```
