# 渠道管理 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，唯讀）
- 規格：`docs/ref/features/feature-map.json` 的 `channels`；功能文件 `docs/ref/features/tenant/CHANNELS.md`、`docs/ref/modules/CHANNEL-PLUGINS.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 6 份 spec、84 個 scenario。缺實作 6 個（`channel-team-access` 的團隊分流與 `defaultTeamId`，已是 TEAM-01）；找不到同名測試 19 個（`channel-plugins` 6、`channel-team-access` 6、`webchat-admin-theme` 6、`channel-visibility-defaults` 1）；缺前端入口 3 項（建立團隊、聊天室的文字與強調色、清除背景圖）。另有 1 個 scenario 的行為與規格不符（HC-CHANNELS-13） |
| 自動測試 | unit：api 13 檔 81 通過、web 4 檔 10 通過、workers 2 檔 4 通過、channel-plugins 3 檔 31 通過。feature：10 檔 92 通過（`modules/channel`、`modules/meta-connect`、`modules/webhook/webhook-account-routing`、`migrations/backfill-unbound-channel-access`）。無失敗、無 skip |
| 實際操作 | 17 條流程。正常 9，異常 6，待真機驗 2（另有 2 條的成功路徑待真機驗） |

## 問題清單（依嚴重度）

P0：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-CHANNELS-01 | P1 | 單筆渠道的路由不檢查渠道可見範圍。持有 `channel.update`／`channel.delete`、沒有 `channel.view_all` 的分店成員，可以讀取、改名、停用、換憑證、測試連線、刪除**看不到的**渠道，也能讀它的嵌入碼與導流識別、改聊天室外觀。換憑證不寫稽核（AUD-01），事後查不到是誰做的。`GET /channels` 與 `GET /:id/status` 有過濾，所以分店在畫面上看不到這些渠道，只要知道渠道 ID 就能操作 | **本機實測**：自訂角色 `channel.view, channel.create, channel.update, channel.delete, inbox.view, inbox.reply, agent.view`，成員只直綁 LINE-A → `GET /channels` 只回 LINE-A；`GET /channels/<FB>` 回 200，帶遮罩憑證與明文 `verifyToken`；`PATCH /channels/<FB> {displayName}`、`{isActive:false}`、`{credentials:{pageAccessToken:"attacker-token"}}` 都回 200，admin 讀回權杖已換；`DELETE /channels/<沒有綁定的 WebChat>` 回 200 並刪除；`POST /channels/<FB>/verify` 回 400 `CHANNEL_VERIFY_FAILED`（有呼叫 Meta，沒有回 404）；`GET /<WC>/embed-code`、`GET /<FB>/binding-handle`、`PATCH /<WC>/chatbox-theme` 都回 200。對照：`GET /<FB>/status` 回 404。**讀程式**：`/setup-webhook`、`/chatbox-link`、`/chatbox-theme/background` 同樣沒有檢查；`POST /webhook-base-url` 改寫全租戶所有渠道（`updateWebhookBaseUrl` 只以 `tenantId` 查詢），本機沒有執行，避免改到其他代理的資料 | `apps/api/src/modules/channel/channel.routes.ts:326-414`（`/:id` GET、PATCH、DELETE、`/verify`、`/webhook-base-url`、`/setup-webhook`）、`:450`、`:460`、`:499-567`、`:570`；`channel.service.ts:687`（`updateWebhookBaseUrl`） | 新。主規格 `channel-visibility-defaults`「Unbound Channel Is Not Visible」要求「in lists or in single-channel access checks」都不可見；RBAC-04 未列渠道路由 |
| HC-CHANNELS-02 | P2 | 渠道管理頁所有操作按鈕不依權限隱藏。只有 `channel.view` 的 supervisor 看得到「套用」「設定精靈」「新增渠道」以及每張卡片的「停用」「測試連線」、Bot 設定、下游轉發、編輯、刪除，按下才跳 alert「權限不足」 | 本機：supervisor 開 `/dashboard/settings/channels` → 每張卡片都有停用、測試連線與 4 個圖示按鈕 → 按「停用」→ 確認後 alert「權限不足，無法執行此操作」。後端 403 `requiredPermission: channel.update` 正常 | `apps/web/src/components/settings/ChannelManagement.tsx:314-330, 377-386, 533-587`（沒有任何 `usePermission`） | 新 |
| HC-CHANNELS-03 | P2 | 網站聊天室背景圖上傳失敗時畫面沒有任何訊息。`uploadThemeBackground` 與 `saveTheme` 只有 `try/finally`，錯誤成為未處理的 Promise rejection；後端錯誤也不是標準格式（`{"error":"Unsupported background image type"}`）或是英文（`File content type rejected: … for line-imagemap`） | 本機：WebChat 卡片「背景」→ 上傳內容是文字的 `fake.png` → 對話框沒有變化，console 只有 `Request failed with status code 400`。API：同檔案回 400 `INVALID_FILE_TYPE`，訊息為英文；`type=text/plain` 回 `{"error":"Unsupported background image type"}`。手冊 ch15 第 7 節已寫「系統不會跳錯誤訊息」 | `ChannelManagement.tsx:244-273`；`channel.routes.ts:576-581` | 新 |
| HC-CHANNELS-04 | P2 | 權杖失效通知的收件人以舊的角色列舉判斷：只通知 `role` 為 `ADMIN` 的成員，不看細粒度角色是否有 `channel.update`，也不看收件人看不看得到這個渠道。自訂「渠道管理員」角色、但列舉是 `AGENT` 的人收不到；列舉仍是 `ADMIN`、但已改成受限角色的分店成員會收到別店渠道的通知 | 讀程式＋本機資料：排程在 2026-10-29 14:30 對「健檢 FB」寫入 `tokenHealth.invalid` 並建立 `channel_token_invalid` 通知，收件人只有 `admin@open333crm.dev`；Demo 租戶另有 `hc-members-fakeadmin`（列舉 `ADMIN`、自訂角色「指派者」）也在收件人查詢條件內 | `apps/api/src/modules/channel/meta-token-health.ts:147-150` | 新（建議併入 RBAC-03 的表格） |
| HC-CHANNELS-05 | P2 | LINE 的「測試連線」只用 Channel Access Token 呼叫 `/v2/bot/info`，不檢查 Channel Secret。Secret 填錯時測試連線顯示成功，之後每則 LINE webhook 都因簽章不符回 403，渠道卡片沒有任何警示（FB／IG 有 `webhookRouting` 警示，LINE 沒有對應機制） | 讀程式。手冊 ch15 第 2 節已提醒「就算 Channel Secret 填錯也會顯示成功」。無法在本機以真實 LINE 帳號重現 | `apps/api/src/modules/channel/channel.service.ts:564-590`；`apps/api/src/modules/webhook/webhook.routes.ts:55-58` | 新 |
| TEAM-01 | P2 | 團隊沒有建立途徑，渠道管理頁的團隊授權清單永遠是空的。連帶結果：成員直綁（`setAgentChannels`）一律寫 `full`，**`read_only`、`reply_only` 在介面上無法設定**，只有「建立者層級封頂」時會產生 | 本機：`GET /channels/teams` 回 `[]`；編輯渠道的「團隊」區沒有可選項 | `apps/api/src/services/channel-team-access.ts:161-185` | TEAM-01（已記錄；存取層級無法設定的部分建議補進內文） |
| CHAN-02 | P2 | workers 沒有網站聊天室外掛 | `apps/workers/src/lib/plugin-registry.ts` 只有 `linePlugin, fbPlugin, threadsPlugin` | `plugin-registry.ts:11` | CHAN-02（已記錄；Instagram 部分已修正，本次確認） |
| HC-CHANNELS-06 | P3 | 渠道名稱只有空白也能建立或更新（`min(1)` 沒有 `trim`），卡片顯示成空白標題 | 本機 UI：新增渠道 → WebChat → 顯示名稱填三個空白 → 儲存 → 建立成功（`displayName` 為 `"   "`）。API `PATCH {displayName:"   "}` 回 200 | `channel.routes.ts:138, 200` | 新 |
| HC-CHANNELS-07 | P3 | `POST /channels` 的 `webhookBaseUrl` 只檢查 http(s)，接受 `http://` 與查詢字串，與 `POST /channels/webhook-base-url` 的規則（只收 https、不可有 `?`、`#`、帳密）不一致，會產生無效的 webhook 網址。前端送的是 localStorage 裡的值 | 本機：`POST /channels {…, webhookBaseUrl:"http://evil.example.com/a?b=1"}` 回 201，`webhookUrl` 為 `http://evil.example.com/a?b=1/api/v1/webhooks/webchat/<id>` | `channel.routes.ts:142`；`ChannelFormDialog.tsx:191-193` | 新 |
| HC-CHANNELS-08 | P3 | Bot 設定的最大回覆次數：填 60 時只顯示通用訊息「輸入內容有誤，請檢查後重新送出」，沒有用回應 `details.issues` 的「Bot 最大回覆次數須為 1～50 的整數」；填 0 或清空時輸入框直接變成 5，使用者看不出被改過 | 本機 UI：Bot 設定 → 填 60 → 儲存 → 通用訊息；填 0 → 欄位顯示 5 | `apps/web/src/components/settings/BotConfigForm.tsx:168-169, 209` | 新 |
| HC-CHANNELS-09 | P3 | 沒有 `channel.view` 的成員（系統角色 Agent）仍看得到「渠道管理」頁籤；`GET /channels` 403 時畫面顯示「沒有渠道／新增您的第一個渠道」與「新增渠道」按鈕，看起來像租戶沒有渠道。手冊 ch15 第 1 節特地提醒「不要再新增一個」 | 本機與 UAT：agent 開 `/dashboard/settings/channels`，`GET /channels` 403，畫面為空狀態 | `apps/web/src/app/dashboard/settings/page.tsx:25`；`ChannelManagement.tsx:409-419`；`apps/web/src/hooks/useChannels.ts` | 新 |
| HC-CHANNELS-10 | P3 | WebChat 渠道：卡片仍有「測試連線」，按下顯示紅字「不支援的渠道類型: WEBCHAT」；「新增渠道」表單要求填 Channel Secret 與 Channel Access Token（說明寫「任意字串」，實際沒有用途），精靈則自動產生 | 本機 UI：WebChat 卡片按「測試連線」；新增渠道選 WebChat 不填兩格時無法送出（瀏覽器 required） | `ChannelManagement.tsx:541-552`；`ChannelFormDialog.tsx:174-184, 416-444`；`channel.service.ts:676` | 新 |
| HC-CHANNELS-11 | P3 | 編輯 LINE 渠道只填 Channel Secret 或只填 Access Token 時，表單靜默略過憑證、照常關閉，憑證沒有更新（FB／IG 可以只換一格） | 本機 UI：編輯 LINE-A → 只填 Channel Secret → 儲存 → 對話框關閉，`PATCH` 只帶名稱，`GET` 讀回 Secret 不變。手冊 ch15 第 11 節已註明 | `ChannelFormDialog.tsx:134-141` | 新 |
| HC-CHANNELS-12 | P3 | 編輯 Instagram 渠道時，Webhook 網址下方寫「此為系統內部使用的 Webhook URL」，實際上這個網址要貼到 Meta 的回呼網址 | 讀程式（`THREADS` 落到最後的 else）；手冊 ch15 第 6 節已註明說明有誤 | `ChannelFormDialog.tsx:481-486` | 新 |
| HC-CHANNELS-13 | P3 | 非 UUID 的渠道 ID：`/channels/abc`、`/channels/abc/teams` 回 400 `DATABASE_ERROR`「資料處理失敗」；公開的訂閱驗證 `GET /webhooks/fb/abc`、`/webhooks/threads/abc` 回 500「Internal error」。主規格 `threads-channel`「驗證的渠道不存在」要求網址的 `channelId` 不是任何 Instagram 渠道時回 404 | 本機與 UAT：`GET /channels/abc` 400 `DATABASE_ERROR`；本機 `GET /webhooks/threads/abc?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1` 500 | `channel.routes.ts:326, 619`；`webhook.routes.ts:136-158, 211-232` | 新（違反主規格 `threads-channel`） |
| HC-CHANNELS-14 | P3 | FB 權杖狀態：渠道管理頁每次開啟都對每個啟用中的 FB 渠道呼叫 Meta `debug_token`；退回 `/me` 時把權杖放在網址查詢字串（`verifyChannel` 已改用 Authorization header）；`debug_token` 也把 `appId|appSecret` 放在網址。卡片直接顯示 Meta 英文原文（例如 Invalid OAuth access token - Cannot parse access token）。另外主規格 `channel-management` 的 Purpose 寫「查詢渠道狀態不寫入資料也不呼叫外部 API」，與程式不符 | 本機：FB 卡片顯示英文權杖錯誤；`GET /channels/<FB>/status` 0.3 秒、回 Meta 錯誤原文 | `apps/api/src/modules/channel/fb-token-monitor.service.ts:48-51, 99-101`；`ChannelManagement.tsx:275-291, 471-476` | 新 |
| HC-CHANNELS-15 | P3 | `GET /channels/:id/embed-code` 沒有 `requirePermission`，沒有任何渠道權限的成員也拿得到；渠道沒有 `publicKey` 時這個 GET 還會寫入一把新的 | 本機：agent（無 `channel.view`）`GET /channels/<WC>/embed-code` 回 200 | `channel.routes.ts:450`；`webchat-embed.service.ts:24-26` | 新 |
| HC-CHANNELS-16 | P3 | 英文錯誤訊息：存取層級不足回「Forbidden: channel access level insufficient（需 …，實為 …）」；背景上傳見 HC-CHANNELS-03 | 讀程式 | `apps/api/src/services/channel-visibility.ts:258-262` | 新 |
| HC-CHANNELS-17 | P3 | 「Webhook 公開網址」的「目前使用」只存在瀏覽器 localStorage，換瀏覽器或其他管理員看不到；確認視窗寫「改寫全部 N 個渠道」，N 是自己看得到的渠道數，後端實際改寫全租戶 | 讀程式；本機確認取消不送出、確定才送出（符合主規格） | `ChannelManagement.tsx:45, 103-118` | 新 |
| HC-CHANNELS-18 | P3 | 背景圖一選檔就上傳並寫入渠道設定，之後按「取消」不會撤回；換圖時舊檔不刪除 | 讀程式＋本機 API（上傳回 201 即已寫入 `settings.chatboxTheme`） | `ChannelManagement.tsx:259-273`；`channel.routes.ts:597-610` | 新 |
| HC-CHANNELS-19 | P3 | `PATCH /channels/:id` 的憑證可以送空字串，會蓋掉原值（合併只濾掉 `undefined`）；LINE、WebChat 更新憑證也沒有欄位驗證。前端不會送空字串，只影響 API 用戶端 | 本機：`PATCH /channels/<LINE> {credentials:{channelAccessToken:""}}` 回 200，讀回 `channelAccessToken: "****"` | `channel.service.ts:321-334`；`channel.routes.ts:202` | 新 |
| HC-CHANNELS-20 | P3 | 分派警示只保留最後一筆。同一網址渠道先後收到 `app_mismatch` 與 `unrouted_account`，卡片只顯示後者，管理員看不到「應用程式密鑰填錯」的提示 | 本機：對 FB 送 HCPAGE_C（不同 App 認領）再送 HCPAGE_Z（沒人認領），`settings.webhookRouting.reason` 只剩 `unrouted_account` | `apps/api/src/modules/webhook/webhook-account-routing.ts:193-215` | 新 |
| HC-CHANNELS-21 | P3 | 團隊授權區按「新增」或撤銷立即生效，按編輯框的「取消」不會復原 | 讀程式；手冊 ch15 第 9 節已註明 | `apps/web/src/components/settings/ChannelTeamAssignment.tsx:118-143` | 新 |
| HC-CHANNELS-22 | P3 | 規格互相矛盾：`channel-team-access` 的「Create Channel without Default Team」要求沒有 `defaultTeamId` 時渠道沒有任何授權、要管理員手動授權；`channel-visibility-defaults` 要求沒送 `visibleAgentIds` 時綁給所有啟用中的成員（現行行為）。前者另有 `defaultTeamId` 從未實作（TEAM-01） | 讀規格 | `openspec/specs/channel-team-access/spec.md`、`openspec/specs/channel-visibility-defaults/spec.md` | 新（規格） |
| PLAN-07 | P3 | 渠道類型白名單與數量上限沒有方案填值；另外停用的渠道重新啟用時不檢查 `maxChannels`（功能文件有寫，AUDIT 內文沒有） | 讀程式：`updateChannel` 處理 `isActive: true` 時沒有計數 | `channel.service.ts:316-320` | PLAN-07（已記錄；重新啟用的部分建議補進內文） |
| CHAN-01 | P3 | 刪除是硬刪除；有對話回 409 | 本機 UI：刪除有對話的 FB → alert「此渠道已有對話或其他資料，無法刪除…請改用「停用」」 | `channel.service.ts:383-405` | CHAN-01（已記錄，部分修正確認） |
| APP-02、APP-03、PKG-02、AUD-01 | P3 | WhatsApp 可建立但無外掛；啟動 log 仍寫 `LINE, FB, WEBCHAT`；`./fb` 子路徑仍指向 `dist/fb`；`PATCH /channels/:id` 不寫稽核 | 本機 API log 第 13 行「Registered channel plugins: LINE, FB, WEBCHAT」；`tenant_audit_logs` 對本次改過的渠道只有 `channel.create` | `apps/api/src/index.ts:328`；`packages/channel-plugins/package.json:22-25` | 已記錄，本次確認仍存在 |

