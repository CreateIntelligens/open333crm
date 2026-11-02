---
name: feature-channels
description: >
  open333CRM「渠道管理」功能顧問：新增、編輯、停用、刪除渠道（LINE、Facebook、Instagram 私訊 THREADS、
  網站聊天室 WebChat）、設定精靈、用 Facebook 連結粉專（meta-connect）、憑證加密與遮罩、測試連線、
  webhook 網址與 Webhook 公開網址、FB／IG 驗證權杖 verifyToken、Meta webhook 依粉專 ID 分派（externalAccountId、
  webhookRouting 警示）、權杖失效通知與重新連結（tokenHealth、meta-token-health 排程）、誰看得到這個渠道
  （AgentChannelAccess、ChannelTeamAccess、存取層級 read_only/reply_only/full、fail-closed、channel.view_all 總店）、
  Bot 設定（botMode、maxBotReplies、轉接關鍵字、招呼語、LIFF ID）、網站聊天室嵌入碼與背景、
  channel plugin registry（API 的 registerChannelPlugin 與 workers 的 createWorkerPluginRegistry 兩邊都要註冊）。
  當需求、bug 或新功能碰到 channel、channels 模組、webhook 路由、meta-connect、/dashboard/settings/channels、
  「渠道收不到訊息」「粉專訊息跑到別的租戶」「權杖失效」「分店看得到別店渠道」「新增一種渠道」時使用。
  也在改收件匣送訊息、自動化送訊息、人員管理的可用渠道之前使用，確認不破壞渠道。
---

# 渠道管理

## 先讀
- 功能現況：`docs/ref/features/tenant/CHANNELS.md`
  - 注意：「Facebook token 沒有定期檢查」與「負責的程式」表已過時。程式有每 6 小時的 `apps/api/src/modules/channel/meta-token-health.ts` 排程，檢查 FB 與 IG 並通知；文件也沒寫 Meta 依粉專 ID 分派、用 Facebook 連結粉專。見健檢報告「文件過時之處」。
- 外掛與送出路徑：`docs/ref/modules/CHANNEL-PLUGINS.md`
  - 注意：其中「workers 只放 LINE 與 Facebook、送不出 Instagram」已過時，`apps/workers/src/lib/plugin-registry.ts` 已有 `threadsPlugin`（`95d68fc8`）；仍缺 `webchatPlugin`（CHAN-02）。
