---
name: feature-inbox
description: >
  open333CRM「收件匣與對話」功能顧問：對話列表、進行中／已關閉、搜尋與進階篩選、訊息收發（文字、快速回覆、
  模板、個資遮罩、圖片）、接管對話與交回 Bot、指派負責人、改狀態與重新開啟、結案、對話標籤、
  AI 建議回覆、socket 即時更新（message.new、conversation.updated）、渠道可見範圍與存取層級（CM-173、
  read_only／reply_only／full）、轉真人（handoff_request、自動轉真人）、閒置自動關閉。
  當需求、bug 或新功能碰到 /dashboard/inbox、conversation、message、socket、channel-visibility、
  handoff、return-to-bot、botConfig、「客服看不到對話」「訊息沒即時出現」「指派沒反應」「機器人不回」時使用。
  也在改渠道外掛送訊息、工單從對話建立、通知、自動化的 message.received 前使用，確認不破壞收件匣。
---

# 收件匣與對話

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/INBOX.md`
  - 注意：其中「CSAT 逾時關閉時 `closeSource` 記成 `csat`」與程式不符：CSAT 走 `closeConversationsForCase()`，只改狀態、不寫結案 metadata（見健檢 HC-INBOX-18）。
- 健檢結果與已知問題：`docs/ref/features/health/INBOX.md`
- 規格：`openspec/specs/core-inbox/spec.md`、`openspec/specs/channel-scoped-visibility/spec.md`、`openspec/specs/bot-handoff-config/spec.md`、`openspec/specs/socket-room-authorization/spec.md`、`openspec/specs/fb-chat-media/spec.md`（完整清單見 `docs/ref/features/feature-map.json`）
- 權限與可見範圍的計算：`docs/ref/modules/PERMISSIONS.md`
- 手冊：`apps/web/public/manual/ch01-inbox.html`
- 影響分析：`node scripts/feature-impact.mjs --domain inbox`

路由前綴：`/api/v1/conversations`（`apps/api/src/modules/conversation/conversation.routes.ts`）、`/api/v1/ai`（`apps/api/src/modules/ai/ai.routes.ts`）。
即時事件：`apps/api/src/plugins/socket.plugin.ts`（連線即加入 `tenant:<id>`、`agent:<id>`），訂閱授權在 `apps/api/src/modules/socket/socket-room-authorization.ts`。

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）。渠道存取層級：看不到的渠道一律 404，層級不足 403 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`。

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 列表、分頁籤、搜尋、進階篩選 | `/dashboard/inbox` 左欄（`ConversationList.tsx`、`FilterDrawer.tsx`） | `GET /conversations?status=!CLOSED\|CLOSED\|A,B&channelType&assigneeId&closedAfter&page=1&limit=50` → `listConversations`（依 `resolveChannelVisibility` 過濾） | 無。**只抓第一頁 50 筆，沒有分頁**；「未讀」「我的」與搜尋都只在這 50 筆裡做（前端過濾） | `inbox.view` + 渠道可見 / 不隱藏 |
| 2 | 開對話、讀訊息、標已讀 | 點列表列；或網址 `?conv=<id>`（通知的 clickUrl） | `GET /conversations/:id`、`GET /:id/messages?page=1&limit=50&order=desc`、`POST /:id/read` | `read` 推 `conversation.updated`。**只載最近 50 則**；從網址直接開不會標已讀 | `inbox.view` + `read_only` |
| 3 | 送文字（快速回覆、模板、AI 採用、個資遮罩） | 輸入框 Enter（`MessageInput.tsx`）；Bot 處理中或已關閉時輸入框鎖住 | `POST /:id/messages {contentType:'text', content:{text, quickReplies?}, privacyMode?}` → `sendMessage` | 先寫 OUTBOUND 再經渠道外掛送；失敗寫 `metadata.deliveryFailed` 並再推一次 `message.new`；有工單時寫首次回應；發 `message.sent` | `inbox.reply` + `reply_only` / **不隱藏** |
| 4 | 送圖片 | 迴紋針（PNG/JPG ≤20MB） | `POST /:id/send-image`（multipart）→ `handleSendMedia` → MinIO → `sendMessage` | 同上。LINE、FB、WebChat 可；前端也讓 Instagram 送，後端回 501（英文訊息） | `inbox.reply` + `reply_only` |
| 5 | 接管對話 | 「Bot 自動處理中」橫幅或輸入框上的「接管對話」 | `POST /:id/handoff {}` → `handoffConversation` | `BOT_HANDLED→AGENT_HANDLED`、指派給自己、送轉接訊息給顧客、寫系統訊息；只發 `conversation.updated`（不發 `conversation.handoff`） | `inbox.manage` + `full` / 不隱藏 |
| 6 | 交回 Bot | 表頭「交回 Bot」（AGENT_HANDLED、ACTIVE 才顯示） | `POST /:id/return-to-bot` → `returnConversationToBot` | 改回 `BOT_HANDLED`、`botRepliesCount` 歸零、保留負責人、寫系統訊息（不送顧客）；渠道 `botMode=off` 回 400 | `inbox.manage` + `full` / 不隱藏 |
| 7 | 指派負責人 | 表頭負責人下拉（選項來自 `GET /agents`） | `PATCH /:id {assignedToId: uuid\|null}` → `updateConversation` | 只改欄位、推 `conversation.updated`；**不發 `conversation.assigned`、不通知**（CONV-02）；**不檢查對象是否啟用、是否看得到該渠道** | `inbox.manage` + `full` / 不隱藏 |
| 8 | 改狀態、重新開啟 | 表頭狀態下拉（只有「進行中 ACTIVE」「已處理 AGENT_HANDLED」「已關閉」）；已關閉橫幅「重新開啟對話」 | `PATCH /:id {status}`；選「已關閉」改開結案視窗 | 重新開啟送 `{status:'ACTIVE'}`，**不檢查同聯絡人同渠道是否已有未關閉對話** | `inbox.manage` + `full` / 不隱藏 |
| 9 | 結案 | 表頭紅色「結案」或狀態選「已關閉」 | `POST /:id/close {reason?≤1000}` → `closeConversation` | 條件更新（只關一次）、寫 `metadata.closeReason/closeSource/closedAt/closedById`、發 `conversation.closed` | `inbox.manage` + `full` / 不隱藏 |
| 10 | 對話標籤 | 右欄「對話標籤」（`TagManager` targetType=CONVERSATION） | `POST /:id/tags {tagId}`、`DELETE /:id/tags/:tagId` → `tag.flow.ts` | 重複貼回 201（upsert） | `inbox.manage` + `reply_only` / 不隱藏 |
| 11 | 從對話建立工單 | 右欄「建立工單」（`CaseCreateModal`） | `POST /cases/from-conversation/:id`（工單領域）；`POST /conversations/:id/case` 是同功能、前端沒用 | 已有工單時 409「這則對話已建立過案件」 | `case.create`（+`case.assign`）+ `full` / 不隱藏 |
| 12 | AI 建議回覆 | 表頭燈泡（`AiSuggestPanel.tsx`），「採用」以 `ai-adopt` 事件帶入輸入框 | `POST /ai/suggest-reply {conversationId}` | 呼叫 LLM、計用量；失敗一律顯示「無法取得建議」 | 只驗登入（PLAN-12）+ `read_only` |
| 13 | 即時更新 | `SocketProvider`、`useConversations`、`useMessages` 監聽 `message.new`、`conversation.updated` | 來源：`sendMessage`、`inbound-socket-presenter.ts`、workers 經 Redis `socket:emit` | 列表就地合併欄位並重排；**不套用目前篩選**（已關閉的仍留在進行中，直到重新整理）。前端不訂閱 `conversation:` 房間，全部靠 `tenant:` 房間 | 租戶房間不套用渠道可見範圍（RBAC-04，已實測） |
| 14 | 顧客要求轉真人（系統） | 顧客點「轉接客服」或傳 `handoff_request`（文字也算） | `inbound-postback-interceptors.ts` `handleHandoffRequest` | `BOT_HANDLED→AGENT_HANDLED`、不指派、送 `handoffMessage`、發 `conversation.handoff`（沒有通知訂閱者，CONV-03）；`ACTIVE` 時只記 log、不回顧客 | — |
| 15 | 機器人回覆、自動轉真人（系統） | `message.received` → `automation.worker.ts` | `checkAutoHandoff`（次數上限、`handoffKeywords`、媒體）→ AI agent → `kb-autoreply.service.ts` | 以 `bot-reply-guard.ts` 認領，每則入站訊息最多一則機器人回覆 | — |
| 16 | 閒置自動關閉（系統） | 每 5 分鐘 `inactivity-close.worker.ts` | `closeConversation(source:'inactivity')` | 時限 `TenantSettings.inactivityCloseHours`，沒有介面（CONV-01） | — |