### 本次確認正常的高風險點

- **Meta webhook 依粉專 ID 分派**（PR #187）：本機以 `appSecret` 簽章送 FB webhook，四種情況都符合設計 — 網址渠道沒有帳號 ID 時相容模式照收並寫 `account_id_missing`；自己的粉專寫進網址渠道；同 App 的另一個渠道認領時改派過去；不同 App 認領與沒人認領都丟棄並寫警示；認領渠道已停用時視同沒人認領。簽章錯誤回 200 並丟棄。
- **FB／IG 訂閱驗證**：正確 `verifyToken` 回 200 與 challenge 原文、錯誤 403、缺參數 403、渠道不存在 404、用 FB 渠道 ID 打 IG 路由 404；LINE 路由打 FB 渠道回 403（`channel_type_mismatch`）。
- **權杖失效排程**：本機 2026-10-29 14:30 已對解不開憑證的 FB 渠道寫入 `tokenHealth.invalid`、建立站內通知；卡片顯示紅框與「請按編輯，貼上新的存取權杖」。UAT Demo 的 IG333 也顯示失效紅框（已知需重填權杖）。
- **Bot 最大回覆次數**：本機把 FB 對話的 `botRepliesCount` 調為 2、`maxBotReplies` 設 2，再進一則訊息，對話轉為 `AGENT_HANDLED`，`handoffReason` 為「Bot 回覆次數已達上限 (2/2)」。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 列表 | 本機、UAT | 正常：本機只對啟用中的 FB 呼叫 `/status`；UAT Demo 8 個渠道卡片、平台模式粉專顯示「透過 Facebook 登入連結，不需另外設定 Webhook」與粉專 ID | — | supervisor 看到全部操作按鈕（HC-CHANNELS-02）；agent 403 顯示成「沒有渠道」（HC-CHANNELS-09） | UAT 以攔截 `/status` 避免觸發 Meta 呼叫 |
| 2 新增（表單） | 本機 | 正常：WebChat 建立後重新整理仍在；API 建立 LINE、FB、IG、WebChat 皆 201，`webhookUrl` 正確 | 缺憑證、`TELEGRAM`、空名稱、101 字、不存在的成員、`javascript:` 網址都 400；**異常**：名稱全空白可建立（HC-CHANNELS-06）、`http://…?b=1` 可當 `webhookBaseUrl`（HC-CHANNELS-07） | 建立者不是總店、沒勾自己時自動加入（實測）；不送 `visibleAgentIds` 綁給所有啟用中的成員 | WebChat 要填無用的兩格（HC-CHANNELS-10） |
| 3 新增（精靈） | 本機 | 正常：WebChat 四步完成並顯示嵌入碼 | — | 同上 | LINE/FB/IG 的驗證成功路徑待真機驗 |
| 4 用 Facebook 連結粉專 | — | 待真機驗 | — | — | 需要 Meta 授權；UAT `GET /meta-connect/status` 為 configured，未操作 |
| 5 編輯 | 本機 | 改名、FB 只換一格權杖正常（憑證合併） | **異常**：LINE 只填一格靜默不更新（HC-CHANNELS-11）；空字串可蓋掉憑證（HC-CHANNELS-19）；非 UUID 400 `DATABASE_ERROR`（HC-CHANNELS-13） | **異常**：分店成員可改看不到的渠道（HC-CHANNELS-01）；唯讀角色 403 正常 | FB 編輯框顯示明文 `verifyToken` |
| 6 導流識別 | 本機（API） | 正常：GET 回目前值 | — | **異常**：看不到的渠道也讀得到（HC-CHANNELS-01） | — |
| 7 團隊授權 | 本機（API） | 未驗：沒有團隊可指派（TEAM-01） | 不存在的團隊 404、非 UUID `teamId` 400、撤銷不存在的授權 404；非 UUID 渠道 400 `DATABASE_ERROR` | 沒有 `channel.assign_team` 403；前端依權限隱藏此區 | — |
| 8 成員可用渠道 | 本機（API） | 正常：`POST /agents {channelIds:[LINE-A]}` 後成員只看得到 LINE-A | — | — | 詳見 members 領域 |
| 9 停用、啟用 | 本機 | 正常：停用確認後卡片標籤變「停用」，重新整理一致，再按「啟用」恢復；停用清空 `externalAccountId`，啟用時 FB 自動重新驗證（失敗只寫 log） | — | supervisor 按下才 alert「權限不足」 | 重新啟用不檢查數量上限（PLAN-07） |
| 10 刪除 | 本機 | 正常：沒有對話的渠道刪除成功 | 有對話的 FB 回 409，alert 顯示停用建議 | **異常**：分店成員可刪看不到的渠道（HC-CHANNELS-01） | — |
| 11 測試連線 | 本機 | 成功路徑待真機驗 | LINE、FB 假憑證回 400 `CHANNEL_VERIFY_FAILED`，卡片顯示中文原因與 Meta 原文；WebChat 顯示「不支援的渠道類型」（HC-CHANNELS-10） | 唯讀角色 403 | LINE 不驗 Secret（HC-CHANNELS-05） |
| 12 Webhook 公開網址 | 本機 | 正常：取消確認不送出請求；確定後送出 `{"baseUrl":"https://hc-channels.example.com"}`（以 route 攔截，未改寫資料） | API：`http://`、`?x=1` 回 400 | 分店成員可改寫全租戶（讀程式，HC-CHANNELS-01） | 目前值只在 localStorage（HC-CHANNELS-17） |
| 13 Bot 設定 | 本機、UAT（只開啟不儲存） | 正常：存 10，重新整理讀回 10；`maxBotReplies` 達上限後轉人工（見上方） | 9999、0、5.5、"5"、null 都 400；**異常**：前端只顯示通用訊息、填 0 變 5（HC-CHANNELS-08） | 唯讀角色 403 | UAT 未設定的渠道顯示預設 5 |
| 14 下游轉發 | 本機（API） | 正常：`https://example.com/x` 可存 | `http://` 400（英文訊息，屬 line 領域） | — | 內網位址在儲存時接受、轉發時才擋（`isBlockedUrl`），見 line 領域 |
| 15 網站聊天室 | 本機 | 嵌入碼、正向背景上傳（真 PNG 201）正常 | **異常**：假圖上傳畫面無訊息（HC-CHANNELS-03）；`backgroundImageUrl` 填外部網址 400；LINE 渠道設外觀 404 | `embed-code` 無權限檢查（HC-CHANNELS-15）；唯讀角色改外觀 403 | — |
| 16 進站 webhook | 本機 | 正常：FB 簽章事件、帳號分派四種情況（見上方） | 簽章錯丟棄；非 UUID 渠道的訂閱驗證 500（HC-CHANNELS-13） | 公開端點 | LINE 簽章細節屬 line 領域；真實 Meta、LINE 推送待真機驗 |
| 17 權杖失效通知 | 本機 | 正常：排程寫入 `tokenHealth` 並建立站內通知 | — | **異常**：收件人看舊角色列舉（HC-CHANNELS-04） | email 內容未在本機 log 找到（log 是重啟後的檔案）；以 unit 與 feature 測試為準 |

