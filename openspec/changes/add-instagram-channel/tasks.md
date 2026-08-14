## 1. Plugin：export 實例 + 修補去重

- [x] 1.1 `channel-plugins/src/index.ts` 新增 `export const threadsPlugin = new ThreadsPlugin()`（保留既有 `export { ThreadsPlugin }`）
- [x] 1.2 `threads.ts parseWebhook`：為每則 push 的 `ParsedWebhookMessage` 補 `channelMsgId: messaging.message?.mid`（type `InstagramMessaging.message.mid` 已定義），使 inbound 去重生效
- [x] 1.3 build `@open333crm/channel-plugins`（改動後 API 才吃得到）

## 2. API：註冊 plugin

- [x] 2.1 `apps/api/src/index.ts` 的 `import { ... } from '@open333crm/channel-plugins'` 加入 `threadsPlugin`
- [x] 2.2 在既有 `registerChannelPlugin(webchatPlugin)` 之後加 `registerChannelPlugin(threadsPlugin)`

## 3. API：inbound webhook 路由

- [x] 3.1 `webhook.routes.ts` 新增 `GET /threads/:channelId`：載入 channel、解密 credentials，比對 `hub.verify_token` 是否等於 `credentials.verifyToken`，符合則回 `hub.challenge`（照 FB 的 GET handler，L56-100）
- [x] 3.2 新增 `POST /threads/:channelId`：沿用 `addContentTypeParser` 的 rawBody 機制，立即 `reply.status(200)`，再 fire-and-forget `processWebhookEvent(prisma, io, channelId, CHANNEL_TYPE.THREADS, rawBody, headers).catch(logger.error)`（照 FB 的 POST handler）

## 4. API：secret 對應

- [x] 4.1 `webhook.service.ts` L72-74 的 secret 判斷改為：`(channelType === CHANNEL_TYPE.FB || channelType === CHANNEL_TYPE.THREADS) ? credentials.appSecret : credentials.channelSecret`（IG 驗簽用 App Secret 的 HMAC）

## 5. API：verifyChannel 分支

- [x] 5.1 `channel.service.ts verifyChannel` 在 FB 分支後、`UNSUPPORTED_CHANNEL` throw 前，加 `THREADS` 分支：以 `graph.instagram.com/v21.0/me?fields=id&access_token={pageAccessToken}` 驗證 token 有效，回傳驗證結果（照 FB 分支結構，base 改 graph.instagram.com）

## 6. 前端：建立渠道 UI（注意：有「兩套」建立入口）

> 規劃疏漏修正：渠道管理頁有兩個建立渠道入口——「設定精靈」用 `ChannelWizard.tsx`、「新增渠道」用 `ChannelFormDialog.tsx`，各有獨立的 channelTypeOptions / 憑證表單 / build credentials。兩套都要改，否則其中一個入口看不到 IG。

- [x] 6.1 `ChannelWizard.tsx`：`channelTypeOptions` 加 IG 選項 + 憑證表單 IG 分支 + build credentials THREADS 分支
- [x] 6.2 `ChannelFormDialog.tsx`：同樣三處（channelTypeOptions / 憑證表單 / create credentials THREADS 分支）——此為「新增渠道」實際用的對話框
- [x] 6.3 修全站共用 Dialog 寬度 bug：`components/ui/dialog.tsx` 的原生 `<dialog>` 預設 `width:fit-content`，寬度隨內容（不同渠道欄位數）變動。改 `<dialog>` 為 `w-fit`、`DialogContent` 的 `w-full`→`w-[calc(100vw-2rem)]`，讓 `max-w-*` 生效並固定寬度（實測 LINE/FB/IG/WebChat 皆 512px）。影響全站對話框（皆改善，各自 max-w 仍生效）

## 7. 前端：收件匣與各處渠道顯示（寫死清單，漏了 IG 會顯示異常/篩不到）

> 後端 API 原樣回傳 `channelType='THREADS'`，前端各處有寫死的 channelType→顯示 map，都缺 THREADS。漏了不 crash（有 fallback）但會印原始碼字串或漏渠道。

