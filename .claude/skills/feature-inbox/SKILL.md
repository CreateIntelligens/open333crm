---
name: feature-inbox
description: >
  open333CRM「收件匣與對話」功能顧問：對話列表、訊息收發、接管與交回 Bot、指派、結案、AI 建議回覆、socket 即時更新、轉真人。改到 conversation／message 模組、/dashboard/inbox，或改渠道外掛送訊息之前使用。
---

# 收件匣與對話

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。收件匣的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

對話列表（進行中、已關閉、搜尋與進階篩選）、訊息收發（文字、快速回覆、模板、個資遮罩、圖片）、
接管對話與交回 Bot、指派負責人、改狀態與重新開啟、結案、對話標籤、AI 建議回覆、
socket 即時更新（`message.new`、`conversation.updated`）、渠道可見範圍與存取層級（CM-173、`read_only`、`reply_only`、`full`）、
轉真人（`handoff_request`、自動轉真人）、閒置自動關閉、`botConfig`。
相關的程式：`/dashboard/inbox`、conversation 模組、socket、channel-visibility、handoff、return-to-bot。
問題像「客服看不到對話」「訊息沒即時出現」「指派沒反應」「機器人不回」時使用。
改渠道外掛送訊息、從對話建立工單、通知、自動化的 `message.received` 之前也使用，確認不破壞收件匣。

## 先讀

先讀功能文件 `docs/ref/features/tenant/INBOX.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `INBOX.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、socket 房間的程式 | 程式的入口 |
| 對話狀態、新對話怎麼建立 | 對話的一生 |
| 機器人回覆、`botConfig`、重複處理同一則訊息 | 機器人什麼時候回覆 |
| 轉真人的各種方式、通知 | 轉真人 |
| 交回 Bot | 交回 Bot |
| 列表的分頁、篩選、搜尋、socket 更新列表 | 對話清單、篩選與搜尋 |
| 聊天視窗載入更早的訊息 | 聊天視窗的訊息 |
| 送訊息、送媒體、送出失敗 | 客服回覆怎麼送出 |
| 指派、狀態下拉 | 指派與狀態 |
| 結案、重新開啟、閒置關閉 | 關閉對話 |
| 渠道可見範圍、存取層級、即時事件的房間 | 誰看得到哪些對話；`docs/ref/modules/PERMISSIONS.md` |
| AI 輔助端點 | AI 輔助 |
| 權限碼 | 權限 |
| 前端頁面與元件 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的收件匣測試在 `apps/api/tests/unit/modules/conversation/`、`apps/api/tests/unit/modules/socket/`、`apps/web/tests/unit/components/inbox/`、`apps/web/tests/unit/lib/inbox/`，寫法可以照著參考。

`INBOX.md` 裡標 `HC-INBOX-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/INBOX.md`
- 規格：`openspec/specs/core-inbox/spec.md`、`openspec/specs/channel-scoped-visibility/spec.md`、`openspec/specs/bot-handoff-config/spec.md`、`openspec/specs/socket-room-authorization/spec.md`、`openspec/specs/fb-chat-media/spec.md`（完整清單見 `docs/ref/features/feature-map.json`）
- 手冊：`apps/web/public/manual/ch01-inbox.html`
- 影響分析：`node scripts/feature-impact.mjs --domain inbox`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `INBOX.md` 括號內的章節。

- 每條對話路由都要先檢查權限碼，再呼叫 `assertConversationChannelVisible(request, id, level)`。新增路由時，照 `conversation.routes.ts` 的 `perm` 表與層級：讀用 `read_only`，回覆類用 `reply_only`，管理類用 `full`。（程式的入口、誰看得到哪些對話）
- 看不到渠道時回 404，不可改成 403，否則會透露其他分店的對話存在。（誰看得到哪些對話）
- 呼叫 `listConversations()` 必須傳 `accessibleChannels`。（程式的入口）
- 一個聯絡人在一個渠道同時最多一個未關閉對話，`resolveInboundConversation()` 找不到才建新的。重新開啟目前會破壞這條（HC-INBOX-02），改相關程式時不要再擴大。（對話的一生、關閉對話）
- `closeConversation()` 以條件更新從未關閉改成已關閉，只有更新成功的那次發 `conversation.closed`。`updateConversation()` 收到 `CLOSED` 要呼叫它。（關閉對話、指派與狀態）
- `sendMessage()` 先寫入、後送出。送不出時寫 `deliveryFailed` 並再推一次 `message.new`。不要改成送不出就不寫入，也不要只寫 log。（客服回覆怎麼送出）
- 機器人回覆以 `bot_reply` + 入站訊息 id 認領（`bot-reply-guard.ts`）。認領與寫入在同一個交易，commit 之後才送出。（機器人什麼時候回覆）
- 交回 Bot 要把 `botRepliesCount` 歸零、清除 `handoffReason`，否則下一則訊息又轉真人。（交回 Bot）
- 渠道差異走 `getChannelPlugin()`。媒體的渠道白名單與 `sendMessage()` 的 WebChat 分支是既有例外，不要再加 `channelType` 分支（`AGENTS.md` 結構規則 5）。（客服回覆怎麼送出）
- socket 推播：直接 emit 只用在 HTTP 請求的直接結果，背景工作走 Redis `socket:emit`。帶訊息或對話資料的推播一律走渠道房間，不要往 `tenant:` 房間放訊息內容。新增會改變渠道授權的入口時，呼叫 `resyncChannelRooms()` 或 `fastify.syncSocketChannelRooms()`。（誰看得到哪些對話）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。