- 健檢結果與已知問題：`docs/ref/features/health/CHANNELS.md`
- 規格：`openspec/specs/channel-management/spec.md`、`openspec/specs/channel-visibility-defaults/spec.md`、`openspec/specs/channel-team-access/spec.md`、`openspec/specs/threads-channel/spec.md`、`openspec/specs/channel-plugins/spec.md`、`openspec/specs/webchat-admin-theme/spec.md`。可見範圍套用在對話與工單的規則在 `openspec/specs/channel-scoped-visibility/spec.md`（收件匣領域）。Meta 依粉專分派的規格還在未歸檔的 change `openspec/changes/fix-meta-webhook-page-routing/`。
- 手冊：`apps/web/public/manual/ch15-channels.html`（已把多個已知問題寫成注意事項）
- 影響分析：`node scripts/feature-impact.mjs --domain channels`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）。頁面是 `/dashboard/settings/channels`，元件 `apps/web/src/components/settings/ChannelManagement.tsx`。

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 渠道列表 | 設定 → 渠道管理 | `GET /channels` → `listChannels`（依 `resolveChannelVisibility` 過濾）；頁面再對每個**啟用中的 FB** 呼叫 `GET /channels/:id/status` → `checkFbTokenStatus`（會打 Meta `debug_token`） | 只讀，不寫 `lastVerifiedAt`。卡片顯示 webhook 網址、粉專/IG 帳號 ID、`settings.webhookRouting` 分派警示、`settings.tokenHealth` 失效紅框 | `channel.view` / 頁籤**不隱藏**；403 時畫面顯示「沒有渠道」與新增按鈕 |
| 2 | 新增渠道（表單） | 「新增渠道」 | `POST /channels {channelType, displayName, credentials, webhookBaseUrl?, visibleAgentIds?}` → `createChannel`（同一交易寫 `AgentChannelAccess`） | 加密憑證、產生 `publicKey`、`webhookUrl`；稽核 `channel.create`。全選成員時不送 `visibleAgentIds`＝綁給所有啟用中的成員；建立者不是總店且沒勾自己時自動加入 | `channel.create` / 按鈕**不隱藏** |
| 3 | 新增渠道（設定精靈） | 「設定精靈」四步 | `POST /channels` → `POST /channels/:id/verify` → LINE 再 `POST /:id/setup-webhook`；WebChat 再 `GET /:id/embed-code` | 同上；FB／IG 完成頁顯示 webhook 網址與前端產生的 `verifyToken` | 同上 |
| 4 | 用 Facebook 連結粉專 | 「用 Facebook 連結粉專」（`GET /meta-connect/status` 為 configured 才出現） | `POST /meta-connect/start` → Facebook 授權 → `GET /meta-connect/callback` → `GET /meta-connect/sessions/:id/pages` → `POST /meta-connect/sessions/:id/connect {pageIds}` | 新建平台模式渠道（`connectMode: platform`、`externalAccountId`＝粉專 ID、訂閱平台 App），綁給所有啟用中成員；已連結的粉專改為「重新連結」只換權杖 | `channel.create` |
| 5 | 編輯渠道 | 卡片鉛筆 | `GET /channels/:id`（遮罩憑證，`verifyToken`/`appId`/`pageId` 明文）→ `PATCH /channels/:id {displayName, credentials?}` → `updateChannel`（憑證與舊值合併） | FB／IG 換權杖會清空 `externalAccountId` 並立刻自動驗證；**PATCH 不寫稽核**（AUD-01） | `channel.update` / 不隱藏。**後端沒有檢查渠道可見範圍**（HC-CHANNELS-01） |
| 6 | 導流識別 | 編輯框「跨渠道綁定」區（LINE/FB/IG） | `GET`、`PATCH /channels/:id/binding-handle` | 只合併 `settings.bindingHandle` | `channel.view` / `channel.update` |
| 7 | 團隊授權 | 編輯框「團隊」區（有 `channel.assign_team` 才顯示） | `GET /channels/teams`、`GET/POST /channels/:id/teams`、`DELETE /channels/:id/teams/:teamId` | 寫 `ChannelTeamAccess`，按下即生效（取消不會復原）；稽核 `channel.assign_team`/`channel.revoke_team`。**系統沒有建立團隊的地方**，清單通常是空的（TEAM-01） | `channel.assign_team` |
| 8 | 成員可用渠道 | 人員管理（members 領域） | `PUT /agents/:id/channels {channelIds}` → `setAgentChannels` | 整組替換直綁，層級一律 `full` | 見 `feature-members` |
| 9 | 停用、啟用 | 卡片「停用」「啟用」 | `PATCH /channels/:id {isActive}` | 停用清空 `externalAccountId`；啟用時 FB/IG 自動重新驗證；**重新啟用不檢查 maxChannels** | `channel.update` / 不隱藏，按下才 alert「權限不足」 |
| 10 | 刪除 | 卡片垃圾桶 | `DELETE /channels/:id` → `deleteChannel` | 有對話回 409 `CHANNEL_IN_USE`；沒對話時硬刪並 cascade 身分（CHAN-01）；平台模式粉專取消訂閱；稽核 `channel.delete` | `channel.delete` / 不隱藏 |
| 11 | 測試連線 | 卡片「測試連線」 | `POST /channels/:id/verify` → `verifyChannel`（LINE `/v2/bot/info`、FB `/me`、IG `graph.instagram.com/me`） | 寫 `lastVerifiedAt`、`bindingHandleAuto`、`externalAccountId`（撞別的渠道回 409），清掉 `webhookRouting`、`tokenHealth`。WebChat 回 400「不支援的渠道類型」 | `channel.update` |
| 12 | Webhook 公開網址 | 頁首卡片「套用」 | `POST /channels/webhook-base-url {baseUrl}` → `updateWebhookBaseUrl` | 改寫**全租戶**所有渠道的 `webhookUrl`（不看可見範圍）；目前值只存在瀏覽器 localStorage | `channel.update`；送出前 `confirm()` |
| 13 | Bot 設定 | 卡片機器人圖示 | `PATCH /channels/:id {settings: {...快照, botConfig, liffConfig, firstContactGreeting}}` | 整包覆寫 settings（系統維護的 key 在資料庫端補回）；`maxBotReplies` 由 `apps/api/src/modules/automation/automation.worker.ts` 的 `checkAutoHandoff` 讀取 | `channel.update` |
| 14 | 下游 Webhook 轉發 | 卡片分岔箭頭 | `PATCH /channels/:id {settings.downstreamWebhook}` | 見 `feature-line` | `channel.update` |
| 15 | 網站聊天室 | WebChat 卡片「取得嵌入碼」「預覽」「背景」、頁首「WebChat 網頁版連結」 | `GET /:id/embed-code`、`POST /:id/chatbox-link {domain}`、`PATCH /:id/chatbox-theme`、`POST /:id/chatbox-theme/background`（multipart） | 背景圖上傳即寫入（按取消也不會撤回）；上傳失敗畫面沒有任何訊息 | `embed-code` **沒有權限檢查**；其他 `channel.update` |
| 16 | 進站 webhook（系統） | LINE/Meta 平台 | `POST /webhooks/line|fb|threads/:channelId`、`GET /webhooks/fb|threads/:channelId`（訂閱驗證）、`GET/POST /webhooks/meta`（平台 App） → `webhook.service.ts` → `webhook-account-routing.ts` | FB/IG 依 `entry.id` 找渠道：自己的粉專→網址渠道；別的渠道認領且同 App→改派；不同 App→丟棄（`app_mismatch`）；沒人認領且網址渠道沒帳號 ID→相容模式照收（`account_id_missing`）；有帳號 ID→丟棄（`unrouted_account`） | 公開端點，以簽章為憑證 |
| 17 | 權杖失效通知（系統） | 排程每 6 小時 | `runMetaTokenHealthCheck` | 寫 `settings.tokenHealth`；有效→失效時通知 `role` 為 `ADMIN` 的成員（站內 `channel_token_invalid` ＋ email），持續失效每 3 天再提醒 | — |

