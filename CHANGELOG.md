# Changelog

All notable changes to the **open333CRM** project will be documented in this file.

## [Unreleased]

### Added
- **Embeddable WebChat widget + visitor namespace (2026-04-08)** — 建立 `apps/widget` IIFE bundle 並由 API 透過 `GET /webchat/widget.js` 提供，新增 `/api/v1/webchat/:channelId/sessions` 與 `/messages` 公開路由、`/visitor` Socket.IO namespace（Redis bridge）推播 agent/bot 回覆，每個 `sessionStorage` 分頁維護獨立 `visitorToken`，嵌入碼自動降級至 `API_BASE_URL`。
- **Variable picker for marketing templates (2026-04-07)** — 新增 `GET /marketing/templates/available-variables` 回傳聯絡人/系統/attribute 分類的變數清單、`TemplateFormDialog` 顯示可搜尋的 `VariablePicker`，插入 `{{key}}` 後會自動補齊 `variables` 定義，減少手動輸入錯誤。
- **Shortlink real-time click stats via Socket.IO (2026-04-01)** — 短連結點擊後立即透過 Socket.IO 廣播 `link.stats.updated` 事件至同一 tenant 的所有連線者，前端 `useShortLinks`（列表頁）與 `useClickStats`（詳情頁）訂閱事件並即時 mutate，不再需要重新整理頁面。
- **RBAC guards implemented (2026-03-30)** — 新增 `apps/api/src/guards/rbac.guard.ts`，提供 `requireRole(allowedRoles)`、`requireAdmin()`、`requireSupervisor()` 三個 Fastify preHandler factory。權限矩陣：ADMIN 擁有全部操作；SUPERVISOR 可讀 channels/automation/analytics/settings/marketing/webhooks；AGENT 僅限 conversations 等不受限端點。已套用至 channel、automation、sla、settings、analytics、marketing、webhook-subscription、portal 等模組。資料層過濾（tenant scope 以外的 row-level security）延後實作。

### Changed
- **Public runtime routing stabilized for web, widget, and shortlinks (2026-04-10)** — 新增 `public-runtime-config` 與 `shortlink-routing` specs，browser runtime 以單一 `NEXT_PUBLIC_API_URL` 正規化 `apiBaseUrl`/realtime origin，web build 會把最新 widget bundle 同步到 `public/webchat/widget.js`，embed code 可用 `WEB_BASE_URL` 覆蓋 widget origin，`Caddyfile` 明確將 `/webchat/*` 導向 web runtime、`/s/*` 導向 API runtime，後台複製短連結時改用目前瀏覽器公開 origin 的 `/s/:slug`。
- **Channel plugins consolidated under `@open333crm/channel-plugins` (2026-04-08)** — 把 registry/interface/adapters 合併到 shared package、刪除 `apps/api/src/channels/{line,fb,webchat,...}` 與 `routes/webhooks.ts`，API/worker 透過 `registerChannelPlugin`/`getChannelPlugin` 使用單一 `ChannelPlugin`，並刪除重複的 `adapters/` 與 `webhook-adapter.ts`。
- **Database embed dims + Ollama defaults aligned (2026-04-07)** — Prisma schema 的 `KmArticle.embedding` 與 `LongTermMemory.embedding` 改為 1024 維以對應 `bge-m3`，`.env` 範本文件改為 `OLLAMA_CHAT_MODEL=qwen2.5:0.5b`，`deliverToChannel` 加強 Webchat-side Redis 推播與日誌，同時 `WebchatPlugin.sendMessage` 回傳 `channelMsgId` 但實際交付由 service 端推播。
- **Standalone BullMQ workers fully wired (2026-03-30)** — `apps/workers/` 獨立 worker 程序已從空殼升級為完整實作：SLA 輪詢、廣播排程以 BullMQ repeating job（每 60s）執行；Notification 與 Automation 改以 BullMQ job consumer 非同步消費。API 同步 enqueue 至 BullMQ 佇列（雙路徑，不影響現有 in-process 邏輯）。新增 Redis pub/sub socket bridge（`socket:emit` channel），worker 程序可透過 Redis 將 WebSocket 事件中繼至 API 的 Socket.IO clients。
- **OpenSpec archives completed (2026-03-26)** — 已封存 `unified-interaction-canvas`、`crm-core-logic`、`channel-plugins-expansion` 三個 change。
  - `unified-interaction-canvas`：已手動同步 main specs 後封存
  - `crm-core-logic`：已手動同步 main specs 後封存
  - `channel-plugins-expansion`：無 delta specs，帶 validation warning 封存
