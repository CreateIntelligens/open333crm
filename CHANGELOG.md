# Changelog

All notable changes to **open333CRM** will be documented in this file.

## [2026-09-02]

### Fixed

- **AI route merge syntax** — 修正最新分支同步時 `/api/v1/ai/rewrite` 路由缺少結束括號，避免 API TypeScript 編譯失敗。
- **Cloudflare security audit findings** — 修正 authenticated Socket.IO 任意 room 訂閱越權；visitor socket 改為只接受 server-issued Chatbox session/claim；legacy WebChat visitor-token session route 改為安全停用/遷移路徑，message/media 加入 secure contract、3 天 session 上限、payload/檔案/IP/session/channel 限流；`xlsx` 替換為 `@e965/xlsx`，並更新 Engine.IO、Socket.IO parser、sharp、PostCSS 等 production-reachable 依賴。
- **Socket 訂閱限流與 RLS CI 修正** — 訂閱/取消訂閱限制改為每條連線每 60 秒 rolling window；Socket plugin 的 `prismaAdmin` 使用補上明確租戶/資源授權白名單，通過 strict RLS 白名單檢查。

## [2026-08-28]

### Security

- **UAT 對外暴露面收斂（docs/27 S0 / P1）** — `docker-compose.yml` 所有服務 port 發布改綁 `127.0.0.1`（postgres 5433 / redis 6380 / ollama 11434 / minio 9000-9001 / api 3001 / web 3000 / caddy 8888），對外流量一律走主機 nginx（80/443）；caddy 直接寫 `127.0.0.1:8888:80`，deploy.yml 原 sed 改埠步驟自然失效（no-op）。搭配 AWS Security Group 只留 22/80/443 為雙保險。主機側另已清除 `/tmp` 含密碼的 env 備份、啟用 fail2ban（sshd jail）。

### Added

- **平台租戶詳細頁（點租戶往下鑽 + 編輯）** — 平台後台租戶管理的租戶名稱改為可點擊，進入 `/admin/tenants/[id]` 詳細頁：資料量統計（客服/渠道/聯絡人/對話/案件）、基本資料編輯（站台名稱、方案切換——方案變更即時失效權限天花板與租戶方案快取，比照 convertToPaid）、啟用/停用、合約期間編輯、成員清單（姓名/Email/角色/狀態）＋成員操作：**修改成員 Email**（即登入帳號，全域唯一衝突回 409）與**重寄開通信**（複用手動開通信模板，不含密碼）。新端點 `GET /platform/tenants/:id`、`PATCH /platform/tenants/:id`、`PATCH /platform/tenants/:id/agents/:agentId`、`POST /platform/tenants/:id/agents/:agentId/resend-welcome`（zod 驗證、寫 PlatformAuditLog）。
- **平台手動開通租戶寄開通信 + 顯示登入網址** — 補上手動開通後「不知道要去哪登入」的斷點：`provisionTenantViaApi` 開通成功後比照 trial 自動寄開通信給管理員 Email（新模板 `sendManualProvisionedEmail`，帶 `${WEB_BASE_URL}/login` 登入按鈕；**不帶密碼**——密碼由開通人員設定，信中註明請洽開通人員並建議登入後改密碼；fire-and-forget 寄信失敗不影響開通）；API 回傳加 `loginUrl`，平台後台開通成功訊息同步顯示登入網址與「已寄信／密碼請自行轉交」提示。