權限測試用的角色：admin、seed 的 supervisor（只有 `channel.view`，直綁 5 個渠道）、seed 的 agent（沒有任何 `channel.*`）、本機自建「hc-channels-分店管理」（`channel.view/create/update/delete`、`inbox.view/reply`、`agent.view`，只直綁 LINE-A）、本機自建「hc-channels-唯讀」（`channel.view, inbox.view`，只直綁 WebChat）。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試。

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| channel-management | 5 | 11 | 0 | 0 | 有（確認對話、停用鈕、Bot 設定範圍） |
| channel-plugins | 4 | 6 | 6 | 0；「Channel type values are defined as shared constants」只部分做到：`channel.routes.ts` 的 `getBindableChannel`、`/binding-handle` 等處仍寫字串 `'LINE'`、`'FB'`、`'THREADS'` | 不適用 |
| channel-team-access | 3 | 14 | 6 | 6：團隊分流 4 個、`defaultTeamId` 2 個（TEAM-01） | 團隊授權區有，但沒有團隊可選 |
| channel-visibility-defaults | 7 | 19 | 1（Several teams combined） | 0；但單筆渠道存取沒有套用（HC-CHANNELS-01） | 新增渠道與新增成員都有可見成員清單 |
| threads-channel | 9 | 28 | 0 | 0；「驗證的渠道不存在」在非 UUID 時回 500（HC-CHANNELS-13） | 有 |
| webchat-admin-theme | 3 | 6 | 6 | 0 | 上傳有；文字色、強調色、清除背景沒有 |

