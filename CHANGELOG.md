# Changelog

All notable changes to **open333CRM** will be documented in this file.

## [Unreleased]

### Added

- **Passkey / WebAuthn authentication** — 新增 Agent Passkey 憑證模型、Redis challenge 防重放、註冊/登入/撤銷 API 與嚴格 RP ID、origin、User Verification 驗證。
- **WebMCP 唯讀 CRM 工具** — 登入後的 CRM dashboard 若瀏覽器支援 WebMCP，會以目前登入 Agent 的 JWT 提供聯絡人、案件、分析與目前客服資訊查詢工具；不支援 WebMCP 的瀏覽器維持原有功能。

### Changed

- Passkey 註冊端點新增 rate limit；未設定 WebAuthn 的部署不再顯示無法使用的登入與綁定控制項。
- Passkey 綁定流程新增裝置名稱輸入與既有 credential 重新命名功能；已綁定清單顯示自訂名稱、裝置類型與備份狀態，方便辨識多個 credential。

## [v0.4.0] - 2026-08-18

### Added

- **Instagram / Threads 渠道支援** — 整合 Meta Graph API 與 Webhook，支援 Instagram Direct Message 訊息收發與渠道管理：
  - 支援 IG 訊息接收、真人私訊收發與 Bot 自動化回應
  - 渠道設定新增 **憑證設定指南（`ChannelFieldGuide`）**，提供 Meta for Developers / LINE Developers 圖文設定指引
  - 支援單一憑證局部安全更新與 Bearer Header 驗證，避免未填欄位覆蓋舊金鑰
- **多租戶登入與安全防護** — 完善多租戶架構之登入與帳號驗證：
  - `Agent.email` 新增全局唯一約束（Global Unique Constraint）資料庫遷移
  - 登入防枚舉機制：租戶啟用檢查移至密碼驗證後，防止惡意探測租戶狀態
- **系統操作手冊** — 建立完整 11 章 HTML 格式之系統操作手冊（位於 `apps/web/public/manual/`）：
  - 包含系統概觀、案件、聯絡人、自動化、知識庫、行銷、LINE、短連結、分析、設定等完整說明與實機截圖
  - 系統頂部導航列（Topbar）新增「操作說明」直接跳轉手冊
  - 新增 Playwright 自動化截圖測試以利維護最新手冊配圖
- **LINE Flex Message 素材匯入與編輯器** — 行銷素材支援 LINE Flex 訊息樣板：
  - 提供 `LineFlexTemplateEditor` 支援 JSON 匯入、即時渲染預覽與參數編輯
  - 自動化關鍵字回覆支援配置 LINE Flex 素材回覆
- **WebTalk 即時協作** — 新增 WebTalk 協作模組與全域組件（`WebTalkGlobal`），支援團隊即時跨組件協同
- **下游 Webhook 轉發（Downstream Webhook）** — 支援將 CRM 接收到的 LINE Webhook 即時轉發給自訂下游第三方系統
- **聯絡人渠道來源標記** — 聯絡人清單標註渠道來源 Provider（LINE、WebChat 等），並隱藏不必要的 WebChat 渠道資訊
- **MCP Streamable HTTP endpoint** — 新增受認證的 `/mcp` endpoint，提供 CRM 唯讀工具給外部 LLM / MCP client：
  - 支援 `initialize`、`tools/list`、`tools/call` 與 JSON response transport
  - 提供目前客服、聯絡人、案件、分析等 tenant-scoped 唯讀工具
  - CLI Token 可選擇授予 `mcp:read` scope，並加入明確 allowed origins、BigInt-safe response serialization 與反向代理路由
- **LLM Skill 快捷按鈕** — Topbar 右上角新增「Skill」按鈕，快速開啟 LLM Skill 文件

### Changed

- **UAT MCP reverse proxy** — Caddy now forwards `/mcp` requests to the API container, matching the Nginx deployment route.
- **MCP/CI hardening** — MCP route now claims Fastify response ownership before transport setup, and GitHub Actions uses Node.js 24-compatible action majors.
- **前端 UI 全面改版（對齊 Figma 設計系統）** — 86 個前端元件與頁面全面重構：
  - 統一 Tailwind 設計 Token、按鈕、分頁、卡片、狀態標籤、對話框與側邊欄樣式
  - 新增 `/design-preview` 設計系統預覽頁面
- **CLI Session 權限** — CLI Token 新增 `CLI_ANALYTICS_READ_SCOPE` 權限範圍
- **Watch 模式** — 開發環境支援檔案變更自動重載

### Fixed

- **MCP 串流錯誤處理** — response stream 中途失敗且已送出 headers 時主動關閉連線，讓 MCP client 能辨識截斷回應並重試，避免誤判為成功。
- **Webhook Echo 迴圈防護** — 過濾 Meta Webhook 發送者為自身的 Echo 訊息，防止 Bot 自問自答死迴圈
- **訊息去重與併發防護** — 新增 `(conversationId, channelMsgId)` 資料庫唯一約束與 `P2002` 衝突捕捉，徹底防止平台重複重送或併發造成的重複回覆
- **首則真人訊息 Race Condition** — 修復多則訊息幾乎同時進線時 `channelIdentity` 建立的 P2002 衝突，改取已建立者並回收孤兒聯絡人
- **圖片訊息誤觸發 KB 知識庫問題** — 補傳 `contentType` 於訊息事件，Worker 僅對純文字訊息執行知識庫語意檢索
- **收件匣圖片顯示相容性** — 前端訊息氣泡補齊 `mediaUrl` 與 `url` 欄位解析，修復 Instagram 圖片無法正常顯示之問題
- **關鍵字自動回覆重複觸發** — 修復 `keyword.matched` 事件於背景 Worker 佇列處理時因缺乏 `ruleId` context 導致多條規則重複發送的問題
- **廣播錯誤捕捉** — 強化行銷活動廣播發送過程中的例外捕捉與狀態紀錄
- **Caddy Port 自動修正** — rsync 部署後自動將 Caddy port 改回 8888，避免與 nginx 衝突
- **Nginx SSL 設定保留** — 部署 rsync 排除 `Caddyfile.local`，保留伺服器上已有的 nginx SSL 設定

