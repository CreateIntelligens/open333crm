# Changelog

All notable changes to **open333CRM** will be documented in this file.

## [Unreleased]

### Added

- **人員管理支援指派自訂角色** — 前端新增/編輯人員的角色下拉改為列出租戶所有角色（內建 + 自訂），選內建角色送 legacy `role`、選自訂角色送 `roleId`；成員清單以 `roleRef` 顯示角色名（自訂角色紫色 Badge）；並依 `agent.role.assign` 權限 gating、友善呈現 `ROLE_ESCALATION` 等錯誤。
- **Passkey / WebAuthn authentication** — 新增 Agent Passkey 憑證模型、Redis challenge 防重放、註冊/登入/撤銷 API 與嚴格 RP ID、origin、User Verification 驗證。
- **WebMCP 唯讀 CRM 工具** — 登入後的 CRM dashboard 若瀏覽器支援 WebMCP，會以目前登入 Agent 的 JWT 提供聯絡人、案件、分析與目前客服資訊查詢工具；不支援 WebMCP 的瀏覽器維持原有功能。

### Changed

- Passkey 註冊端點新增 rate limit；未設定 WebAuthn 的部署不再顯示無法使用的登入與綁定控制項。
- Passkey 綁定流程新增裝置名稱輸入與既有 credential 重新命名功能；已綁定清單顯示自訂名稱、裝置類型與備份狀態，方便辨識多個 credential。

### Fixed