**有後端、沒有前端入口**：`POST /:id/send-video`；`POST /:id/typing`（前端不呼叫，`TypingIndicator` 也收不到，因為事件只發到沒人訂閱的 `conversation:` 房間）；`HandoffModal`（指定接手人、自訂轉接訊息）在頁面上永遠不會開啟；`POST /:id/case`；列表的 `assigneeId=<特定成員>`、`unread`；`useMessages` 的 `loadOlder`（載入更早訊息）沒有被 `ChatWindow` 使用；`PATCH` 的 `status: BOT_HANDLED`。

**前端實際送出的值**：狀態篩選 `ACTIVE|BOT_HANDLED|AGENT_HANDLED|CLOSED` 以逗號串接，或 `!CLOSED`；`channelType` 取自 `GET /channels` 的類型；`assigneeId` 只送自己的 id 或 `unassigned`；`closedAfter` 是 ISO 字串（今天往前 7/30/90 天）；狀態下拉只送 `ACTIVE`、`AGENT_HANDLED`；結案 `{reason?}`（空白不送）；接管 `{}`；訊息 `contentType:'text'`。後端 Zod 全部接受。注意 `unread=false` 會被 `z.coerce.boolean` 當成 `true`（前端不送 false）。

## 不可破壞的規則
- **兩層授權疊加**：路由的 `requirePermission('inbox.*')` 之外，每條對話路由都要呼叫 `assertConversationChannelVisible(request, id, level)`。新增路由時照 `conversation.routes.ts` 的 `perm` 表與層級（讀 `read_only`、回覆類 `reply_only`、管理類 `full`）。看不到回 404，不可改成 403（會透露他店對話存在）。
- 列表呼叫 `listConversations` 必須傳 `accessibleChannels`（漏傳編譯失敗是刻意的）。
- 一個聯絡人在一個渠道同時最多一個未關閉對話：`resolveInboundConversation()` 找不到才建新的。重新開啟目前會破壞這條（HC-INBOX-02），改相關程式時不要再擴大。
- `closeConversation()` 用條件更新「未關閉 → 已關閉」，只有搶到的那次發 `conversation.closed`；`updateConversation()` 收到 `CLOSED` 要走它（CONV-02 部分修正）。
- `sendMessage()` 是「先寫入、後送出」，送不出要寫 `deliveryFailed` 並再推一次 `message.new`；不要改成送不出就不寫入，也不要只寫 log（使用者看不到的失敗會被當成沒反應）。
- 機器人回覆以 `bot_reply` + 入站訊息 id 認領（`bot-reply-guard.ts`），認領與寫入同一交易、commit 後才送出。
- 交回 Bot 要把 `botRepliesCount` 歸零、清 `handoffReason`，否則下一則訊息立刻又轉真人。
- 渠道差異走 `getChannelPlugin()`；`conversation.routes.ts` 的媒體白名單與 `sendMessage` 的 WEBCHAT 分支是既有例外，不要再加 `channelType` 分支（AGENTS.md 規則 5）。
- socket 推播：直接 emit 只用在 HTTP 請求的直接結果；背景工作走 Redis `socket:emit`。租戶房間目前會把訊息內容送給看不到該渠道的成員（RBAC-04），新增推播不要再往 `tenant:` 房間放訊息內容。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain inbox` 看最新版本。重點：
- **依賴**：渠道（外掛收發、botConfig、可見範圍授權）、聯絡人（ContactInfoPanel、其他渠道的對話、代發連結）、成員（負責人清單、權限碼）、知識庫（AI 與 KB 自動回覆、AI 建議）、自動化（關鍵字讓出 AI）、工單（從對話建工單、CSAT 關對話）、行銷（模板、對話發券、handoff postback 攔截檔）、通知、設定（個資遮罩、營業時間、閒置時限）。
- **被依賴**：聯絡人（對話紀錄、合併搬對話）、工單與 SLA（首次回應時間）、自動化（`message.received`、`conversation.closed`）、行銷（券卡、群發訊息）、通知（clickUrl `/dashboard/inbox?conv=`）、數據分析、治理（匯出與刪除）。

## 回歸清單
改到本領域時，至少重走：
1. WebChat 訪客傳訊（`POST /chatbox/sessions` → `/verify` → `/chatbox/messages`）→ 收件匣不重新整理就出現 → 接管 → 回覆（訪客端收到）→ 交回 Bot → 結案 → 已關閉分頁看得到。
2. 指派、改狀態、重新開啟、對話標籤，重新整理後讀回一致。
3. 用自訂角色（只有 `inbox.view`）與三種存取層級的成員（`read_only`、`reply_only`、`full`，直接寫 `agent_channel_accesses`）重走 1–2，確認 403／404 與畫面訊息；沒有任何渠道的成員看不到對話。
4. socket：以看不到某渠道的成員連線，確認收不收得到該渠道的 `message.new`（RBAC-04 修好後應收不到）。
5. 進行中超過 50 筆、單一對話超過 50 則時的顯示（目前只顯示 50）。
- 自動測試：`pnpm --filter @open333crm/api test -- tests/unit/modules/conversation tests/unit/modules/socket tests/unit/services/channel-visibility auto-handoff bot-reply-claim return-to-bot ai-routes-channel-scope`；`pnpm --filter @open333crm/web test -- tests/unit/components/inbox tests/unit/lib/inbox tests/unit/lib/socket`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/channel/channel-scoped-visibility route-permission-guards modules/webhook/inbound-message-processing`。
- E2E：`apps/web/tests/e2e-uat/tenant-inbox.spec.ts`。