- [x] 7.1 `shared/ChannelBadge.tsx` `channelConfig` map（L16-22）補 THREADS（IG 圖示 + 品牌色）。此 badge 被 ConversationListItem / ContactInfoPanel / ChatWindow 共用，收件匣列表/詳情/面板一改全生效
- [x] 7.2 **（必改）** `inbox/FilterDrawer.tsx` `CHANNEL_OPTIONS`（L29-34）補 `{ value: 'THREADS', label: 'Instagram' }`，否則使用者無法在收件匣篩選 IG 對話
- [x] 7.3 `contact/ContactTimeline.tsx`（L24-32）：**既有 bug**，key 寫成 `INSTAGRAM` 但正式值是 `THREADS`，改成 `THREADS: 'Instagram'`
- [x] 7.4 `case/CaseDetail.tsx`（L93-101）：**既有 bug**，同樣 key `INSTAGRAM` → `THREADS`
- [x] 7.5 `contact/ContactMergeModal.tsx`（L75-80）label map 補 THREADS
- [x] 7.6 `analytics/ChannelDistributionChart.tsx`（L31-36）`CHANNEL_COLORS` 補 THREADS（IG 色，如 `#E4405F`）
- [x] 7.7 （低）`inbox/FilterChips.tsx`（L57-63）目前直接印 channelType code（LINE/FB 亦然），可選：改查 label map 美化
- [x] 7.8 （選）`shared/SimulatorPanel.tsx`（L89-91）測試模擬器渠道下拉補 THREADS，供本機模擬 IG 對話測試

## 8. IG 傳圖支援（三層：plugin 發圖 + 後端出口 + 前端白名單）

> IG 發圖與 FB 幾乎相同：`POST graph.instagram.com/v21.0/me/messages`，body `{ recipient:{id}, message:{ attachment:{ type:'image', payload:{ url } } } }`。限制 PNG/JPEG、8MB、一次最多 10 張。

- [x] 8.1 `threads.ts sendMessage`：加 image 分支——當 `content.mediaUrl`／`content.url` 存在（或 contentType 為 image）時，送 `message: { attachment: { type: 'image', payload: { url } } }`（照 FB `buildFbMessage` 的 image case）。保留既有 text + quick_replies 分支
- [x] 8.2 確認後端 `/send-image`（`conversation.routes.ts:331`）→ `deliverToChannel` 出口對 THREADS 走同一條路（渠道無關，應自動；驗證 contentType='image' 有正確帶 mediaUrl 給 plugin）
- [x] 8.3 `inbox/MessageInput.tsx`（L135）傳圖白名單 `[LINE, FB, WEBCHAT]` 加入 `THREADS`，讓 IG 對話顯示傳圖按鈕
- [x] 8.4 驗證：本機/UAT 對 IG 對話傳一張圖，確認 plugin 組出正確 attachment、IG 端收到圖

## 9. 驗證

- [x] 9.1 typecheck：channel-plugins / api / web 皆過
- [x] 9.2 本機：建一個 THREADS channel（可用假憑證），確認 webhookUrl 動態產生為 `.../webhooks/threads/{id}`、後台 wizard 能選 IG 並存憑證；收件匣 badge/篩選器正確顯示 IG
- [ ] 9.3 UAT 端到端（需真實 IG 專業帳號 + Meta App 設定）：Meta 後台訂閱 `messages`、設 callback URL、發測試私訊 → 確認進 inbox（badge 顯示 Instagram、可篩選）+ AI 回覆送回 IG。用 [[reference_facebook_developers_skill]] 排查心法驗證

## 10. 非本變更範圍（登記）

- [ ] 10.1 IG 用量計費（`getMessageFee` / `ChannelUsage` 目前 mock）— 待整體計費落地
- [ ] 10.2 IG 進階：影片/語音/檔案發送、story mention、per-tenant token 過期監控 — 視需求另開（本變更含圖片，不含影片等其他媒體）