- **LINE 素材可點擊 action 點擊後貼標（點連結自動貼標的全面化）** — 把「短連結被點擊→貼標」擴大到 LINE 素材裡**所有可點擊處**（carousel 按鈕/endPage CTA、flex button、quick reply、imagemap 區域、video endCard）。使用者在素材編輯器每個 action 選一個標籤（來源設定/標籤管理的 CONTACT-scope 標籤），點了就對聯絡人貼標，並自動發 `contact.tagged`→既有自動化訂閱可據以分眾（零額外接線）。兩條路徑、貼標核心完全複用既有：**(1) postback 型**（按鈕/carousel/flex button/quick reply）——選標籤即把 action data 設 `tag:<tagId>`，webhook 新增 `handleTagOnClick` 攔截器（`inbound-postback-interceptors.ts`）收到就 `addTagToTarget(CONTACT, addedBy:system)`，不短路（貼完仍走 CSAT/KB/handoff 與正常訊息流程），標籤不存在/scope 不符/缺 contactId 皆靜默略過不中斷。**(2) uri 型**——選標籤寫進 `action.tagOnClick`，廣播送出時 `convertBodyUrlsToShortLinks` 把 tagId 灌進該 uri 的素材短連結（`findOrCreateMaterialShortLink` 帶入），沿用既有 `trackClick` 貼標；tagOnClick 是內部欄位，送出前 delete 掉不進 LINE payload。前端 `ActionConfigEditor`（carousel/imagemap/flex 共用）加「點擊後貼標」下拉（`useContactTags` hook SWR 快取、只列 CONTACT-scope），postback 選標籤附「接管回傳資料」提示、開啟時從 data 反解還原；message 型（含 imagemap message area）不提供貼標。端到端實測：模擬 LINE postback(正確 HMAC 簽章)→ 聯絡人被貼標(0→1, addedBy=system)、冪等(重複點仍 1)、無效標籤 webhook 仍 200 靜默略過。OpenSpec change `material-action-tagging`。
- **AI 描述生成 Flex 草稿 + AI 潤稿（差異化：一句話產出設計卡）** — Flex 素材（`line_flex_showcase`）新增兩個 AI 能力，接續填空編輯器（階段 1）：**(1) 一句話生成** — 起手空狀態加「✦ 用 AI 描述生成」入口，使用者描述想要的卡片 → 後端 `generateFlexFromPrompt` 組「只輸出合法 LINE Flex bubble JSON + few-shot」系統提示走既有 `llm.service.generateReply`（token 額度硬擋 / 累加 / provider 選擇皆自動生效，不重複包）→ `extractJsonObject` 容錯解析（去 markdown 圍欄、抓 `{…}` 區塊、失敗退階）→ 經既有 `validateLineFlexDraft`（實打 LINE API）驗證，不合法把錯誤餵回 AI 重試一次、再不行回 422 `FLEX_AI_GENERATE_FAILED` 建議改用範本（不硬塞壞 JSON 進編輯器）；產出以 `{ contents, altText, source:'ai' }` 載入**同一個填空編輯器**微調（extractFields 一樣掃出業務分組欄位），範本資訊卡對 AI 來源顯示「AI 生成草稿」。**(2) AI 潤稿** — 填空編輯器 text 類欄位（文字/按鈕文字/按鈕訊息）加「✦ 潤稿」鈕 → 下拉潤飾/縮短/換語氣 → `POST /ai/rewrite`（gemini 等失敗包成 422 `AI_REWRITE_FAILED` 不裸 500），潤稿後更新欄位 + 即時預覽，失敗靜默略過不阻斷編輯。附帶把 showcase 預設 body 改空，讓起手一律進「AI 生成 / 選範本」空狀態。端點：`POST /api/v1/marketing/materials/line-flex/ai-generate`（guard `marketing.manage`、prompt zod min(1)/max(500)）、`POST /api/v1/ai/rewrite`。驗證：後端鏈路 / 路由 / schema 邊界 / 錯誤傳播 curl 實測通過；前端空狀態入口與失敗提示瀏覽器實測；happy path 生成端以 ollama qwen2.5:3b 補驗（AI 產出結構完整合法 Flex、通過本機結構驗證）。無 AI key 時採「樂觀啟用 + 失敗友善提示」不擋範本主線。OpenSpec change `flex-ai-generate`。
- **Flex 範本填空編輯器分組 UI（零程式套用官方設計）** — 「精選範本」（`line_flex_showcase`）的編輯器從「平鋪所有可編輯欄位」升級為「依業務區塊分組填空」，讓非工程人員能像填表般套用官方 Flex 設計、不必理解 box/contents 樹狀結構。(1) `flex-fields.ts` extractFields 為每個掃出的欄位加 `group`（`FlexFieldGroup`：主圖 / 標題與內文 / 按鈕 / 其他），依位置與 kind 推斷（image/icon→主圖、text→標題與內文、button_*→按鈕），並預留 sample.slots 覆寫接口供後續更精準分組；(2) `LineFlexShowcaseEditor` 把欄位裝進業務卡片（帶區塊圖示 header），只顯示有欄位的區塊，欄位標籤用業務語彙（圖片/小圖示/文字/按鈕文字…）取代 JSON path；(3) 技術性的「新增 / 刪除元件」結構操作收進 `⚙ 進階` 摺疊區（`<details>`，預設收合），多數填空使用者不需動結構；(4) 填空即時反映右側手機預覽（沿用既有 renderer），存素材 body 結構（sampleId/contents/altText）不變、通過既有 line-flex validate。端到端實測：餐廳範本欄位正確分組（主圖/標題與內文）、改標題預覽即時更新、進階區容器編輯可展開。OpenSpec change `flex-template-fill`。
- **Rich Menu 分眾綁定（不同受眾看不同圖文選單）** — 台灣 LINE 平台入場券之一。現況零件其實都在（publish 流程完整、channel-plugin bulk-link 已自動每 500 分批），唯缺「把 Rich Menu 綁到分眾」的業務邏輯。補：(1) `resolveAudienceLineUids`——受眾（Segment 走 `calculateSegmentContacts`、或 tag 直接篩 contactTag）→ contactIds → `ChannelIdentity`（channelType LINE + 同 channel）取 uid 去重；(2) `bindRichMenuToAudience` / `unbindRichMenuFromAudience`——檢查 menu 為 published + 有 lineRichMenuId（draft/error 擋「請先發布」），解析 uid 入背景 queue `rich-menu-bind`，立即回 `{ queued: N }`；(3) worker handler 取 channel 憑證 → `plugin.extensions.ui.linkMenuToUsers/unlinkMenuFromUsers`（走背景因受眾大 + LINE bulk-link 有 rate limit）；(4) route `POST /line/rich-menus/:id/{bind,unbind}-audience`（沿用 `richmenu.manage` guard）；(5) 前端已發布 menu 卡片加「綁定受眾」按鈕 + `RichMenuBindDialog`（選分群 → 送出，顯示已綁定人數）。租戶隔離由 contactIds（經 tenantId 篩）+ 本租戶 menu 的 channelId 保證。全體 default 與分眾綁定並存（LINE 規則：per-user 綁定優先於 all-default）。4 項 worker 單元測通過。OpenSpec change `rich-menu-audience-targeting`。
- **素材級點擊歸因（差異化定位「證明哪則訊息有效」）** — 打通「素材 → 短連結 → 點擊 → 歸因回素材」鏈路，讓成效歸因到單則素材（競品只做到按鈕級）。現況原本斷兩處：`ShortLink` 無 `materialId`、且廣播發送完全不經短連結（URL 直發原網址、無點擊可追）。修復：(1) `ShortLink` 加 `materialId`（nullable 外鍵，onDelete SetNull，素材刪除保留短連結與點擊歷史）+ Material 反向關聯；(2) 廣播發送時 `executeBroadcast` 自動把素材 body 內的外部連結（遞迴找 `{type:'uri'}` 與 imagemap `linkUri`，涵蓋所有版型與 Flex）換成帶 materialId 的短連結——素材層共用一條（非 per-recipient）、同素材同 URL 複用既有（`findOrCreateMaterialShortLink`，避免短連結表膨脹）、已是本站短連結不二次包裝；(3) `getMaterialStats` 加點擊數（經 `ShortLink.materialId` 聚合 totalClicks）與點擊率（點擊數 ÷ 使用次數），無短連結歸因資料或未送出時回 null（不假造 0）；(4) 素材詳情頁「素材成效」面板顯示使用次數/點擊數/點擊率/回覆數/開案數，點擊率標「基於廣播發送」。端到端實測：點擊率 12/50=24% 正確、無資料回 null、前端面板正常渲染。OpenSpec change `material-click-attribution`。
- **短連結點擊 → 自動貼標的正規自動化路徑** — 打通「短連結被點擊 → 自動化規則 → 對聯絡人加標籤」這條之前斷掉的鏈路，讓行銷人能在自動化 UI 用「短連結被點擊」當觸發、對點擊者做多種動作（不只硬綁一個 tag）。修復兩處斷點：(1) `automation-engine` 註冊 `link.clicked` 為合法觸發事件（events.ts 加 LINK_CLICKED，category contact、provides contactScopes，合約驗證放行、UI 觸發器下拉自動列出）；(2) worker 動作執行器（`apps/workers/.../automation-actions.ts`）新增 `add_tag` 動作——依 `tagId` 或 `tagName`（找不到則同租戶建立）解析標籤、驗租戶隔離、冪等貼 `contactTag`（addedBy `automation`），缺 contactId/tagId 安全跳過不報錯。`link.clicked` 事件 facts 補 `shortLinkId` / `slug`，規則可判斷點的是哪一條連結。既有 `ShortLink.tagOnClick` 直接路徑保留，兩路徑並存靠 add_tag 冪等防重複。執行路徑：點擊 → link.clicked eventBus → enqueue automation queue → worker `executeWorkerAutomationActions`。5 項單元測試通過（貼標/冪等/缺 contact skip/跨租戶擋/依名稱建立）。OpenSpec change `line-material-basics-and-click-tag`。
- **素材庫治理：分類 / 標籤 / 版本 / 素材級成效** — 素材庫從「表單式單渠道 CRUD」補上治理面（對標競品研究：版本與素材級成效為業界普遍空白）。(1) **巢狀分類**：新增 `MaterialCategory`（tenant-scoped、parentId 自我關聯），列表頁左側分類樹（含每分類素材數）可篩選；分類管理 dialog 可新增 / 改名 / 搬移（後端擋自我循環 CATEGORY_CYCLE）/ 刪除（其下素材 categoryId 由 FK SET NULL 歸「未分類」，不刪素材）；Material 加 `categoryId`，保留舊 `category` 字串過渡。(2) **標籤**：Material 加 `tags[]`，列表頁標籤 chips 篩選（hasSome），`GET /materials/tags` 即時聚合租戶 distinct 標籤（無標籤表）。(3) **複合篩選 + 排序**：列表 `GET /materials` 支援 categoryId / tags / status / channelType / 關鍵字組合 + `sort`（最近使用[nulls last] / 使用次數 / 更新時間 / 名稱）；篩選中膠囊列可逐一移除。(4) **版本控制**：新增 `MaterialVersion`（versionNo 遞增快照），create / update（name 或 body 變動時）寫快照；`GET /materials/:id/versions` 檢視、`POST /materials/:id/versions/:no/restore` 還原（寫回舊內容並產生新版，線性歷史不破壞）；編輯頁時間軸版本歷史面板 + 還原。(5) **素材級成效**：`GET /materials/:id/stats` 由 `BroadcastRecipient` 歸因回覆數 / 開案數，列表使用率長條以租戶內 `maxUsageCount` 正規化 + 顯示既有 `lastUsedAt`（相對時間，null 顯示「—」）；點擊率無短連結歸因資料時回 null（UI 顯示「暫無資料」，不假造 0）。(6) **顯示狀態**：Material 加 `status`（draft / approved 手動切，送審核准狀態機另開 change）。兩張新表納入 Postgres RLS（NULLIF fail-closed policy），實測跨租戶隔離通過。OpenSpec change `improve-material-library-governance`。
- **LINE SafeReply Push Fallback** — LINE 回覆若在原始 webhook 後 30 秒內且仍有有效 `replyToken` 才使用 reply API；Agent 研究、KB 自動回覆或 keyword automation 超過安全窗口時自動改用 push，reply API 明確失敗時再補一次 push。原始 receipt timestamp／replyToken 已貫通 API 與 worker delivery，非 LINE 渠道維持原行為。