- **RBAC 寫入權限退化修補（canvas / identity）（安全性）** — 延續細粒度權限 migration 的系統性疏漏排查：自動化畫布（canvas）與識別建議審核（identity）兩組路由先前僅有 module-level `authenticate`，完全未掛 `requirePermission`，使 registry 的 `canvas.use`、`identity.review` 權限點形同死碼、任何登入者皆可操作。現為 canvas 全部端點（GET 清單/詳情/analytics/executions、POST 建立/activate/trigger、PATCH 更新）補 `requirePermission('canvas.use')`，identity 全部端點（GET suggestions、POST approve/reject）補 `requirePermission('identity.review')`；registry 未定義獨立 view 權限，故讀取端點一併沿用同一 code 守門。預設 supervisor/agent 角色本就具備此兩權限，既有可用角色不受影響。
- **指派自訂角色不再無謂降級 legacy role** — 前端 `buildRolePayload` 對 custom role 固定送 `role: 'AGENT'`，會把成員原本的 legacy role（如 SUPERVISOR）覆寫成 AGENT，影響仍讀 legacy role enum 的舊功能（實際權限走 roleId 不受影響）。變更角色時改用成員當前 role 作為 legacy 回填值；並將 `Agent.role` 型別收窄為 enum union。（PR review bot 提出，經確認採納。）
- **試用信件模板未轉義使用者輸入（XSS 加固）** — trial 信件的 `{{siteName}}` 等變數來自申請時使用者自填（`siteName` 僅限長度、不限字元），原樣經 `renderTemplateBody` 字串替換進 email HTML 未轉義，可注入惡意 HTML。於 `trial-emails.ts` 的 `render()` 對所有變數值先做 HTML escape 再替換（不動共用 `renderTemplateBody`，避免影響行銷 LINE Flex 模板）。（PR review bot 提出，經確認 `siteName` 確為使用者可控故採納。）
- **新租戶儲存 BYOK Gemini key 失敗（P2025/404）** — `setTenantGeminiKey` 用 `prisma.tenantSettings.update`，但 `TenantSettings` 為延遲建立，新開通、尚未動過任何設定的租戶還沒有此列，直接呼叫 `PUT /settings/gemini-key` 會拋 P2025（回 404）導致 key 存不進去。改用 `upsert`（無列則建立、有列則更新），與本檔其他 TenantSettings 寫入一致。
- **角色指派健壯性：租戶缺系統角色時不再用 null 覆蓋既有 roleId（資料完整性）** — `resolveRoleAssignment` 走 legacy role 路徑時，若該租戶缺對應 system role，`resolveRoleId` 回 `null` 會被寫入 `agent.roleId`，使成員 `getEffectivePermissions(null)` 得空集合而被鎖在系統外（且與 legacy role 雙寫不一致）。現改為此情況直接拋 `SYSTEM_ROLE_MISSING` 錯誤（fail-loud），不再靜默用 null 覆蓋既有有效 roleId。正常 seed/provision 一定建齊三個 system role，不受影響；僅資料未正確初始化的租戶會明確報錯以利修復。
- **試用防濫用去重漏洞：Agent 檢查未正規化 email，gmail 別名可繞過（安全性）** — 試用申請的「是否已是某租戶 Agent」檢查 `emailIsAgent` 原以原始 email（僅 trim/lowercase）比對，gmail 別名（`foo.bar@gmail.com` 與 `foobar@gmail.com` 為同一 Google 帳號）被視為不同 email 而查無，讓已被平台手動開通成 Agent（從未走 trial、`TrialSignup.emailNormalized` 無紀錄）的真人得以申請到第二個試用租戶。改為以正規化值（去 gmail 點/+tag）比對：先撈同網域候選 Agent，再於應用層逐一比對正規化 email。
- **方案數值上限輸入非數字被靜默解除（資料完整性）** — 平台方案編輯頁 `setLimit` 對非純數字輸入（如 `abc`）以 `parseInt` 得到 `NaN`，經 `JSON.stringify` 後 `NaN` 序列化成 `null`，被後端誤解為「無上限」，平台管理員打錯字即可靜默解除 `maxAgents`／`monthlyTokens` 等上限。前端改為 `NaN` 時不更新該欄（維持原值），僅明確空字串／`∞` 才視為 `null`；後端 `updatePlanSchema` 的 `limits` 值改用 `z.number().int().nonnegative().nullable()` 作第二道防線，怪值一律回 422 而非靜默寫入。
- 修正月額度硬擋在解析 `keySource` 之前執行、誤擋 BYOK 租戶：`generateReply` 原先在得知 key 來源前就呼叫 `isMonthlyTokenExceeded`，導致租戶先用 platform key 累計到接近上限、之後切換成 BYOK（自備 Gemini key）仍被舊 platform 累計量擋成 `PLAN_LIMIT_EXCEEDED`。現將額度硬擋移到 `resolveGeminiKey` 解析 `keySource` 之後，且僅在 `keySource === 'platform'` 時執行，與 `incrMonthlyTokens` 只累加 platform 的設計一致（BYOK 略過額度檢查、成本租戶自付）。
- 修正月額度 Redis 計數器初始化的併發 lost-update：`getMonthlyTokens` 與 `incrMonthlyTokens` 冷 key 回填原用無條件 `SET` 覆寫，高併發下會蓋掉另一路徑已建立並累加的計數器（計數器低估、`isMonthlyTokenExceeded` fail-open 少擋）。改為原子 `SET NX + PXAT`（只在 key 不存在時寫入、保留月底過期）；`incrMonthlyTokens` 若 NX 沒搶到（別人剛建好 key，其初始值不含本次）補做一次 `incrby(tokens)`，搶到則初始值已含本次不再累加，確保各路徑本次 tokens 恰好計一次。
- **RBAC 寫入權限退化修補（安全性）** — 修正細粒度權限 migration 的系統性疏漏：知識庫、粉絲活動（portal）、行銷（marketing/material）、渠道（channel）、分析報表（analytics）等模組的一批寫入／有副作用路由，先前僅受 module-level `.view` 或群組 authenticate 保護，導致 registry 定義的 `.manage` / `.broadcast` / `.export` 等寫入權限點形同死碼、寫入保護退化為「只要能檢視即可寫入」。現為各寫入路由補上對應的 `requirePermission` per-route preHandler（建/改/刪、publish/archive/end、import/upload/embed、抽獎、點數調整補 `*.manage`；群發 send/cancel 補 `marketing.broadcast`；渠道 verify/setup-webhook/webhook-base-url 補 `channel.update`；`analytics/export` 補 `analytics.export`），GET 唯讀維持 `.view`。
- 修正月額度 Redis 計數器雙重計數：計數器冷 key（月初 / Redis 重啟 / key 過期）回填時，DB 加總已含剛寫入的本次用量，卻又額外 incrby 一次，導致付費租戶月用量灌水、`isMonthlyTokenExceeded` 在約半量時就誤擋 AI 回覆（`PLAN_LIMIT_EXCEEDED`）。回填分支改為只 set DB 值並保留月底過期，僅在 key 已存在時才 incrby。
- 平台側試用轉付費（`convertToPaid`）改 `planId` 後未失效方案快取，導致 RBAC guard 在 60 秒內仍沿用舊試用天花板、誤將剛付費租戶的新功能擋成 403；現改方案後一併失效權限天花板與租戶 plan 快取（比照升級審核路徑）。
- **自訂角色可經 API 指派給成員** — `POST /agents` 與 `PATCH /agents/:id/role` 新增 optional `roleId`（uuid）欄位，與 legacy `role` enum 並存（提供 `roleId` 時以其為準）；roleId 經 `loadTenantRole` 驗證屬同租戶（跨租戶回 404），並依角色 slug 反填 legacy `role`（system role 對映 enum、custom role 沿用既有值）。修正先前前端建立的自訂角色無法指派給任何成員（只能改 DB）的缺陷。
- **角色指派越權防護（安全性）** — 指派角色時比對指派者角色的有效權限集合，若目標角色含指派者本身沒有的權限即擋下（`ROLE_ESCALATION` 403），取代舊有僅擋「SUPERVISOR 指派 ADMIN」的 inline 硬規則；admin system role 指派者不受限。同時 `PATCH /agents/:id/role` 的權限碼由誤用的 `agent.manage` 改為專用的 `agent.role.assign`（`agent.manage` 保留給建立/編輯成員）。
- 修正一般專員（AGENT）開「我的績效」頁被 403：`GET /analytics/my` 原受 module-level `requirePermission('analytics.view')` 攔截，但預設 AGENT 只有 `analytics.view.self`（`analytics.view` 為 SUPERVISOR 以上），導致個人數據頁打不開、`analytics.view.self` 形同死碼。新增 `requireAnyPermission` guard，module-level 改為 `analytics.view` 或 `analytics.view.self` 任一即放行，其餘完整報表路由（overview/message-trend/cases/agents/channels/contacts/csat）各自補回 per-route `requirePermission('analytics.view')` 嚴格把關，確保只有 `view.self` 的 AGENT 僅能看 `/my`、打不到其他 analytics 端點。
- **降權延遲視窗修補（安全性）** — `POST /auth/refresh` 先前原封沿用舊 refresh token 內的 `roleId`／`role` 重簽 access token，導致管理員降權某成員後，該成員可靠 refresh 續命舊角色達 refresh token TTL（可能 30 天）。現改為 refresh 時從 DB 重讀該成員當前 `role`／`roleId`（帶 `tenantId` 且要求 `isActive`、租戶亦須啟用），停用者不再核發新 token。
- **角色權限矩陣切換角色載入失敗造成跨角色權限污染（資料完整性）** — `RolePermissionMatrix` 逐角色載入權限的 `api.get('/roles/:id/permissions')` 只有 `.then` 沒有 `.catch`，網路瞬斷或 403 時失敗完全靜默，draft/baseline 仍留著「上一個角色」的權限，使用者以為在編輯新角色、按下儲存會把新角色權限覆寫成錯的集合。現補上 `.catch`：載入失敗時清空 draft/baseline、設 `permLoadError` 旗標停用儲存與編輯、顯示明確錯誤與「重試」按鈕，並以 `finally` 收尾載入狀態。

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

- **MCP 權限與開發環境 Origin** — `/mcp` 僅接受具 `mcp:read` scope 的 CLI token；開發環境未設定 allowed origins 時保留本機同源/localhost MCP 存取。
- **Webhook identity 併發競態** — stitched contact 建立 `channelIdentity` 遇到 P2002 時改用並發請求已建立的 identity，並以 `isArchived` 保留孤兒 contact 的 soft-delete 語意。
- **Passkey 管理端點防護** — passkey rename 與 revoke endpoint 補上 rate limit。
- **Webhook verify token 隨機性** — Channel 編輯表單改用 `crypto.randomUUID()` 產生 Meta webhook verify token。
- **MCP Prisma 型別來源** — MCP server 改由 `@open333crm/database` 提供 PrismaClient 型別。

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
