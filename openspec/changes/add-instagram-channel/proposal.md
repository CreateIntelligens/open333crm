## Why

Instagram（IG/Threads DM）渠道的 **plugin 本體早已存在**（`packages/channel-plugins/src/threads.ts`，由 change `2026-03-18-multi-channel-billing` 的 `threads-channel` capability 定義並實作：verifySignature / parseWebhook / getProfile / sendMessage 皆為真實可用實作，非 stub）。`ChannelType` enum 也已有 `THREADS`。

**但這個 plugin 從未被接上線**——它只 export class、沒 export 實例、沒被 `registerChannelPlugin` 註冊、沒有 inbound webhook 路由、webhook secret 對應沒涵蓋它、`verifyChannel` 沒有它的分支、前端建立渠道的 wizard 也沒有它的選項。因此後台無法建立 IG 渠道、IG 訊息也無法進入系統。

本變更把既有的 threads-channel plugin **接上線**，讓 IG 成為可實際開通、收發訊息、觸發 AI 回覆的渠道。工作量集中在「接線」與少量 plugin 修補，不需重寫 plugin。

> 定位：這是「打開開關」型變更，延續既有 `threads-channel` capability，補完當初只做了 plugin、沒做接線的缺口。走 **IG Login 路線**（`graph.instagram.com` + `/me/messages`），plugin 現況即如此。

## What Changes

- **Plugin export**：`channel-plugins/src/index.ts` 新增 `export const threadsPlugin = new ThreadsPlugin()`（對齊 `fbPlugin`/`linePlugin`；目前只 export class）。
- **Plugin 修補**：`threads.ts` 的 `parseWebhook` 為每則訊息補上 `channelMsgId`（IG `message.mid`）——目前未帶，會導致 inbound 去重失效（FB plugin 有帶）。
- **註冊**：`apps/api/src/index.ts` 的 import 與註冊區加入 `threadsPlugin` + `registerChannelPlugin(threadsPlugin)`。
- **Inbound 路由**：`webhook.routes.ts` 新增 `GET/POST /threads/:channelId`。GET 為 Meta 的 webhook 驗證握手（比對 `hub.verify_token`、回 `hub.challenge`），POST 走與 FB 相同的「先回 200 → fire-and-forget `processWebhookEvent`」模式。
- **Secret 對應**：`webhook.service.ts` 的 signature secret 判斷從「FB → appSecret，其餘 → channelSecret」改為「FB **或 THREADS** → appSecret」（IG 驗簽用 App Secret 的 HMAC，與 FB 同）。
- **verifyChannel**：`channel.service.ts` 新增 `THREADS` 分支（呼叫 Graph `/me`，base 用 `graph.instagram.com`，驗證 pageAccessToken 有效）。
- **前端 wizard**：`ChannelWizard.tsx` 新增 IG 選項與憑證欄位（`appId` / `appSecret` / `pageAccessToken` / `verifyToken`）。
- **前端收件匣顯示**：多處寫死的 channelType→顯示 map 補 `THREADS`——`ChannelBadge`（收件匣列表/詳情/面板共用）、`FilterDrawer`（渠道篩選選項，**不補則 IG 對話篩不到**）、`ContactTimeline` 與 `CaseDetail`（**修既有把 key 誤寫為 `INSTAGRAM` 的 bug**）、`ContactMergeModal`、`ChannelDistributionChart`（配色）。
- **DB**：`ChannelType` enum 已有 `THREADS`，**不需 migration**。
- **憑證儲存**：沿用既有 `Channel.credentialsEncrypted`（AES-256），IG 憑證為 `{ appId, appSecret, pageAccessToken, verifyToken }`。

### 端到端實測後追加（2026-08-17）

真人 IG 私訊實測後，修補一批規劃時未預料的問題（詳見 tasks.md 第 11 節）。多數是「跨渠道通用缺口」被 IG 首次觸發暴露，修正 FB/LINE 亦受益：

- **建立/憑證**：`createChannelSchema` 與 simulator schema 補 THREADS enum（原漏列致 400）；驗證權杖可見化（建立完成頁 + 編輯視窗顯示 Callback URL 與 verifyToken）；憑證部分更新改合併（不洗掉未提交欄位）；webhookBaseUrl trim；欄位說明連結標籤依渠道自訂。
- **Webhook 事件**：非訊息事件（read/reaction/seen 無 `message.mid`）一律跳過，不再建空訊息或崩潰；echo 過濾（防 Bot 自問自答迴圈）。
- **收訊→Bot**：圖片等非文字訊息不做 KB 檢索（`message.received` 補傳 contentType + worker 守門）；inbound 去重補 `(conversationId, channelMsgId)` DB unique 約束 + P2002 併發處理；新聯繫人首則訊息併發 race 修正。
- **顯示**：前端 `extractMediaUrl` 補認 `mediaUrl`（IG 圖片顯示）；unknown 訊息不再顯示 `[object Object]`。
- **Meta 平台前提**：**App 必須發佈為 Live 才會收到 message webhook**（開發模式只送 read）；驗簽用「Instagram 應用程式密鑰」非 FB App Secret。

## Capabilities

### Modified Capabilities

- `threads-channel`: 從「僅 plugin 存在」補完為「可實際開通、收發、觸發 AI 回覆的已接線渠道」。