- **API bootstrap source of truth moved back to `apps/api/src/index.ts` (2026-03-30)** — 現行 Fastify bootstrap、channel plugin registration、workers/schedulers、dev/start scripts 已收斂回 `index.ts`，`main.ts` 降為相容 delegate。
- **Local runtime config aligned with docker-compose ports (2026-03-30)** — root `.env.example`、`apps/api/.env.example`、README 與 Redis fallback 已對齊 Postgres `5432` / Redis `6380`，避免 bootstrap 已切回 `index.ts` 後仍沿用錯誤本機埠。
- **Database source of truth restored to `packages/database` (2026-03-30)** — root `db:*` scripts、Docker build、API wiring 全數切回 `packages/database`，`packages/db` 改為相容 alias，不再作為主要 Prisma schema 來源。
- **Schema reconciliation completed for API runtime (2026-03-30)** — 以 `packages/database/prisma/schema.prisma` 為主，併回 Daniel 線上已被 API 使用的相容模型與欄位（如 automation legacy fields、notifications、daily stats、campaign/broadcast recipient、portal、shortlink 等），同時保留 Tenant / Identity / Canvas 架構。

### Fixed
- **IME-safe Enter handling for inbox and widget inputs (2026-04-10)** — `core-inbox` 與 `webchat-widget` 規格已同步：中文/日文輸入法組字時按 Enter 只確認候選字，不會誤送出訊息；inbox 仍保留 `Shift+Enter` 換行。
- **Inbox conversations now use SWR + paged message loading (2026-04-07)** — `InboxPage` 直接用 `useSWR(`/conversations/${convId}`)`，`ChatWindow` 的 `globalMutate` 能重新驗證資料，`useMessages` 改為 `order=desc`、基於頁碼載入舊訊息並防止 mutate 重複，所有 handoff/status/assignment UI 即時更新。
- **Notification event-bus worker no longer duplicates dispatch (2026-04-07)** — API worker 僅 enqueue BullMQ job，DB 寫入與 socket 發送全部交給 standalone worker（`standalone-worker-runtime` spec 也更新）。
- **Dialogs require a double-click on the backdrop (2026-04-07)** — 阻止單擊誤關閉 `Dialog`。
- **Channel credential encryption uses `CREDENTIAL_ENCRYPTION_KEY` (2026-04-07)** — API 與 worker 都從 new env var 推導 AES 金鑰以避免「Unsupported state or unable to authenticate data」錯誤。
- **Ollama container waits for `ollama list` + auto-pulls models (2026-04-07)** — Docker healthcheck 與 entrypoint 改用 `ollama list`（image 沒有 curl），啟動時自動 pull `OLLAMA_CHAT_MODEL`/`OLLAMA_EMBED_MODEL` 並在 `.env.example` 註記。
- **Caddy WebSocket proxy missing `/socket.io/*` route (2026-04-01)** — `Caddyfile` 缺少 `/socket.io/*` 路由，導致所有 Socket.IO 流量被轉發至 `web:3000` 而非 `api:3001`，造成 `WebSocket connection failed: timeout` 並 fallback to polling 失敗。新增路由規則後 socket 連線恢復正常，`/socket.io/?transport=polling` 回傳 HTTP 200 並包含 `"upgrades":["websocket"]`。
- **API build recovered after schema split** — 補齊 Prisma client regenerate、`packages/core` / `packages/shared` rebuild、canvas/webhook 型別與 import 修正，`pnpm --filter @open333crm/api build` 已恢復成功。

## [v0.2.0] - 2026-03-25

### Added
- **AI Copilot & Material Assistant**: AI 定位從全自動回覆轉為「副駕駛」，提供建議由人工「採用」。新增 AI 生成行銷素材（Banner、圖文選單）功能。
- **Notification Bell System (小鈴鐺)**: 新增類 FB 的即時通知中心，透過 WebSocket 推送案件指派、SLA 預警、CSAT 差評等事件。
- **Credit Depletion Automation**: 當 AI 點數不足時，系統會自動觸發 `credits.depleted` 事件，並即時在前端禁用 AI 功能與顯示警告。
- **Team-based Channel Access**: 渠道綁定流程新增「部門授權」步驟，實現更精細的資料權限隔離。
- **AI Adoption Analytics**: 新增「AI 採用率」與「客服修正率」報表，用於評估 AI 建議品質。