## 常見 bug 從哪裡查
- 「客服說看不到某段對話」：先查渠道可見範圍（`agent_channel_accesses`、`channel_team_accesses`、角色有無 `channel.view_all`，`apps/api/src/services/channel-visibility.ts`）；再查是否超過列表的 50 筆（`apps/web/src/hooks/useConversations.ts` 的 `limit = 50`）；被指派給看不到渠道的人時，他的「我的」也是空的。
- 「訊息沒即時出現」：API 直接 emit 看 `conversation.service.ts`；webhook 進站看 `apps/api/src/modules/webhook/inbound-socket-presenter.ts`；workers 走 Redis `socket:emit`，由 `socket.plugin.ts` 轉發。前端只聽 `tenant:` 房間。
- 「客服回了但顧客沒收到」：看訊息泡泡的紅字（`metadata.deliveryError`），再看 API log 的 `[ChannelDelivery]`。
- 「機器人不回／一直轉真人」：渠道 `settings.botConfig`（`packages/automation/src/bot-config.ts` 的預設值）、`botRepliesCount` 與 `maxBotReplies`、`handoffKeywords`；處理在 `apps/api/src/modules/automation/automation.worker.ts`。對話不是 `BOT_HANDLED` 時機器人一律不回。
- 「指派了對方沒收到通知」：已知 CONV-02，`conversation.assigned` 沒有發布端。
- 「同一位顧客有兩段進行中的對話」：多半是重新開啟舊對話造成（HC-INBOX-02），或 IDENT-03 的同渠道雙身分。
- 「按了按鈕出現英文 Forbidden」：渠道存取層級不足（`CHANNEL_ACCESS_LEVEL_INSUFFICIENT`），訊息字串在 `channel-visibility.ts`。