## Impact

- `packages/channel-plugins/src/index.ts`：export `threadsPlugin` 實例
- `packages/channel-plugins/src/threads.ts`：`parseWebhook` 補 `channelMsgId`
- `apps/api/src/index.ts`：import + 註冊 threadsPlugin
- `apps/api/src/modules/webhook/webhook.routes.ts`：新增 `/threads/:channelId` GET+POST
- `apps/api/src/modules/webhook/webhook.service.ts`：secret 對應加入 THREADS
- `apps/api/src/modules/channel/channel.service.ts`：`verifyChannel` 加 THREADS 分支
- `apps/web/src/components/settings/ChannelWizard.tsx`、`ChannelFormDialog.tsx`：IG 選項 + 憑證欄位（**兩套建立入口都要改**）
- `apps/web/src/components/ui/dialog.tsx`：修全站共用 Dialog 寬度隨內容變動的 bug（原生 `<dialog>` fit-content）
- `apps/web/src/components/shared/ChannelBadge.tsx`：badge map 補 THREADS（收件匣列表/詳情/面板共用）
- `apps/web/src/components/inbox/FilterDrawer.tsx`：渠道篩選選項補 THREADS（必改，否則篩不到 IG）
- `apps/web/src/components/contact/ContactTimeline.tsx`、`case/CaseDetail.tsx`：修 `INSTAGRAM`→`THREADS` key 錯誤
- `apps/web/src/components/contact/ContactMergeModal.tsx`、`analytics/ChannelDistributionChart.tsx`：渠道 label/color map 補 THREADS
- 渠道無關部分（inbound contact/conversation/message resolver、所有發送出口 `deliverToChannel` / kb-autoreply / csat / marketing、botMode、憑證加密、動態 webhookUrl）**零改動**——IG 自動獲得這些能力
- 計費：`ChannelUsage` / `getMessageFee` 目前仍 mock（見既有 `channel-billing`），IG 用量計費待整體計費落地，不在本變更範圍

### 端到端實測後追加的檔案（2026-08-17）

- `apps/api/src/modules/channel/channel.routes.ts`：`createChannelSchema` channelType 補 THREADS
- `apps/api/src/channels/simulator/simulator.routes.ts`：simulator channelType 補 THREADS
- `apps/api/src/modules/channel/channel.service.ts`：`getChannel` 憑證遮罩白名單（verifyToken/appId/pageId）、`updateChannel` 憑證合併、`updateWebhookBaseUrl` trim、`verifyChannel(IG)` 改走 Bearer header
- `packages/channel-plugins/src/threads.ts`：`parseWebhook` echo 過濾 + 無 mid 跳過、圖片同時帶 mediaUrl/url
- `apps/api/src/modules/webhook/inbound-side-effects.ts`：`message.received` 事件補傳 contentType
- `apps/api/src/modules/automation/automation.worker.ts`：KB 自動回覆只對純文字訊息
- `apps/api/src/modules/webhook/inbound-message-writer.ts`：channelMsgId 去重 + P2002 併發處理
- `apps/api/src/modules/webhook/inbound-contact-resolver.ts`：新聯繫人 channelIdentity P2002 併發處理
- `packages/database/prisma/schema.prisma` + migration `20260817000000_add_message_channelmsgid_unique`：`(conversationId, channelMsgId)` unique
- `apps/web/src/components/inbox/MessageBubble.tsx`：`extractMediaUrl` 補認 mediaUrl、unknown 訊息不顯示 [object Object]
- `apps/web/src/components/settings/ChannelFormDialog.tsx`、`ChannelWizard.tsx`：驗證權杖 + Callback URL 顯示、編輯 THREADS 憑證分支
- `apps/web/src/components/settings/ChannelFieldGuide.tsx`：`consoleLabel` 依渠道自訂連結文字

> ⚠️ 本 change 現含**兩個 migration**（`20260814..._agent_email_global_unique` 屬 [[add-tenant-aware-login]]、`20260817..._add_message_channelmsgid_unique` 屬本 change），部署前各自跑查重 SQL（已寫入 migration 註解）。

## Meta 帳號前提（非程式，需另行設定）

IG 帳號須為**專業帳號**（Business / Creator）；IG Login 路線需 IG 帳號授權、取得 pageAccessToken；Meta App 後台需訂閱 IG webhook 的 `messages` 欄位、設定 callback URL 為 `https://<host>/api/v1/webhooks/threads/{channelId}`。

**（實測校正 2026-08-17）收 message webhook 的真正門檻是「App 已發佈為 Live」，不是「通過 App Review」**：
- **開發模式（Development）**：即使測試人員互傳、訂閱 `messages`、密鑰全對，Meta 也**只送 `read` 等 metadata 事件，不送 message**。發佈為 Live 需先完成**商家驗證**（掛已驗證的 Business Portfolio 最快）。
- **`instagram_business_manage_messages` 的 Advanced Access（App Review）**：只有要服務「App 角色以外的真實客戶」時才需要。Standard Access + Live 下，測試人員/角色成員互傳即可收發（POC 階段夠用）。
- 驗簽用**「Instagram 應用程式密鑰」**（使用案例頁 test333-IG 那把）簽 `X-Hub-Signature-256`，**不是** FB App Secret。