### Changed
- **Documentation Refinement (07-23)**: 全面細化 `docs/` 文件，將「事件驅動」與「AI Copilot」原則貫穿所有模組設計。
- **Bot Autorouter Logic**: 辦公時間內的 AI 從「自動回覆」改為「僅建議」，明確客服的責任邊界。
- **DB Schema (`Message`)**: 新增 `isAiSuggested`, `isAdopted`, `originalSuggestion` 等欄位，用於追蹤 AI 建議的生命週期。
- **DB Schema (`Notification`)**: 新增 `Notification` 模型，用於持久化儲存小鈴鐺通知。
- **UI Wireframes**: 加入「小鈴鐺下拉選單」與「AI Copilot 建議面板」的 ASCII 設計。

## OpenSpec Change Notes

### unified-interaction-canvas (target 0.5.0, not released)

> **狀態**：OpenSpec `opsx:apply` 任務已全數勾選，但實作仍在收尾中；目前已完成核心後端串接，尚未達到可封存狀態。變更由 `openspec/changes/unified-interaction-canvas` 管理。

### Added
- **Interaction Canvas backend skeleton** — 新增 `InteractionFlow`、`InteractionNode`、`FlowExecution`、`FlowLog`、`TemplateView`、`IdentityMap`、`MergeSuggestion` 等資料模型與對應後端程式碼。
- **Canvas runtime wiring** — Webhook 進站現在可觸發 Canvas Flow；`WAIT` 節點已接上 resume poller；`canvas.send_message` / `canvas.action` 事件已有 API 端 consumer。
- **Identity stitching runtime merge** — LINE / Facebook Login callback 現在會在同 tenant 同 email 命中時執行 contact merge，並回寫 `IdentityMap`。
- **Canvas email delivery path** — 新增 email delivery service，支援 `EMAIL_DELIVERY_MODE=log|webhook`，Canvas email node 可渲染 HTML 並進入 delivery flow。

### In Progress
- **Integration testing** — `apps/api/src/__tests__/canvas-flow.test.ts` 目前仍為 mocked simulation，尚未升級為真實 webhook / DB / scheduler / delivery integration test。
- **Email delivery provider** — 預設仍為 `log` 模式；若要實際送信，需配置 `EMAIL_WEBHOOK_URL` 或後續接入正式 provider。
- **Identity stitching coverage** — 目前已補 webhook 與 LINE / FB login callback 的主要路徑，但 LIFF / 多入口的完整覆蓋仍待補齊。

### Note for Ops
- **Do not archive yet**: 雖然 OpenSpec 任務清單顯示完成，但整個 repo 仍存在既有 type/schema 漂移，需等 `unified-interaction-canvas` 相關整合測試補齊後再考慮封存。
- **Canvas email env**: 若需實際送信，請配置 `EMAIL_DELIVERY_MODE=webhook`、`EMAIL_WEBHOOK_URL`，必要時再補 `EMAIL_WEBHOOK_AUTH_TOKEN` 與 `EMAIL_FROM`。

### docs-01-02-architecture (target 0.4.0, archived)

> **狀態**：完成核心架構實作與多租戶隔離。變更由 `openspec/changes/docs-01-02-architecture` 管理並已封存。

### Added
- **多租戶隔離 (Multi-tenancy)** — 在 Prisma Schema 中導入 `Tenant` 模型，並完成所有核心實體的 `tenantId` 範圍限制（Agent, Contact, Case, Conversation, AutomationRule）。
- **核心業務服務 (`packages/core`)** — 建立並實作五大基礎服務模組：
    - `InboxService`：統一訊息攝入與事件分發。
    - `ContactService`：跨渠道身份識別與聯絡人管理。
    - `CaseService`：案件生命週期管理，整合 BullMQ 進行 SLA 延遲任務監控。
    - `AutomationEngine`：響應式自動化引擎，基於 Event Bus 觸發標籤、案件與訊息動作。
    - `ChannelAdapter`：標準化渠道介入介面。