**有後端、沒有前端入口**：`PATCH /channels/:id/chatbox-theme` 的 `foregroundColor`、`accentColor` 與清除背景（`backgroundImageUrl: null`）；`GET /channels/teams/:teamId/channels`；`GET /channels/assignable`（人員管理頁用）；建立 `WHATSAPP` 渠道（API 接受、表單沒有，APP-02）。IG 的 `GET /:id/status` 不查權杖，失效只靠排程。

**前端實際送出的值**：渠道類型 `LINE|FB|THREADS|WEBCHAT`；FB/IG 建立時前端產生 `verifyToken: open333crm_<uuid>`；編輯 FB/IG 只送有填的欄位（空的帶 `undefined`），LINE **兩格都填才送**，只填一格會靜默略過；WebChat 表單要求填任意字串的 Channel Secret/Access Token，精靈則自動產生；`maxBotReplies` 輸入框填 0 或非數字會被改成 5；`visibleAgentIds` 只在沒全選時送；Webhook 公開網址送 `trim()` 後去尾斜線。

## 不可破壞的規則
- **兩個行程各一份外掛註冊表。** 新增渠道或外掛時，`apps/api/src/index.ts` 的 `registerChannelPlugin()` 與 `apps/workers/src/lib/plugin-registry.ts` 的 `createWorkerPluginRegistry()` 都要加，`packages/channel-plugins/src/index.ts` 的 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 也要同步（`apps/workers/tests/unit/lib/plugin-registry.test.ts` 會檢查）。漏 workers 的話自動化與關鍵字回覆在該渠道送不出去，且畫面看不出來（CHAN-02）。
- **可見範圍是 fail-closed。** 沒有任何 `AgentChannelAccess`／`ChannelTeamAccess` 的渠道，只有持有 `channel.view_all` 的成員看得到；停用的渠道一律不在可見集合。新渠道沒送 `visibleAgentIds` 時綁給所有啟用中的成員，送空陣列時誰都不綁。不要加回「沒綁定＝全員可見」。
- **單筆渠道操作要自己檢查可見範圍。** `GET /channels` 與 `/:id/status` 有過濾，其他 `/:id/*` 路由目前沒有（HC-CHANNELS-01）。新增渠道端點時呼叫 `apps/api/src/services/channel-visibility.ts` 的 `assertChannelVisible(request, id, level)`，看不到回 404，層級不足回 403。
- **外部帳號 ID 只能由驗證寫入。** `externalAccountId`（FB 粉專 ID、IG 專業帳號 ID）來自用該渠道權杖向 Meta 查得的結果；不可開放表單手填，否則共用同一個 Meta App 時能搶走別的租戶的粉專訊息。全平台唯一（`channelType + externalAccountId`），停用時清空。
- **系統維護的 settings key**（`bindingHandle`、`bindingHandleAuto`、`fbGetStartedConfigured`、`webhookRouting`、`metaConnect`、`tokenHealth`）與憑證的 `connectMode` 不接受租戶輸入；`updateChannel` 在資料庫端補回現值。改 settings 時沿用 `patchChannelSettings` 的原子合併，不要讀出整包再寫回。
- **憑證**以 `CREDENTIAL_ENCRYPTION_KEY`（至少 32 字元）加密；`GET /channels/:id` 只回遮罩值，`verifyToken`、`appId`、`pageId` 明文。日誌與稽核不可放憑證。
- **驗簽用的秘密**：`FB`、`THREADS` 用 `appSecret`，其他用 `channelSecret`（`webhook.service.ts`）。IG 的 `appSecret` 是「Instagram 應用程式密鑰」，不是 Meta App 基本資料的 App Secret。
- **刪除是硬刪除**（CHAN-01）。有對話的渠道只能停用；要下架請用 `isActive: false`。
- 狀態查詢 `GET /channels/:id/status` 不可寫入（主規格 `channel-management`）；「最後驗證」只由測試連線更新。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain channels` 看最新版本。重點：
- **被依賴**：收件匣（進站、回覆、botConfig、可見範圍過濾對話）、LINE（憑證、LIFF、下游轉發、圖文選單）、自動化（workers 外掛、自動轉接）、工單（可見範圍與自動指派）、聯絡人（ChannelIdentity、導流識別）、行銷、知識庫（botMode）、短連結（LIFF ID）、數據分析、人員管理。
- **依賴**：人員管理（可見成員、角色權限）、方案（`allowedChannelTypes`、`maxChannels`，PLAN-07）、通知（權杖失效）、治理（稽核）、LINE（驗簽、webhook 自動設定）。
- 收件匣與可見範圍的核心解析在 `apps/api/src/services/channel-visibility.ts`，地圖歸在收件匣領域；改它時兩個領域的回歸都要跑。

## 回歸清單
改到本領域時，至少重走：
1. 新增 LINE、FB、IG、WebChat 各一個（表單與精靈各一次）→ 重新整理仍在 → `webhookUrl` 正確 → 停用、啟用 → 刪除沒有對話的渠道成功、有對話的回 409。
2. 用只綁一個渠道、沒有 `channel.view_all` 的自訂角色：列表只看到自己的渠道；對其他渠道的 `GET/PATCH/DELETE /channels/:id`、`/verify` 應回 404（目前會成功，HC-CHANNELS-01）。
3. FB webhook：`GET /webhooks/fb/:id` 訂閱驗證正確 200、錯 403；以 `appSecret` 簽章送 POST，分別驗證「自己的粉專、改派給同 App 的渠道、不同 App 丟棄、沒人認領丟棄」四種結果與卡片警示。
4. Bot 設定存 `maxBotReplies` 10 → 重新整理讀回；超出 1～50 回 400；把對話 `botRepliesCount` 調到上限再進一則訊息，對話變 `AGENT_HANDLED`。
5. 用 supervisor（只有 `channel.view`）與 agent（沒有渠道權限）確認按鈕與 403。
- 自動測試：`pnpm --filter @open333crm/api test -- tests/unit/modules/channel tests/unit/services/channel-visibility tests/unit/modules/webhook/threads-webhook`；`pnpm --filter @open333crm/web test -- tests/unit/components/settings/channel tests/unit/components/settings/bot-config`；`pnpm --filter @open333crm/workers test -- plugin-registry`；`pnpm --filter @open333crm/channel-plugins test -- account-id-parsing threads-plugin`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/channel modules/meta-connect modules/webhook/webhook-account-routing migrations/backfill-unbound-channel-access`。
- E2E：`apps/web/tests/e2e-uat/tenant-settings-channels.spec.ts`。UAT 是正式環境：**不改渠道設定、不按「測試連線」**，開渠道管理頁會對 FB 打 Meta API，唯讀檢查時要攔截 `/status`。