- **Agentic LLM 工具循環** — 新增可選啟用的 tenant-scoped Agent runner，支援 Ollama/Gemini tool calling，最多 100 輪並具備總時間、工具數、token、重複呼叫與月額度保護；提供 `search_web`、`read_web_page`、`get_live_weather` 與受權限控管的 `publish_wiki_report`。網頁搜尋／閱讀依序使用 `https://2md.aiurl.tw/`、`https://2md.glsoft.ai/`、`https://create360.ai`；Wiki 回覆只暴露公開 `shareUrl`。Agent 執行 trace、工具紀錄與報告狀態租戶隔離，暫存資料建立後 3 天清理，正式 CRM 對話與已發布 Wiki 內容保留；Agent 失敗時回退既有 KB 自動回覆。預設 `AGENTIC_LLM_ENABLED=false`，需設定相關環境變數後啟用。

- **試用租戶保留期屆滿軟刪 + 復原** — 平台試用政策的「到期後資料保留天數」(trial.dataRetentionDays)先前只儲存不生效，本次落實：trial scheduler 加軟刪分支，掃已停用(isActive=false)且 trialEndsAt 距今超過 dataRetentionDays 天且 purgedAt=null 的試用租戶，設 Tenant.purgedAt=now(標記，不真刪 DB、可復原)+寫稽核 tenant.trial.purge；保留期基準用 trialEndsAt。平台後台 restorePurgedTenant + PATCH /platform/tenants/:id/restore 可復原(清 purgedAt，不動 isActive)；試用管理頁顯示「已清除」狀態 + 復原按鈕。軟刪租戶因 isActive=false 沿用既有 TENANT_DISABLED 擋登入。Tenant 加 purgedAt(nullable migration 非破壞性)。
- **Postgres RLS 租戶隔離（DB 層強制）** — 多租戶隔離從純 app-layer（每 query where tenantId）強化為 **Postgres Row-Level Security**。機制：`app_tenant`（NOBYPASSRLS）連線 + 每個租戶操作於**交易內 `set_config('app.current_tenant', tid, is_local=true)`**（`lib/tenant-db.ts` 的 `withTenant` / `tenantScopedClient` $extends 自動綁定，含 raw query 覆寫），連線歸還池不殘留；白名單（平台/認證/scheduler/OAuth 回調）走 `app_admin`（BYPASSRLS）連線。policy 用 `NULLIF(current_setting(...),'')::uuid` 防未設定時空字串轉型錯（fail-closed）。涵蓋：core 表（contacts/conversations/cases + messages 用 conversationId subquery）、40 個有 tenantId 的租戶表（標準 policy）、23 個無 tenantId 子表（靠外鍵父表 subquery policy）。所有 route 接線：租戶→`request.tenantPrisma`、白名單/平台→`prismaAdmin`、交易 service→`withTenant`、公開端點(webhook)/跨模組(ai/mcp)→保留。實測跨租戶隔離/fail-closed/WITH CHECK 防越權寫入/子表關聯皆通過。**部署注意**：需設 `DATABASE_URL_TENANT`/`DATABASE_URL_ADMIN`（未設 fallback 現況 URL，RLS 未 FORCE 時行為不變）+ 建 app_tenant/app_admin role 密碼；軟回滾＝受約束連線暫切 admin（改 env 重啟，app-layer 仍在不裸奔）。機制與陷阱詳見 skill `postgres-rls-tenant-isolation`。
- **AI 用量告警（80%／100%）** — 租戶 AI token 月額度用量**剛跨越 80%（warning）與 100%（critical）**門檻時，發**站內通知 + email** 給該租戶所有 ADMIN。偵測掛在 `incrMonthlyTokens` 累加後（比較累加前後是否跨越門檻，單次巨量可同時觸發兩級不漏），冪等以 Redis 旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`（SET NX + 月底過期，跨月自動重置）確保每租戶每月每級僅一次。發送走 eventBus `usage.quota.threshold` → notification worker（複用既有 `notification:dispatch`）+ email（`usage-alert-emails.ts`，warning 琥珀／critical 紅，critical 說明 AI 自動回覆暫停、真人不受影響）。僅 `keySource='platform'` 且有 `monthlyTokens` 上限者觸發（BYOK／無上限不告警），全程 fire-and-forget 不阻塞回覆、不影響既有 `PLAN_LIMIT_EXCEEDED` 硬擋；env `USAGE_QUOTA_ALERTS_ENABLED=0` 可灰度停用。
- **租戶操作稽核日誌（TenantAuditLog）** — 新增租戶層操作稽核（有別於平台方看的 `PlatformAuditLog`），記錄租戶內敏感操作：系統設定變更（`settings.update`）、成員與角色權限變更（`agent.create`/`agent.role.assign`/`agent.password.reset`/`agent.delete`/`role.permission.update`）、聯絡人合併（`contact.merge`）、案件刪除（`case.delete`）、渠道建立/刪除（`channel.create`/`channel.delete`）。稽核於 route handler 主操作成功後以 `writeTenantAudit`（非阻斷，失敗只 log）寫入，payload 僅存非 PII 摘要。租戶 ADMIN 可經 `GET /api/v1/tenant/audit-logs`（需 `audit.view` 權限）分頁查詢並依 action/actor/日期篩選，一律 tenantId scoped。新增 `audit.view`/`data.export`/`data.erase` 三個權限點（feature core，預設只給 ADMIN）。
- **GDPR 資料匯出（可攜權，Art.20）** — 租戶可匯出自己的資料（聯絡人/對話/訊息/案件及附屬），非同步走 BullMQ `data-export` worker：cursor 分頁逐表撈本租戶資料 → 產 JSON（保關聯）+ CSV → 打包 zip（自實作 store 模式 ZIP，免第三方依賴）→ 上傳 MinIO（`export/{tenantId}/{requestId}.zip`）→ 站內通知發起者。API：`POST /api/v1/tenant/data-export`（建請求）、`GET /:id`（查狀態）、`GET /:id/download`（驗 completed + 未過期 + 同租戶，產 15 分鐘短時效下載連結、downloadCount++），皆需 `data.export` 權限。檔案預設保留 7 天，由 `data-export-cleanup` repeatable worker 到期標記 expired 並刪 MinIO 物件。
- **GDPR 資料刪除（被遺忘權，Art.17）** — 新增聯絡人粒度的資料刪除功能，兩種模式：(1) **anonymize（匿名化，預設）** — 抹去 `Contact` 的 PII 欄位（`displayName`→佔位、`avatarUrl`/`phone`/`email`→null）、刪除可識別子資料（`ContactAttribute`/`ChannelIdentity`/`IdentityMap`/`LongTermMemory`）、將該聯絡人所屬對話的 inbound 訊息 `content` 改為 redacted 佔位，但保留 `Conversation`/`Case`/`Message` 統計骨架不刪（報表數字不變）。(2) **hard_delete（硬刪）** — 於 transaction 內先算 affected 計數再連鎖刪除：`Conversation`（cascade 帶走 `Message`/`ConversationTag`/`ChatboxSession`）、`Case`（cascade 帶走 `CaseEvent`/`CaseNote`/`CaseTag`/`CaseRelation`）、`PortalSubmission`、`PointTransaction`，最後刪 `Contact`（cascade 帶走 `ContactAttribute`/`ChannelIdentity`/`IdentityMap`/`LongTermMemory`/`ContactTag`/`ContactRelation`），並刪除對應的 MinIO 媒體附件。API：`POST /api/v1/tenant/data-erasure`（建立請求）、`GET /api/v1/tenant/data-erasure/:id`（查狀態），皆需 `data.erase` 權限並先驗目標聯絡人同租戶（跨租戶回 404）。刪除非同步走 BullMQ `data-erasure` worker，只影響目標 contactId；完成後寫 `DataErasureRequest.status`/`affected` 並記租戶稽核（`data.erasure.request`/`data.erasure.complete`，payload 只含 contactId/mode/affected 計數，絕不含 PII）、通知發起者。
- **方案細粒度分級（功能點 deny／渠道數量／渠道 provider 白名單）** — 平台後台「方案與上限」頁擴充三塊管控，全部即時生效、對既有無方案租戶零影響：(1) **功能點細分** — 每個已勾選功能可展開列出其權限點，逐點取消勾選＝`deny`，`Plan.permissionOverrides { deny: string[] }`；有效天花板＝`permsForFeatures(features)` 減去 deny（deny 高階不連坐低階，如 deny `channel.create` 仍保留 `channel.view`）；改動會失效該方案所有租戶的權限快取。(2) **渠道數量上限** — 新增 `maxChannels` 數值上限，`channel.service.createChannel` 建立時 count 硬擋（達上限 `PLAN_LIMIT_EXCEEDED` 403），只算 isActive、比照 `maxAgents`。(3) **渠道 provider 白名單** — `Plan.allowedChannelTypes`（ChannelType[]），非空且欲建類型不在內即 `CHANNEL_TYPE_NOT_ALLOWED` 403；空陣列＝不限制、只擋新建不影響既有渠道。route schema 以 Prisma ChannelType enum 與 core `PERMISSION_CODES` 驗證輸入合法。兩個新 Plan 欄位皆 migration 非破壞性（有 default）。
- **平台方案設定功能清單動態化（可擴展性）** — 平台後台「方案與上限」頁的功能清單先前寫死於前端，後端新增 feature/權限點不會自動反映。改為由後端 `GET /platform/registry` 動態提供（單一資料源＝`@open333crm/core` 的 FEATURES + permissions registry + ChannelType）：`FEATURES` 加 `desc` 欄位、新增 `buildPlatformRegistry()`；前端方案頁改動態載入。未來於 core 新增功能即自動出現在方案設定，無需改前端。
- **平台層租戶合約日期記錄** — 平台後台租戶管理頁可為每個租戶設定與查看合約起訖日（`contractStartDate` / `contractEndDate`），純記錄供平台方管理，不觸發任何自動生命週期行為（與 `trialEndsAt` 的到期自動停用明確區隔）；受平台 superuser 認證保護、變更寫 PlatformAuditLog；迄日不可早於起日（422）。`Tenant` 加兩個 nullable 欄位（migration 非破壞性、對既有租戶零影響）。
- **租戶隔離 CI 檢查（`scripts/check-tenant-scoping.mjs`）** — 靜態掃描所有對 41 個「含 tenantId 欄位」租戶表的 Prisma query，抓出 where 完全未帶 tenantId 的跨租戶洩漏風險；排除平台層/scheduler/認證入口等合法跨租戶查詢，where 為變數時往上追其定義。`--strict` 模式在偵測到疑似漏帶時 exit 1，已接入 CI（Build 後）作回歸防護。目前 codebase 掃描結果 0 洩漏。
- **人員管理支援指派自訂角色** — 前端新增/編輯人員的角色下拉改為列出租戶所有角色（內建 + 自訂），選內建角色送 legacy `role`、選自訂角色送 `roleId`；成員清單以 `roleRef` 顯示角色名（自訂角色紫色 Badge）；並依 `agent.role.assign` 權限 gating、友善呈現 `ROLE_ESCALATION` 等錯誤。
- **Passkey / WebAuthn authentication** — 新增 Agent Passkey 憑證模型、Redis challenge 防重放、註冊/登入/撤銷 API 與嚴格 RP ID、origin、User Verification 驗證。
- **WebMCP 唯讀 CRM 工具** — 登入後的 CRM dashboard 若瀏覽器支援 WebMCP，會以目前登入 Agent 的 JWT 提供聯絡人、案件、分析與目前客服資訊查詢工具；不支援 WebMCP 的瀏覽器維持原有功能。

### Changed

- Passkey 註冊端點新增 rate limit；未設定 WebAuthn 的部署不再顯示無法使用的登入與綁定控制項。
- Passkey 綁定流程新增裝置名稱輸入與既有 credential 重新命名功能；已綁定清單顯示自訂名稱、裝置類型與備份狀態，方便辨識多個 credential。

### Fixed

- **AI Chat 健康檢查誤報「GEMINI_API_KEY is not configured」（未走 BYOK three-tier fallback）** — 租戶已在後台自填 BYOK Gemini key，但「重新檢測 / 狀態」仍誤報 provider 異常。根因：健康檢查鏈路（`GET /settings/chat`、`POST /settings/chat/health`）呼叫 `checkChatHealth` 時**沒把租戶 key 傳進去**，`gemini.provider.health()` 只讀全域 env `GEMINI_API_KEY`；環境未設該 env（如 UAT）時即回「not configured」，與實際發訊息走 `resolveGeminiKey`（租戶自填 → 平台 → env）的三層 fallback 行為不一致。修復：`ChatProvider.health` 介面加 `apiKey?`，`gemini.provider.health` 改用 `getApiKey(apiKeyOverride)` 優先吃傳入的租戶 key，`checkChatHealth` 加 `apiKey` 參數轉傳，兩個 route 呼叫端在 provider 為 gemini 時先 `resolveGeminiKey` 取租戶 BYOK key 再傳入（ollama 不受影響）。修好後健康檢查與發訊息用同一把 key，如實反映 key 可用性。本機端到端實測：設租戶假 BYOK key → health 回 `Gemini API 400: API key not valid`（證明用了租戶 key 而非 env）、error 隨 BYOK key 變化。

- **貼標寫入路徑統一 + 補發 `contact.tagged` + 迴圈防護** — 修架構檢視發現的事件鏈斷點：先前貼標散落三處，只有人工貼標（`tagging.service.addTagToTarget`）會發 `contact.tagged`，短連結點擊貼標與自動化 `add_tag` 都繞過、不發事件，導致「以貼標為觸發」的下游自動化不會被這兩條路徑喚起。修復：(1) `addTagToTarget` 加 `addedBy`（'agent'|'system'|'automation'，預設 agent）、agentId 改選填，`contact.tagged` payload 帶 `source`；(2) `shortlink.trackClick` 點擊貼標收斂到 `addTagToTarget`（消除重複的 find→create，補發事件，source 'system'）；(3) worker `add_tag` 因跨 process 無法 import api service，改 `contactTag.upsert` 冪等貼標 + 透過新增的 redis `domain:event` 橋（`socket.plugin` 端 subscriber 轉成 in-process eventBus）發 `contact.tagged`（source 'automation'）；(4) **迴圈防護**：automation.worker 的 `contact.tagged` subscriber 對 source==='automation' 不再觸發評估，斷開「貼標→規則→又貼標」自我循環（人工/點擊貼標仍可觸發）。**⚠️ 行為變更**：短連結點擊貼標現在會發 `contact.tagged`，可能觸發既有的 contact.tagged 自動化規則（此為修復目的，部署前確認既有租戶無非預期規則）。OpenSpec change `unify-tagging-write-path`。
- **LINE imagemap 動作不再默默降級 postback** — LINE imagemap 官方僅支援 uri/message 動作，原本編輯器讓使用者選 postback、發送時才默默降級成 message。`ActionConfigEditor` 加 `allowedTypes` 白名單，imagemap 編輯器改傳 `['uri','message']`，從源頭不給選 postback，避免使用者誤設。
- **RLS 上線後 migration 全炸修補（部署阻斷，重要）** — Postgres RLS 啟用後 app runtime 的 `DATABASE_URL` 指向受 RLS 的 `app_tenant`（NOBYPASSRLS、非 table owner）。entrypoint 的 `prisma migrate deploy` 沿用同一連線跑 DDL（`ALTER TABLE` 等），被 Postgres 以 `must be owner of table X`（42501 / Prisma P3018）擋下——RLS 切換後的第一個新 migration（`add_tenant_purged_at`）即卡死，API 啟動失敗、UAT 部署中斷。`docker-entrypoint.sh` 改為 migrate/seed 一律走新的 `MIGRATE_DATABASE_URL`（指向 table owner，如 `crm`）；未設時 fallback 到 `DATABASE_URL`（相容 RLS 未啟用環境，行為不變）。此舉同時修好 seed 因 RLS WITH CHECK 擋 `INSERT roles` 的錯誤。部署環境需在 `.env.api` 補 `MIGRATE_DATABASE_URL`。
- **UAT 部署 build 因磁碟寫滿失敗（ENOSPC）修補** — 每次部署 `docker compose build` 疊一層 next/webpack build cache 從不清，累積把 40G 根分割區塞爆（曾達 100%），導致 `next build` 寫 `.next/cache` 時 `ENOSPC: no space left on device` → webpack 編譯失敗 → 部署中斷。`deploy.yml` 在 build 前新增 `docker builder prune -af --filter until=48h`（清 48h 前的 build cache、保留當日增量維持 build 速度），避免磁碟無上限累積。
- **啟動驗證加固：registry 必須保留 selfLock 權限** — `validatePermissionRegistry()` 新增第 6 項檢查：registry 若無任何 `selfLock:true` 權限點即啟動失敗（fail-loud）。避免未來重構誤刪 `role.manage` 的 selfLock 導致 agent.service 的「防自我降級鎖死」守門（`SELF_LOCK_CODES` 為空時整段跳過）無聲失效。（PR review bot 提出的邊界條件，加保險。）
- **自我降級鎖死租戶修補（RBAC self-demotion，安全性）** — `PATCH /agents/:id/role` 先前只擋「向上指派超出自身的角色」（`ROLE_ESCALATION`），降級一律放行，且 route 未傳操作者本人 agentId，使最後一位持有 `role.manage`（`selfLock`）的成員可把「自己」改成不含該權限的角色，令整個租戶失去所有能管理角色/權限的人，角色 CRUD 與權限矩陣頁全 403、只能手動改 DB 復原。現 route 將 `request.agent.id` 傳入 `updateAgentRole`；service 在解析出目標 roleId 後，若目標即操作者本人且新角色的有效權限不含任何 registry 標記 `selfLock:true` 的權限碼（動態抽取，非寫死 `role.manage`），即拋 `SELF_LOCK` 422。管理員改別人角色、或把自己改為仍含 `role.manage` 的角色皆不受影響。
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