- **平台基礎設施** — 
    - `EventBus`：基於 Redis 的內部分發機制。
    - `StorageLayer`：抽象儲存層，支援 MinIO 物件儲存。
    - `LicenseService`：租戶授權與功能旗標管控中心。
- **API Gateway 路由註冊** — 在 `apps/api` 完成 `contacts`、`cases` 路由註冊與 Webhook 轉接邏輯。

### Fixed
- **Monorepo 編譯依賴** — 修復 `packages/database` 與 `packages/channel-plugins` 的 TypeScript 編譯設定與 Redis 型別轉換問題。

### line-oa-channel-plugin (target 0.3.0, archived)

> **狀態**：OpenSpec 實作完成，測試（11.x）待補。變更由 `openspec/changes/line-oa-channel-plugin` 管理。

### Added
- **LINE OA Channel Plugin** (`packages/channel-plugins/src/line/`) — 完整實作 `LinePlugin`：
  - HMAC-SHA256 Webhook 簽名驗證
  - 解析 11 種 LINE Webhook 事件（`message`, `postback`, `follow`, `unfollow`, `join`, `leave`, `memberJoined`, `memberLeft`, `unsend`, `videoPlayComplete`, `accountLink`）
  - 支援 5 種發送策略：Reply / Push / Multicast（500/批）/ Broadcast / Narrowcast
  - 支援全部 LINE 訊息類型：Text / Image / Video / Audio / Location / Sticker / Flex / Imagemap / Template + Quick Reply
- **Plugin Extensions 機制** — `ChannelPlugin.extensions?: { ui, audience, analytics }` 可選介面，供渠道特有功能擴充使用
- **`ChannelUiExtension`** — Rich Menu 完整 CRUD、批次用戶綁定（3次/小時 Rate Limit）、Alias A/B 切換
- **`ChannelAudienceExtension`** — Audience Group 管理（upload / click / impression 三種類型），Narrowcast 進度輪詢，取消 Narrowcast
- **`ChannelAnalyticsExtension`** — Insight 粉絲統計、人口統計、送達/讀取率查詢，配額查詢
- **LIFF helpers** — LIFF App CRUD（列出 / 建立 / 更新 / 刪除）
- **Account Link helpers** — Issue Link Token、`accountLink` Webhook 處理
- **BullMQ Workers**：
  - `worker-media-download` — Webhook 收到媒體時立即下載並上傳至 Storage Layer
  - `worker-narrowcast-progress` — 每 5 分鐘輪詢 Narrowcast 進度（最多 12 小時）
  - `worker-insight-sync` — 每日 UTC 00:30 定時同步 Insight 數據，突破 LINE 14 天保留限制
- **Prisma Schema** — 新增 5 個 Model：`rich_menus`, `rich_menu_user_bindings`, `rich_menu_aliases`, `audience_groups`, `insight_snapshots`
- **`docs/03_CHANNEL_PLUGINS/LINE_OA.md`** — LINE 官方 API 完整參考文件（16 個章節，覆蓋全部 Webhook 事件、訊息類型、發送策略、Rich Menu、Insight、LIFF、Account Link）

### Changed
- **`OutboundMessage`** — 新增 `strategy`、`recipientUids`、`audienceGroupId`、`mediaUrl`、`trackingId`、`quickReplies.imageUrl` 等 LINE 發送所需欄位
- **`packages/channel-plugins/package.json`** — 新增 `bullmq ^5.0.0` 依賴

### Note for Ops
- **DB Migration**: 需執行 `npx prisma migrate dev --name add-line-oa-models` 以套用 5 個新模型。
- **Workers**: 需配置並啟動 `media-download`, `narrowcast-progress`, `insight-sync` 三個 BullMQ Workers 以支援媒體轉存與分析同步。
- **Credentials**: 確保 LINE Channel 憑證中包含 `channelAccessToken` 與 `channelSecret`。

### multi-channel-billing (planned)

> **狀態**：OpenSpec 開放中，尚未開始實作。變更由 `openspec/changes/multi-channel-billing` 管理。