**有後端、沒有前端入口**：`chatbox-theme` 的 `foregroundColor`、`accentColor` 與清除背景；`GET /channels/teams/:teamId/channels`；建立 `WHATSAPP` 渠道（APP-02）。前端呼叫的端點後端都存在。

**前端送出的值與後端 Zod**：渠道類型、`visibleAgentIds`、FB/IG 的 `verifyToken`、`maxBotReplies`（1～50 整數，前端 `min/max` 一致）、`liffConfig`（前端 trim）、團隊層級 `full|reply_only|read_only` 都被接受。沒有發現前端合法值被後端拒絕；反過來後端接受了前端不該允許的值（空白名稱、`http://` 的 `webhookBaseUrl`）。

## 待真機驗

- 設定精靈與「測試連線」對真實 LINE、FB、IG 帳號的成功路徑：寫入 `lastVerifiedAt`、`externalAccountId`、`bindingHandleAuto`；LINE 精靈自動設定 webhook。
- 「用 Facebook 連結粉專」的授權、選粉專、建立平台模式渠道與重新連結（流程 4）。
- 真實 Meta 推送：多粉專共用同一個 Meta App 時依粉專 ID 分派（本機以簽章模擬已通過）；`/webhooks/meta` 平台 App 端點。
- 權杖失效通知 email 的實際內容與 3 天提醒。
- LINE Channel Secret 填錯時「測試連線」成功但 webhook 403（HC-CHANNELS-05）。

