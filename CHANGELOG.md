# Changelog

All notable changes to the **open333CRM** project will be documented in this file.

## [Unreleased]

### Changed
- **OpenSpec archives completed (2026-03-26)** — 已封存 `unified-interaction-canvas`、`crm-core-logic`、`channel-plugins-expansion` 三個 change。
  - `unified-interaction-canvas`：已手動同步 main specs 後封存
  - `crm-core-logic`：已手動同步 main specs 後封存
  - `channel-plugins-expansion`：無 delta specs，帶 validation warning 封存

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

---

## [Unreleased] — 0.5.0 (unified-interaction-canvas)

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

---

## [Unreleased] — 0.4.0 (docs-01-02-architecture)

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

---

## [Unreleased] — 0.3.0 (line-oa-channel-plugin)

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

---

## [Unreleased] — 0.2.0 (multi-channel-billing)


> **\u72c0\u614b**\uff1aOpenSpec \u958b\u653e\u4e2d\uff0c\u5be6\u4f5c\u9707\u524d\u3002\u8b8a\u66f4\u7531 `openspec/changes/multi-channel-billing` \u7ba1\u7406\u3002

### Planned: Added
- **Telegram Channel Plugin** \u2014 \u652f\u63f4\u6587\u5b57\u3001\u5716\u7247\u3001\u8cbc\u5716\u3001\u4f4d\u7f6e\u3001Callback Query\uff08\u6309\u9215\uff09\u6536\u767c
- **Threads Channel Plugin** \u2014 \u652f\u63f4 Instagram Threads / DM \u6587\u5b57\u3001\u5716\u7247\u3001Story Reply\u3001Like \u53cd\u61c9
- **ChannelType enum** \u2014 \u65b0\u589e `TELEGRAM`\u3001`THREADS` \u5000\u8207 `packages/types`
- **Channel-Team Access (ChannelTeamAccess)** \u2014 Channel \u591a\u90e8\u9580\u5171\u7528\u6388\u6b0a\uff0c\u652f\u63f4 `full` / `read_only` \u5b58\u53d6\u5c64\u7d1a
- **Channel Billing** \u2014 License JSON \u6e20\u9053\u6578\u91cf\u9650\u5236\uff08`maxCount`\uff09\u3001\u6bcf\u5247\u8a0a\u606f\u8cbb\u7528\uff08`messageFee`\uff09\u8a55\u4f30
- **Team License (multi-dept)** \u2014 License JSON \u652f\u63f4 `teams[]` \u96a3\u5217\uff0c\u5404\u90e8\u9580\u72ec\u7acb\u6e20\u9053\u984d\u5ea6\u8207 Credits
- **ChannelUsage tracking** \u2014 \u6bcf\u5247\u8a0a\u606f\u8a08\u8cbb\u8a18\u9304\uff08\u6e20\u9053 / \u90e8\u9580 / \u65b9\u5411 / \u8cbb\u7528\uff09
- **Channel Usage Report API** \u2014 \u6e20\u9053\u7528\u91cf / \u8cbb\u7528\u5206\u6524\u5831\u8868\u8207 CSV \u532f\u51fa

### Planned: Changed
- **LicenseService** \u2014 \u65b0\u589e `getTeamLicense()`, `isFeatureEnabledForTeam()`, `hasCreditsForTeam()`, `deductCreditsForTeam()` \u591a\u90e8\u9580\u65b9\u6cd5
- **Channel creation API** \u2014 \u652f\u63f4 `defaultTeamId`\uff0c\u5efa\u7acb\u6642\u81ea\u52d5\u5efa\u7acb 1 \u7b46 ChannelTeamAccess
- **Credits system** \u2014 \u6539\u70ba team-aware \u5224\u65b7\uff0c\u8cbb\u7528\u5f52\u5c6c\u5c0d\u61c9\u90e8\u9580

### Planned: DB Schema
- **New**: `channel_team_accesses` \u8868\uff08Channel \u591a\u5c0d\u591a Team\uff09
- **New**: `channel_usages` \u8868\uff08\u8a0a\u606f\u8a08\u8cbb\u8a18\u9304\uff09
- **Modified**: `teams` \u8868\u65b0\u589e `licenseTeamId` \u6b04\u4f4d\uff08\u5c0d\u61c9 License JSON teamId\uff09

---

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