## 常見 bug 從哪裡查
- 「渠道收不到訊息」：先看卡片的分派警示與權杖紅框（`apps/web/src/components/settings/ChannelAccountRouting.tsx`）；LINE 再看 Channel Secret 是否正確（測試連線只驗 Access Token，Secret 錯也顯示成功）；FB/IG 看 `externalAccountId` 是否已取得、Meta App 是否 Live。
- 「A 粉專的訊息跑到 B 租戶／B 渠道」：`apps/api/src/modules/webhook/webhook-account-routing.ts` 的 `routeWebhookMessages`；`META_WEBHOOK_ROUTING=legacy` 會退回只看網址。
- 「自動化在某渠道送不出去」：`apps/workers/src/lib/plugin-registry.ts` 有沒有該外掛，收件匣會有一則「系統未載入 … 渠道外掛」的失敗訊息。
- 「分店看得到／改得到別店渠道」：`apps/api/src/modules/channel/channel.routes.ts` 該路由有沒有呼叫 `assertChannelVisible`。
- 「權杖失效沒收到通知」：通知只寄給 `role` 為 `ADMIN` 的成員（RBAC-03 型問題），且只在「有效→失效」或距上次 72 小時才送；`apps/api/src/modules/channel/meta-token-health.ts`。
- 「背景圖換不上去」：上傳 API 回 400 但畫面不顯示；看瀏覽器 Network 的 `/chatbox-theme/background` 回應。
