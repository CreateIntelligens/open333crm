## Context

短連結模組已有一套策略導向的 redirect 架構：根據 User-Agent 分類，回傳不同的 HTML 微頁面（BOT → OG meta、EXTERNAL_BROWSER → sendBeacon + JS redirect、LINE_WEBVIEW → LIFF redirect）。點擊數據記錄在 `click_logs` 表，透過 `POST /s/track` 唯一入口寫入。

目前没有任何外部追蹤服務的整合。行銷團隊需要把短連結流量數據同步到 GA4 和 Meta Business Suite，以進行全通路轉換分析和再行銷。

現有的 `TenantSettings` 表是租戶級設定的標準存放位置，已有 office hours、chat LLM、embedding 等設定先例。

## Goals / Non-Goals

**Goals:**

- 讓管理員在後台設定 GA4 Measurement ID 和 Meta Pixel ID
- 短連結 redirect 微頁面根據租戶設定動態注入對應的追蹤腳本
- BOT 爬蟲不注入追蹤（不執行 JS，加了沒用）
- 追蹤腳本在 sendBeacon 之後、location.replace 之前執行

**Non-Goals:**

- 不做連結層級的追蹤覆蓋（本次只做租戶層級）
- 不做 LINE Login SDK 追蹤（LIFF 整合已有 lineUid 解析）
- 不做 GDPR consent 機制（後續獨立處理）
- 不做 GA4 事件追蹤（只做初始化 config + pageview）
- 不做服務端 GA4 Measurement Protocol（只做客户端 gtag.js）

## Decisions

### 1. 追蹤 ID 存在 `TenantSettings` 表，不另建新表

**選擇**: 在 `tenant_settings` 表新增 `gaId` 和 `metaPixelId` 欄位。

**理由**:

- 符合現有模式——所有租戶設定都在同一張表（officeHours、chatProvider 等都是欄位）
- 不需要新的 migration 複雜度
- 避免 N+1 查詢（\_settings 已經是 lazy init + cache 友好）

**替代方案**: 新建 `tenant_tracking_settings` 表 → 過度設計，目前只有 2-3 個欄位。

### 2. API 端點復用 settings 模式

**選擇**: `GET/PUT /api/v1/settings/tracking`，與現有的 office-hours、chat 等端點同級。

**理由**:

- 一致的 API 風格
- 已有 `requireSupervisor()` guard
- 響應格式遵循 `success()` wrapper

### 3. 前端用 tab 分頁，不開新路由

**選擇**: 在 `/dashboard/settings` 的 tab 列表新增「追蹤設定」分頁。

**理由**:

- 與現有 settings 頁面的 tab 模式一致
- 不需要改路由結構
- 使用相同的 `useState` + `api.get/put` 模式

### 4. 追蹤腳本注入在 strategy 層，不改 service 層

**選擇**: 修改 `external-browser.strategy.ts` 和 `line-webview.strategy.ts` 的 HTML 輸出，加入追蹤腳本。

**理由**:

- Strategy 本身就是負責產生 HTML 微頁面的層
- 不影響 `trackClick()` 的核心邏輯
- BOT 策略自然排除（不產生 JS）

**注入位置**: sendBeacon 之後、location.replace 之前，確保 GA/Pixel 有時間初始化和記錄 pageview。

### 5. 追蹤腳本用 template literal 注入，不做 DOM 動態載入

**選擇**: 直接在 HTML 字串中嵌入 `<script>` 標籤。

**理由**:

- 微頁面本身就是一次性 HTML，不需要 script 動態載入的複雜度
- 減少 HTTP 請求（gtag.js 是 async 外部 script，但 config inline）
- 更可預測的執行順序

## Risks / Trade-offs

- **[追蹤阻塞跳轉]** → GA/Meta Pixel script 是 async，不阻塞。但 network 慢時可能延遲跳轉 → 可接受，因為 micro-page 本身就在 redirect 路徑上
- **[GDPR 風險]** → GA/Meta Pixel 設定 cookie 可能需要 consent → 本次不做，留後續處理
- **[GA ID 格式驗證]** → 使用者可能輸入舊版 UA- 格式 → 只做基本非空驗證，不驗格式（Google 自己會報錯）
- **[欄位 nullable]** → gaId 和 metaPixelId 皆為 nullable，不影響現有資料