## UAT 操作紀錄

只做唯讀：以 admin 登入 Demo 租戶，`/auth/me` 確認 `tenantId` 後讀 `GET /channels`、`GET /meta-connect/status`、`GET /channels/abc`；以 agent 確認 `GET /channels` 403；瀏覽器開渠道管理頁並開啟一次 Bot 設定（未儲存）。瀏覽器腳本攔截了所有寫入請求與 `/status`（避免呼叫 Meta），攔截紀錄為寫入 0 筆、狀態查詢 1 筆。沒有建立任何資料，沒有 ledger。

本機測試資料已清除：刪除 8 個 `hc-channels-` 渠道與 1 個空白名稱渠道、2 個測試成員、2 個測試角色。`hc-channels-FB`、`hc-channels-FB2` 有對話無法刪除，已停用（帳號 ID 已清空）。測試期間 WebChat 渠道的外觀曾被分店帳號改寫，已還原後刪除。

## 建議新增到 AUDIT.md 的項目

- HC-CHANNELS-01：單筆渠道路由（讀、改、刪、測試連線、換憑證、外觀、嵌入碼、導流識別、Webhook 公開網址）不檢查渠道可見範圍。建議列為 RBAC-04 的新列，或獨立一項；搭配 AUD-01，換憑證無稽核。
- HC-CHANNELS-04：`meta-token-health.ts` 的 `notifyAdmins()` 以 `role: 'ADMIN'` 選收件人，建議加進 RBAC-03 的表格。
- HC-CHANNELS-05：LINE 測試連線不驗 Channel Secret，Secret 錯誤時 webhook 全部 403 且畫面沒有警示。
- HC-CHANNELS-02、HC-CHANNELS-03：渠道管理頁按鈕不依權限隱藏；背景上傳失敗沒有畫面訊息。
- TEAM-01 內文補一句：成員直綁一律 `full`，`read_only`、`reply_only` 在介面上無法設定。
- PLAN-07 內文補一句：停用的渠道重新啟用時不檢查 `maxChannels`。
- HC-CHANNELS-13：訂閱驗證端點在非 UUID 渠道 ID 時回 500，違反主規格 `threads-channel`。
- HC-CHANNELS-22：`channel-team-access` 與 `channel-visibility-defaults` 對「建立渠道時沒有指定授權」的規定互相矛盾（規格修正）。