## 回歸清單

改到本領域時，至少重走：

1. WebChat 訪客傳訊（`POST /chatbox/sessions` → `/verify` → `/chatbox/messages`）→ 收件匣不重新整理就出現 → 接管 → 回覆（訪客端收到）→ 交回 Bot → 結案 → 已關閉分頁看得到。
2. 指派、改狀態、重新開啟、對話標籤，重新整理後讀回一致。
3. 用自訂角色（只有 `inbox.view`），以及三種存取層級的成員（`read_only`、`reply_only`、`full`，直接寫 `agent_channel_accesses`），重走 1–2：
   - 確認 403、404 與畫面訊息。
   - 沒有任何渠道的成員看不到對話。
4. socket（feature 測試 `modules/socket/socket-channel-rooms`）：
   - 看不到某渠道的成員連線，確認收不到該渠道的 `message.new`、`conversation.updated`。
   - 有授權的成員與總店收得到。
   - 後台改該成員的可用渠道後，不重新整理就開始或停止收到。
5. 分頁：
   - 進行中超過 50 段時按「載入更多對話」。第 2 頁的對話收到新訊息時移到最上面，而且不重複。
   - 搜尋第 51 段以後的聯絡人名稱，找得到。
   - 單一對話超過 50 則時按「載入更早的訊息」，看得到最早的一則，畫面不跳回底部。之後收到新訊息時捲到底，已載入的訊息不消失。
6. AI 與知識庫回覆都失敗（`ai-failure-handoff.test.ts`）：去識別化服務或 embedding 服務失敗時，`BOT_HANDLED` 對話的文字訊息轉真人。
   - 收件匣即時顯示轉接系統訊息與原因，客服收到轉接通知。
   - 同一則訊息重送時，不重複轉接。
7. 進站訊息未遮罩（feature 測試 `modules/webhook/inbound-deidentification-fallback`）：開啟遮罩、讓去識別化服務回 503，客人傳文字。確認：
   - 收件匣看得到原文訊息，對話轉真人。
   - 系統訊息寫「去識別化服務無法使用，這則訊息未遮罩、未交給 AI」，模型沒有被呼叫。
   - 點「轉接客服」按鈕照常轉接。

自動測試：

- `pnpm --filter @open333crm/api test -- tests/unit/modules/conversation tests/unit/modules/socket tests/unit/services/channel-visibility auto-handoff ai-failure-handoff bot-reply-claim return-to-bot ai-routes-channel-scope`
- `pnpm --filter @open333crm/web test -- tests/unit/components/inbox tests/unit/lib/inbox tests/unit/lib/socket`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/channel/channel-scoped-visibility route-permission-guards modules/webhook/inbound-message-processing modules/socket/socket-channel-rooms`
- E2E：`apps/web/tests/e2e-uat/tenant-inbox.spec.ts`

## 常見 bug 從哪裡查

- 「客服說看不到某段對話」：
  - 先查渠道可見範圍：`agent_channel_accesses`、`channel_team_accesses`、角色有沒有 `channel.view_all`（`apps/api/src/services/channel-visibility.ts`）。
  - 再查是不是還沒按「載入更多對話」（每頁 50 段）。
  - 對話被指派給看不到渠道的人時，他的「我的」也是空的（HC-INBOX-03）。
- 「訊息沒即時出現」：
  - API 直接 emit 看 `conversation.service.ts`。webhook 進站看 `apps/api/src/modules/webhook/inbound-socket-presenter.ts`。workers 走 Redis `socket:emit`，由 `socket.plugin.ts` 轉發。
  - 前端靠渠道房間收事件。成員看不到該渠道，或授權剛改而重新計算失敗（log `重新計算渠道房間失敗`）時收不到。重新整理（重新連線）即可。
- 「客服回了但顧客沒收到」：看訊息泡泡的紅字（`metadata.deliveryError`），再看 API log 的 `[ChannelDelivery]`。
- 「機器人不回、一直轉真人」：
  - 看渠道 `settings.botConfig`（預設值在 `packages/automation/src/bot-config.ts`）、`botRepliesCount` 與 `maxBotReplies`、`handoffKeywords`。處理在 `apps/api/src/modules/automation/automation.worker.ts`。
  - 對話不是 `BOT_HANDLED` 時，機器人一律不回。
  - 轉接原因是「AI 暫時無法回覆（…）」時，是 AI 與知識庫回覆都失敗（`ai-failure-handoff.flow.ts`）。查 API log 的 `[KbAutoReply]`、`[AgentRunner]`、`[AiFailureHandoff]`。
- 「指派了對方沒收到通知」：已知 CONV-02，`conversation.assigned` 沒有發布端。
- 「同一位顧客有兩段進行中的對話」：多半是重新開啟舊對話造成（HC-INBOX-02），或 IDENT-03 的同渠道雙身分。
- 「按了按鈕出現英文 Forbidden」：渠道存取層級不足（`CHANNEL_ACCESS_LEVEL_INSUFFICIENT`），訊息字串在 `channel-visibility.ts`（HC-INBOX-04）。