### Planned: Added
- **Telegram Channel Plugin** — 支援文字、圖片、貼圖、位置、Callback Query（按鈕）收發
- **Threads Channel Plugin** — 支援 Instagram Threads / DM 文字、圖片、Story Reply、Like 回應
- **ChannelType enum** — 新增 `TELEGRAM`、`THREADS` 於 `packages/types`
- **Channel-Team Access (ChannelTeamAccess)** — Channel 多部門共用授權，支援 `full` / `read_only` 存取層級
- **Channel Billing** — License JSON 通道數量限制（`maxCount`），每則訊息費用（`messageFee`）評估
- **Team License (multi-dept)** — License JSON 支援 `teams[]` 陣列，各部門獨立通道額度與 Credits
- **ChannelUsage tracking** — 每則訊息計費記錄（通道 / 部門 / 方向 / 費用）
- **Channel Usage Report API** — 通道用量 / 費用分攤報表與 CSV 匯出

### Planned: Changed
- **LicenseService** — 新增 `getTeamLicense()`, `isFeatureEnabledForTeam()`, `hasCreditsForTeam()`, `deductCreditsForTeam()` 多部門方法
- **Channel creation API** — 支援 `defaultTeamId`，建立時自動建立 1 筆 ChannelTeamAccess
- **Credits system** — 改為 team-aware 判斷，費用歸屬對應部門

### Planned: DB Schema
- **New**: `channel_team_accesses` 表（Channel 多對多 Team）
- **New**: `channel_usages` 表（訊息計費記錄）
- **Modified**: `teams` 表新增 `licenseTeamId` 欄位（對應 License JSON teamId）

### webchat-embeddable-widget (archived 2026-04-08)

> **狀態**：Spec-driven change 已封存。`openspec/changes/archive/2026-04-08-webchat-embeddable-widget` 管理。

- `webchat-widget` spec 要求 widget 在 `sessionStorage` 每個 tab 生成獨立 `visitorToken`，呼叫 `/api/v1/webchat/:channelId/sessions` 取得 greeting，不再讀取歷史訊息，並透過 `/visitor` namespace 的 `agent:message` 接收 realtime 回覆。
- Embed bundle 由 API 在 `GET /webchat/widget.js` 提供，`visitor` namespace 需驗證 `channelId` + `visitorToken`、將 visitor 加入 `visitor:${channelId}:${visitorToken}` 房間，agent/bot reply 透過 Redis `socket:emit` 發送。

### stabilize-public-runtime-routing (archived 2026-04-10)

> **狀態**：Spec-driven change 已封存。`openspec/changes/archive/2026-04-10-stabilize-public-runtime-routing` 管理。

- `public-runtime-config` spec 新增：browser runtime 以單一 `NEXT_PUBLIC_API_URL` 正規化 API base 與 realtime origin，web build 需在 `next build` 時嵌入 public runtime config，並產出 `public/webchat/widget.js`。
- `shortlink-routing` spec 新增：公開短連結固定走同一公開 origin 的 `/s/:slug`，edge proxy 將 `/s/*` 轉給 API；後台複製短連結時也以目前瀏覽器 origin 組 URL。
- `core-inbox` 與 `webchat-widget` specs 補上 IME-safe Enter requirement，避免中文/日文輸入法組字時誤送訊息；widget embed bundle requirement 也改成由 web public runtime 提供並支援 `WEB_BASE_URL`。

### unify-channel-plugin-interface (archived 2026-04-08)

> **狀態**：Spec-driven change 已封存。`openspec/changes/archive/2026-04-08-unify-channel-plugin-interface` 管理。

- `channel-plugins` spec 更新：統一 interface 中 `parseWebhook` 回傳 `ParsedWebhookMessage[]`、`sendMessage` 採 `OutboundPayload`，`registerChannelPlugin`/`getChannelPlugin` 取代舊命名；`WebchatPlugin.sendMessage` 只回傳 `channelMsgId`，實際交付由 caller 在 `/visitor` namespace 發 `agent:message`。
- 同步整理 `channel-plugins` 標準介面，刪除 `adapters/`、`webhook-adapter.ts`，保證所有 consumers 皆從同一套 type import。

### migrate-channel-plugins (archived 2026-04-08)

> **狀態**：Spec-driven change 已封存。`openspec/changes/migrate-channel-plugins` 管理。