## 文件過時之處

- `docs/ref/features/tenant/CHANNELS.md`
  - 「負責的程式」表與「目前的限制」寫「Facebook token 沒有定期檢查，只有查詢狀態時才檢查」：已有每 6 小時的 `meta-token-health.ts` 排程，檢查 FB 與 IG、寫 `settings.tokenHealth`、通知管理員。
  - 沒有提到 Meta 依粉專 ID 分派（`externalAccountId`、`webhook-account-routing.ts`、`settings.webhookRouting` 警示）、「用 Facebook 連結粉專」（`meta-connect` 模組、`/webhooks/meta`）、`/channels/:id/binding-handle`。
  - 「渠道設定」表沒有 `tokenHealth`、`webhookRouting`、`chatboxTheme`、`liffConfig.loginChannelId`。
  - 開頭寫「決定哪些團隊看得到這個渠道」，「誰看得到這個渠道」一節以團隊授權為主；實際主要路徑是成員直綁（新增渠道的成員清單與人員管理頁），團隊無法建立（TEAM-01）。
  - 「核對日期：2026-09-30」，之後的 fail-closed、停用鈕、權杖排程都已上線，但部分段落已更新、部分沒有。
- `docs/ref/modules/CHANNEL-PLUGINS.md`
  - 「先讀這一段」與「各渠道的實作」表寫 workers「只放 LINE 與 Facebook」「送不出 Instagram 私訊」、THREADS 的 workers 註冊為「沒有」：`plugin-registry.ts` 已有 `threadsPlugin`（`95d68fc8`）。
  - 「以 channelType 分支」的位置表沒有 `channel/meta-token-health.ts` 與 `apps/api/src/scripts/backfill-channel-external-account-id.ts`。
- 主規格 `openspec/specs/channel-management/spec.md` 的 Purpose 寫「查詢渠道狀態……不呼叫外部 API」，但 FB 的狀態查詢會呼叫 Meta（HC-CHANNELS-14）；需求本文只要求不寫入。
- `AGENTS.md`「Authorization」一段寫權限碼登錄在 `packages/core/src/rbac/permissions.ts`，實際在 `packages/shared/src/rbac/permissions.ts`。
- 手冊 `apps/web/public/manual/ch15-channels.html` 內容與程式一致，並已把 HC-CHANNELS-03、05、09、10、11、12、21 寫成注意事項；這些問題修好後要回頭改手冊。