## [v0.3.2] - 2026-07-09

### Added

- **CLI 連線管理** — 設定頁新增「CLI 連線」分頁，支援：
  - 產生 CLI token 給 LLM 或 `open333` CLI 使用
  - 指定 token 名稱與過期時間（7/30/90/365 天或永不過期）
  - 列表顯示所有 token、最後使用時間、權限範圍
  - 一鍵撤銷 token，立即失效
- **LLM Skill 文件** — `public/skill.md` 供 LLM 自動探索可用 API
- **Skill 快捷按鈕** — Topbar 右上角「Skill」按鈕，快速開啟 Skill 文件
- **GitHub Actions CI/CD** — push to main 自動部署至 UAT 伺服器（self-hosted ARM64 runner）

### Changed

- README 新增「LLM / CLI 連線」使用說明

## [v0.3.1] - 2026-07-09

### Added

- **CLI 技能文件** — 新增 `@open333crm/cli` 完整技能文件 (`docs/cli/`) 供 LLM 代理使用：
  - `SKILL.md`：架構、現有 4 指令、類型、擴充模式
  - `references/quick-ref.md`：每日速查卡
  - `references/capability-gap.md`：20+ 系統功能對應 CLI 指令缺口分析
  - `references/capability-map.md`：優先級實作路線圖與 Checklist
  - `scripts/scaffold-command.ts`：新指令自動生成腳本
  - `assets/`：Command / API 端點模板
- **README 新增 CLI 區段** — 文件連結、使用範例、擴充指南

### Changed

- CLI 專案文件完整化，方便 LLM 代理直接上手擴充指令

## [v0.3.0] - 2026-07-08

### Added

- **短連結追蹤設定** — 後台設定頁新增「追蹤設定」分頁，支援租戶層級設定 GA4 Measurement ID 與 Meta Pixel ID。設定後短連結 redirect 微頁面自動注入對應追蹤腳本，BOT 爬蟲不注入。

### Changed

- **LINE/FB 素材分流** — 素材建立改為先選渠道再選內容類型，LINE 與 FB 各自獨立的 contentType。
- **自動化規則事件感知** — 條件與動作選項會依選定事件動態過濾，切換事件時自動移除不相容選項。
- **人員管理完善** — 支援 Admin/Supervisor 新增人員、角色變更、密碼重置、停用帳號。
- **Figma 設計系統對齊** — Dashboard、Inbox、案件建立等元件視覺收尾，新增 E2E Playwright 測試（13 spec）。

### Fixed

- **案件刪除與 SLA 政策選擇** — 案件列表新增 row-level 刪除，SLA policy dropdown 改為 controlled state。
- **IME 安全的 Enter 處理** — 中文/日文輸入法組字時按 Enter 不會誤送訊息。
- **Inbox 即時更新** — 改用 SWR + 分頁載入，handoff/status/assignment 變更即時反映。
- **通知去重** — BullMQ worker 不再重複發送通知。
- **Caddy WebSocket** — 補齊 `/socket.io/*` 路由，修復 Socket.IO 連線逾時。

## [v0.2.0] - 2026-03-25

### Added

- **AI Copilot** — AI 從全自動回覆改為「副駕駛」模式，提供建議由人工採用。支援 AI 生成行銷素材。
- **通知小鈴鐺** — 即時通知中心，WebSocket 推送案件指派、SLA 預警、CSAT 差評等事件。
- **點數耗盡自動化** — AI 點數不足時自動禁用 AI 功能並顯示警告。
- **團隊渠道授權** — 渠道綁定新增「部門授權」步驟，實現資料權限隔離。
- **AI 採用率分析** — 新增 AI 採用率與客服修正率報表。

### Changed

- **Bot 路由邏輯** — 辦公時間內 AI 從「自動回覆」改為「僅建議」。
- **DB Schema** — 新增 Notification 模型、AI 建議生命週期欄位。

## [v0.1.0] - 2026-03-18

### Added

- **Monorepo 架構** — pnpm workspaces + Turborepo，TypeScript 全端。
- **多渠道整合** — LINE / Facebook Messenger / WebChat 統一收件箱。
- **案件管理** — 完整 Ticket 生命週期， BullMQ SLA 監控。
- **自動化引擎** — json-rules-engine 規則引擎，支援 12 種動作類型。
- **知識庫** — LanceDB + BM25 混合搜尋，語意 + 關鍵字雙檢索。
- **長期記憶** — 聯絡人等級的對話摘要與相似度觸發檢索。
- **行銷系統** — 活動管理、廣播排程、模板變數替換。
- **Docker 基礎設施** — PostgreSQL + Redis + MinIO + Ollama + Caddy。