- `channel-plugins` 規格要求 `ChannelPlugin` interface 與 registry 移入 shared package，`apps/api` 不再保留 `src/channels/{line,fb,webchat}`；API/worker 透過 `@open333crm/channel-plugins` 根目錄匯入（含 `registerChannelPlugin`/`getChannelPlugin`）。
- 刪除 `apps/api/src/routes/webhooks.ts`，所有 webhook 程式碼改用 package 的 `linePlugin`/`fbPlugin`/`webchatPlugin` 實作。

### fix-notification-worker-dedup (archived 2026-04-07)

> **狀態**：Spec-driven change 已封存。`openspec/changes/archive/2026-04-07-fix-notification-worker-dedup` 管理。

- API event-bus worker `notification.worker.ts` 只 enqueue BullMQ job，移除 `createAndDispatch`，讓 standalone worker 成為 DB 與 socket emission 的唯一責任方。
- `standalone-worker-runtime` spec 強調 API worker 不可直接寫入 `notification` 表或 emit socket，所有 dispatch 操作皆由 worker container 透過 Redis pub/sub 完成。

### template-variable-picker (archived 2026-04-07)

> **狀態**：Spec-driven change 已封存。`openspec/changes/archive/2026-04-07-template-variable-picker` 管理。

- `template-variable-picker` spec 規定 `GET /marketing/templates/available-variables` 回傳分類變數（contact、case、storage、attribute.*），前端需用 Variable Picker 插入 `{{key}}` 並自動補齊 `variables` 變數陣列。
- `advanced-template-library` 規格補充：contentType 為 `text` 時顯示 Variable Picker，插入已存在的變數不重複新增、新變數附預設 defaultValue。

### fix-inbox-realtime-rendering (archived 2026-04-07)

> **狀態**：Spec-driven change 已封存。`openspec/changes/archive/2026-04-07-fix-inbox-realtime-rendering` 管理。

- `core-inbox` 規格加入 `InboxPage` 必須用 `useSWR('/conversations/:id')` 取對話資料，讓 `globalMutate('/conversations/:id')` 觸發即時 revalidation，handoff/status/assignment 變更立刻反映畫面。
- 加入 `HandoffModal`、status/agent select 的 scenario，並明確規格 `convId` 為 null 時不發出 API 請求。

## [0.1.0] - 2026-03-18


### Added
- **Brain Module**: New `@open333crm/brain` package for KM and LTM logic.
- **Hybrid Search**: Implemented LanceDB + BM25 FTS for semantic and keyword search.
- **Multimodal Ingestion**: Integrated `markitdown` (Python) and `Whisper` for PDF/Docx/Audio to Markdown conversion.
- **Long-Term Memory (LTM)**: Added contact-specific conversation summarization and similarity-triggered retrieval (0.82 threshold).
- **Persistent Workspace**: Configured bind-mount for `/workspace` in Docker to persist vector data.
- **Monorepo Architecture**: Initialized with `pnpm` workspaces and `Turborepo`.
- **Database Layer**: Prisma schema implementation for 20+ entities with `pgvector` support (`packages/database`).
- **Automation Core**: Integrated `json-rules-engine` for Drools-like rule evaluation (`packages/automation`).
- **API Skeleton**: Fastify server with JWT, CORS, and WebSocket support (`apps/api`).
- **Web Skeleton**: Next.js 15 (App Router) dashboard with Tailwind CSS (`apps/web`).
- **Platform Billing (Taishang Huang)**: Implemented `LicenseService` for instance-level feature flags and credit management.
- **Infrastructure**: `docker-compose.yml` for PostgreSQL, Redis, MinIO, and Caddy.
- **CI Pipeline**: GitHub Actions for automated linting and building.

### Changed
- **Architectural Pivot**: Moved from record-level multi-tenancy (`tenantId` per row) to a **Single-tenant Group Mode**.
- **Schema Evolution**: Added `KmArticle` versioning, `teamId` isolation, and a new `LongTermMemory` model.
- **Schema Simplification**: Removed all `tenantId` fields; added `teamId` to `Conversation` for departmental isolation (B-1 Option).

### Fixed
- **ESM Support**: Resolved module resolution issues for top-level await and `.js` extensions in imports.
- **Turbo 2.0 Compatibility**: Updated `turbo.json` with correct task syntax.
