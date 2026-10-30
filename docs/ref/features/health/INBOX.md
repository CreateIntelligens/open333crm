# 收件匣與對話 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只讀）
- 規格：`docs/ref/features/feature-map.json` 的 `inbox`；功能文件 `docs/ref/features/tenant/INBOX.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 5 份 spec、35 個 requirement、95 個 scenario。以 scenario 名稱比對測試名稱，95 個都找不到同名測試（行為多數有測，只是沒有照 scenario 命名）。確定沒做到 2 個（「與即時推播一致」2 個 scenario 中的 1 個、`fb-chat-media` 的錯誤碼）；與現況矛盾、需要改規格 2 處；缺前端入口 2 個（「Pagination respects updatedAt order」、影片傳送）。見[完備度對照](#完備度對照) |
| 自動測試 | unit：api 21 檔 117 通過、web 16 檔 96 通過，無失敗、無 skip。feature（搶鎖、不加 `--`）：`channel-scoped-visibility`、`route-permission-guards`、`inbound-message-processing`、`side-effect-claims` 4 檔 27 通過 |
| 實際操作 | 17 條流程。正常 5（流程 4、6、10、11、14，只有 P3 文案問題），異常 9（流程 1、2、3、5、7、8、9、13、17），待真機驗或未驗 3（流程 12、15、16） |

## 問題清單（依嚴重度）

P0、P1：無。HC-INBOX-01 的嚴重度在 P1 與 P2 之間，見該列說明。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| RBAC-04 | P2 | **已實測**：看不到某渠道的成員，socket 仍即時收到該渠道的 `message.new`，含訊息全文 | 本機：成員 `hc-inbox-none`（沒有 `channel.view_all`，沒有任何渠道授權）連 socket → 訂閱該對話房間被拒（`FORBIDDEN`，正確）→ WebChat 訪客傳「hc-inbox-訪客1 機密內容二」→ 該連線收到 `message.new`，`content.text` 為全文，另收到 `conversation.updated` | `apps/api/src/plugins/socket.plugin.ts`（自動加入 `tenant:` 房間）；`conversation.service.ts:411-412`；`webhook/inbound-socket-presenter.ts` | RBAC-04（AUDIT 記為「靜態確認」，可改為執行時確認） |
| HC-INBOX-01 | P2 | 對話列表只抓第一頁 50 筆，沒有分頁或「載入更多」。「未讀」「我的」與搜尋都在前端對這 50 筆過濾，第 51 筆以後在收件匣找不到。手冊已寫明限制並建議改到聯絡人頁找，但只有 WebChat 身分的聯絡人不在聯絡人清單（見 CONTACTS 健檢疑點 3），這個繞道對他們無效。**嚴重度**：手冊有揭露、有部分繞道，暫列 P2；進行中對話常態超過 50 筆的租戶等於主要功能失效，請主控判斷是否升 P1 | 本機：插入 55 筆 30 天內已關閉對話 → 「已關閉」分頁顯示 50 筆，捲到底仍 50 筆；API `meta.total` 56、`totalPages` 2，前端只送 `page=1&limit=50`。UAT Demo：近 30 天已關閉 93 筆，畫面顯示 50 筆（只讀確認） | `apps/web/src/hooks/useConversations.ts:130`；`apps/web/src/components/inbox/ConversationList.tsx:78-103` | 新 |
| HC-INBOX-02 | P2 | 重新開啟已關閉的對話，不檢查同一聯絡人在同一渠道是否已有未關閉的對話，結果同時有兩段未關閉對話；之後的新訊息進到其中一段，另一段擱在列表上。重新開啟也不清除 `closeReason`、`closeSource` | 本機：對話 C1 結案 → 訪客再傳訊，系統開新對話 C2 → 在 C1 按「重新開啟對話」（`PATCH {status:'ACTIVE'}`）→ C1、C2 都未關閉，列表出現兩筆「hc-inbox-訪客1」；訪客再傳訊進 C1，C2 停在 1 則訊息。C1 的 metadata 仍有 `closeSource: manual` | `conversation.service.ts:873-950`（`updateConversation` 沒有檢查）；`webhook/inbound-conversation-resolver.ts:20-28`（取 `lastMessageAt` 最新的一段） | 新 |
| HC-INBOX-03 | P2 | 指派負責人不驗證對象：停用的成員、看不到該渠道的成員都能被指派。被指派給停用成員時，負責人下拉顯示「未指派」；被指派給看不到渠道的成員時，他的「我的」分頁是空的、收到「收到新訊息」通知但點開 404 | 本機：`PATCH /conversations/C2 {assignedToId: <停用成員>}` 回 200 → 畫面負責人顯示「未指派」。`PATCH C1 {assignedToId: hc-inbox-none}` 回 200 → 以 hc-inbox-none 登入：「我的」顯示「沒有對話」、通知頁有「hc-inbox-訪客1 傳來新訊息」、socket 收到 `notification.new`（clickUrl `/dashboard/inbox?conv=C1`）、`GET /conversations/C1` 404。接管（`/handoff` 帶 `assignToId`）同樣不驗證 | `conversation.service.ts:898-903`、`668-673`；`apps/web/src/components/inbox/ChatWindow.tsx:77-86`（選項只有啟用成員） | 新 |
| HC-INBOX-04 | P2 | 收件匣的操作不依權限碼與渠道存取層級隱藏：結案、交回 Bot、接管、負責人與狀態下拉、輸入框、迴紋針、對話標籤、建立工單，按下才 403。存取層級不足時，畫面顯示英文「Forbidden: channel access level insufficient（需 full，實為 reply_only）」 | 本機：自訂角色只有 `inbox.view`（`hc-inbox-ro`）→ 所有按鈕可見、輸入框可打字，送出顯示「沒有送出：權限不足…」、改負責人顯示「權限不足…」。`read_only` 成員送出顯示「沒有送出：Forbidden: channel access level insufficient（需 reply_only，實為 read_only）」 | `apps/web/src/components/inbox/ChatWindow.tsx:241-300`；`MessageInput.tsx`；`apps/api/src/services/channel-visibility.ts:259`（英文訊息） | 新 |
| HC-INBOX-05 | P2 | `GET /conversations/:id` 回傳聯絡人**所有**渠道身分（uid、暱稱），不依渠道可見範圍過濾；`GET /contacts/:id` 已過濾。畫面右欄沒有顯示，問題在 API 回應 | 本機：替測試聯絡人加一個「健檢 LINE-A」身分 → `reply_only` 成員（只看得到 hc-inbox-WebChat）呼叫 `GET /conversations/C1`，`contact.channelIdentities` 含 `健檢 LINE-A / Uhcinbox0001 / hc-inbox-LINE暱稱`；同一人呼叫 `GET /contacts/<id>` 只回 WebChat 身分 | `conversation.service.ts:184-206`（`getConversation` 的 include） | RBAC-04 同類（與 HC-CONTACTS-10 同一缺口，路徑是新的） |
| HC-INBOX-06 | P3 | 狀態下拉沒有「Bot 處理中」選項：`BOT_HANDLED` 的對話，下拉顯示「進行中」，與旁邊的徽章「Bot 處理中」矛盾；此時選「進行中」不會觸發變更 | 本機與 UAT（只讀）：開一段 Bot 處理中的對話，下拉顯示「進行中」 | `ChatWindow.tsx:88-92` | 新（與 CONV-02 的標籤問題相關） |
| HC-INBOX-07 | P3 | 聊天視窗只載最近 50 則訊息，沒有「載入更早」。`useMessages` 已有 `loadOlder`，`ChatWindow` 沒有使用。手冊已寫明，建議改到聯絡人頁的對話紀錄 | 本機：在一段對話插入 60 則訊息 → 畫面顯示 47 則（50 則扣掉卡片類訊息），捲到頂沒有更多，最早的 #1 不顯示 | `apps/web/src/hooks/useMessages.ts:20, 70-95`；`ChatWindow.tsx:57` | 新 |
| HC-INBOX-08 | P3 | socket 更新列表時不套用目前的篩選：在「進行中」分頁結案的對話仍留在進行中列表，直到重新整理；狀態篩選也一樣 | 本機：「進行中」開 C2 → 結案 → 左欄 C2 仍在進行中列表最上方 | `useConversations.ts:201-232`（只合併欄位） | 新 |
| HC-INBOX-09 | P3 | 從網址開對話（通知的 clickUrl、重新整理、分享連結）不會標已讀；只有點列表列才標 | 本機：`/dashboard/inbox?conv=C2` 開啟 → 該列的未讀徽章仍是 1 | `ConversationList.tsx:69-73` | 新 |
| HC-INBOX-10 | P3 | 列表參數 `unread=false` 被當成 `true`（`z.coerce.boolean` 把非空字串都轉成 true）；`assigneeId` 不是 UUID 時回 400 `DATABASE_ERROR`「資料處理失敗」 | 本機：標一段已讀後，`?unread=false` 回 15 筆、不帶參數 16 筆；`?assigneeId=foo` 400 `DATABASE_ERROR`。前端不送這兩種值 | `conversation.routes.ts:122-130` | 新 |
| HC-INBOX-11 | P3 | API 允許對已關閉的對話送訊息（201，WebChat 訪客端收到，並更新 `lastMessageAt`）；`PATCH {status:'BOT_HANDLED'}` 可繞過「交回 Bot」的檢查（`botMode=off`、系統訊息、次數歸零）。畫面不提供這兩種操作 | 本機：C1 結案後 `POST /conversations/C1/messages` 回 201；`PATCH C1 {status:'BOT_HANDLED'}` 回 200，沒有寫系統訊息 | `conversation.service.ts:318-333`、`895-897` | 新 |
| HC-INBOX-12 | P3 | 媒體傳送的錯誤訊息是英文：「Unsupported file type. Allowed: …」「File exceeds 20 MB limit」「image push not yet supported for this channel type」。前端也讓 Instagram 對話送圖，後端回 501（手冊寫 Instagram 還不能傳圖片） | 本機：`send-image` 送 text/plain 400 英文；`send-video` 送 PNG 400 英文。Instagram 部分只讀程式 | `conversation.routes.ts:60-69, 94-97`；`MessageInput.tsx:172` | 新 |
| HC-INBOX-13 | P3 | AI 建議回覆失敗一律顯示「無法取得建議」，API 錯誤（額度用完、AI 未設定、403）被吞掉 | 讀程式；本機 `POST /ai/suggest-reply` 回 200 `suggestions: []`，畫面顯示「無法取得建議」 | `apps/web/src/components/inbox/AiSuggestPanel.tsx:32` | 新 |
| HC-INBOX-14 | P3 | 「正在輸入」沒有接通：前端不呼叫 `POST /conversations/:id/typing`；後端把 `typing.*` 發到 `conversation:` 房間，前端從不訂閱該房間，`TypingIndicator` 永遠收不到 | 讀程式：`grep typing apps/web/src` 只有 `TypingIndicator.tsx`；`grep "'subscribe'" apps/web/src` 沒有結果 | `conversation.routes.ts:378-392`；`apps/web/src/components/inbox/TypingIndicator.tsx` | 新 |
| HC-INBOX-15 | P3 | 沒有入口的程式：`HandoffModal`（指定接手人、自訂轉接訊息）在頁面上永遠不會開啟；`POST /conversations/:id/case` 與 `POST /cases/from-conversation/:id` 重複，前端只用後者；`/send-video` 沒有前端 | 讀程式：`page.tsx` 只有 `setShowHandoffModal(false)` | `apps/web/src/app/dashboard/inbox/page.tsx:22-33, 142-149` | 新 |
| HC-INBOX-16 | P3 | 對話已有工單時，右欄仍顯示「建立工單」，填完送出才 409「這則對話已建立過案件」；進行中的對話右欄不顯示已關聯的工單（只在已關閉時顯示結案資訊） | 本機：C1 已建工單 → 右欄「建立工單」→ 填標題、分類 → 對話框內顯示「這則對話已建立過案件」 | `apps/web/src/components/inbox/ContactInfoPanel.tsx:185, 319-326` | 新 |
| HC-INBOX-17 | P3 | 讀取對話失敗（404：看不到渠道或不存在）時，中間顯示「選擇對話」空狀態，沒有說明原因 | 本機：`hc-inbox-none` 開 `/dashboard/inbox?conv=C1` → 中間顯示「選擇對話／從左側面板選擇一個對話開始傳訊」 | `apps/web/src/app/dashboard/inbox/page.tsx:25-29`（SWR 錯誤未處理）；`ChatWindow.tsx:196` | 新 |
| HC-INBOX-18 | P3 | 結案紀錄不一致：CSAT 逾時關閉走 `closeConversationsForCase()`，只改狀態，不寫 `closeSource`、`closedAt`（功能文件寫記成 `csat`）；結案原因寫入後沒有任何畫面顯示；閒置關閉的原因是英文「Auto-closed after 72h of inactivity」 | 讀程式 | `conversation.service.ts:1041-1108`；`inactivity-close.worker.ts:45-48`；`apps/web/src` 沒有讀 `closeReason` | 新 |
| HC-INBOX-19 | P3 | 篩選與狀態文案：篩選 chip 顯示渠道原始代碼（`WEBCHAT`、`THREADS`），抽屜裡卻是「WebChat」「Instagram」；同一個 `AGENT_HANDLED`，篩選寫「等待客服」、表頭寫「已處理」；「進行中」分頁可勾「已關閉」狀態，結果顯示已關閉對話 | 本機：篩選 WebChat + 未指派 → chip「WEBCHAT」「未指派」；進行中勾「已關閉」→ 篩選結果 1 個對話（已關閉的 C2） | `FilterChips.tsx:59-62`；`FilterDrawer.tsx:24-29`；`ChatWindow.tsx:88-92, 219-224` | 新 |
| HC-INBOX-20 | P3 | 主規格自相矛盾與過時：`core-inbox` 的「Conversation Route Access Is Open to All Authenticated Roles」規定不加 RBAC、資料過濾延後，與同檔「對話、標籤、短連結路由依權限碼授權」及 `channel-scoped-visibility` 衝突；`fb-chat-media` 的「Non-LINE/FB channel type」沒有算進 WebChat，「Video file too large」要求 `FILE_TOO_LARGE`，實作回 `BAD_REQUEST` | 讀規格與程式 | `openspec/specs/core-inbox/spec.md:50-68`；`openspec/specs/fb-chat-media/spec.md:20-23, 41-44`；`conversation.routes.ts:67-69` | 新（規格） |
| CONV-02 | P2 | 指派仍不發布 `conversation.assigned`，被指派的人不會收到通知 | 讀程式：`grep "conversation.assigned" apps/api/src` 只有訂閱端 | `conversation.service.ts:873-950` | CONV-02（已記錄） |
| CONV-03 | P2 | 顧客要求轉真人時發布 `conversation.handoff`，沒有通知訂閱者；對話停在未指派 | 本機：WebChat 訪客傳 `handoff_request` → 對話變 `AGENT_HANDLED`、`handoffReason: user_requested_handoff`、寫系統訊息；沒有主管通知 | `webhook/inbound-postback-interceptors.ts:101-186` | CONV-03（已記錄） |
| CONV-01、TEAM-01、PLAN-12 | P2–P3 | 閒置時限沒有介面；`Conversation.teamId` 沒有寫入端；AI 輔助端點只驗登入 | 讀程式，與 AUDIT 描述一致 | — | 已記錄 |

### 實測時另外看到、不屬本領域的

- 行銷：只有 `inbox.view` 的成員開收件匣，模板挑選器以 `GET /marketing/templates` 取模板，回 403（需要 `marketing.view`），挑選器顯示「沒有找到模板」。手冊第 6 節已說明。
- 工單：CSAT 排程曾對一個 WebChat 渠道呼叫 `deliverToChannel()`，在 `decryptCredentials` 失敗（API log「Failed to decrypt credentials … Received undefined」）。`sendMessage()` 對 WEBCHAT 跳過解密，`deliverToChannel()` 沒有，請工單領域確認。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 列表、搜尋、篩選 | 本機、UAT | 正常：搜尋「機密內容」只剩相符的對話；WebChat + 未指派篩出 12 筆；已關閉分頁與 7/30/90 天切換 | `status=FOO`、`channelType=FOO`、`closedAfter=abc` 400 `VALIDATION_ERROR`；`page=0` 400；`limit=101` 400；`assigneeId=foo` 400 `DATABASE_ERROR`（HC-INBOX-10） | 沒有渠道授權的成員只看到授權給全員的渠道；`view_all` 看到全部。正常 | **異常**：只顯示 50 筆（HC-INBOX-01，UAT 也重現）；chip 顯示代碼（HC-INBOX-19） |
| 2 開對話、標已讀 | 本機 | 正常：點列表標已讀並推 `conversation.updated` | 看不到的渠道 404；畫面只顯示「選擇對話」（HC-INBOX-17） | `read_only` 可讀、可標已讀。正常 | 從網址開不標已讀（HC-INBOX-09）；只載 50 則（HC-INBOX-07） |
| 3 送文字 | 本機 | 正常：「hc-inbox UI 送出測試」送出，重新整理後仍在；WebChat 訪客端收到 | 空白 400「訊息內容不可為空白」；`contentType:foo` 400 | 後端：`inbox.view` 403 `inbox.reply`、`read_only` 403。**異常**：前端不隱藏（HC-INBOX-04） | 已關閉對話 API 仍可送（HC-INBOX-11） |
| 4 送圖片 | 本機（API） | 正常：8×8 PNG 送到 WebChat，201 | 文字檔 400（英文訊息）；副檔名偽裝的文字檔被內容檢查擋下（`INVALID_FILE_TYPE`）；`send-video` 送圖 400（英文） | 同流程 3 | HC-INBOX-12 |
| 5 接管對話 | 本機 | 正常：「接管對話」→ 狀態「已處理」、負責人 Admin、輸入框解鎖、訪客收到「稍等，正在為您轉接客服人員」 | 對 `ACTIVE` 對話接管 400「此對話目前不是由機器人接手」；`assignToId` 不存在 404 且不改狀態 | `reply_only` 403、`read_only` 403。**異常**：前端不隱藏 | `assignToId` 不驗證啟用與可見範圍（HC-INBOX-03） |
| 6 交回 Bot | 本機 | 正常：狀態回「Bot 自動處理中」、寫「Admin 把對話交回 Bot」 | 再交一次 400「對話已經由機器人處理」 | `full` 成員可；後端依層級擋 | `botMode=off` 的分支只讀程式（不改渠道設定） |
| 7 指派負責人 | 本機 | 正常：選 Admin 後重新整理一致 | 不存在的 UUID 404；非 UUID 400 | `reply_only`、`read_only` 403（英文訊息）、`inbox.view` 403 | **異常**：可指派停用成員與看不到渠道的成員（HC-INBOX-03）；不通知（CONV-02） |
| 8 改狀態、重新開啟 | 本機、UAT（只讀） | 正常：「進行中」「已處理」可存 | — | 同上 | **異常**：重新開啟造成兩段未關閉對話（HC-INBOX-02）；Bot 處理中顯示「進行中」（HC-INBOX-06） |
| 9 結案 | 本機 | 正常：填原因結案，metadata 有原因、來源 `manual`、結案人；重複結案冪等 | 原因 1001 字 400「最多 1000 個字」 | `reply_only` 403 | 結案後不會從進行中列表移出（HC-INBOX-08）；原因沒有畫面顯示（HC-INBOX-18） |
| 10 對話標籤 | 本機 | 正常：貼上後重新整理仍在、移除 | CONTACT 範圍的標籤 400 `TAG_SCOPE_MISMATCH`（英文，同 HC-CONTACTS-14）；重複移除 404 | `reply_only` 可貼（符合層級表）、`read_only` 403 | |
| 11 從對話建立工單 | 本機 | 正常：`POST /conversations/:id/case` 201 | 空標題 400；已建過 409 | `full` 才可 | 已有工單時按鈕仍顯示（HC-INBOX-16） |
| 12 AI 建議回覆 | 本機 | 本機沒有可用的 LLM，API 回 200 空陣列，畫面「無法取得建議」 | — | 只驗登入（PLAN-12） | 錯誤被吞（HC-INBOX-13）。真實建議內容待 UAT 或有金鑰的環境 |
| 13 即時更新 | 本機 | 正常：訪客傳「即時測試 RT1」，不重新整理就出現在聊天區與列表 | — | **異常**：看不到渠道的成員也收到 `message.new` 全文（RBAC-04） | 不套用篩選（HC-INBOX-08）；「正在輸入」沒接通（HC-INBOX-14） |
| 14 顧客要求轉真人 | 本機（WebChat） | 正常：訪客傳 `handoff_request` → `AGENT_HANDLED`、寫系統訊息、送轉接訊息 | — | — | 主管不會收到通知（CONV-03）。LINE／FB 按鈕待真機驗 |
| 15 機器人回覆、自動轉真人 | — | 本機沒有 LLM，訪客訊息只做了情緒分析，沒有機器人回覆 | — | — | 以 unit 測試（`auto-handoff`、`bot-reply-claim`、`keyword-suppresses-ai`）為準；待真機驗 |
| 16 閒置自動關閉 | — | 未驗（要等 72 小時或改 `TenantSettings`，屬租戶設定） | — | — | 讀程式 |
| 17 渠道可見範圍與層級 | 本機 | 正常：三種層級與「沒有授權」逐條符合 INBOX.md 的層級表（讀、回覆、管理） | 看不到 404、層級不足 403 | — | 層級不足的訊息是英文（HC-INBOX-04）；`GET /conversations/:id` 洩漏其他渠道身分（HC-INBOX-05） |

權限測試用的帳號（本機自建，名稱前綴 `hc-inbox-`）：

| 帳號 | 角色權限 | 渠道授權 |
| --- | --- | --- |
| hc-inbox-full | 自訂「hc-inbox-客服」：`inbox.view/reply/manage`、`agent.view`、`contact.view`、`tag.view`、`channel.view`、`case.view/create` | hc-inbox-WebChat `full` |
| hc-inbox-reply | 同上 | `reply_only` |
| hc-inbox-read | 同上 | `read_only` |
| hc-inbox-none | 同上 | 沒有 |
| hc-inbox-ro | 自訂「hc-inbox-唯讀」：`inbox.view`、`channel.view_all`、`channel.view`、`agent.view`、`contact.view` | 全部（`view_all`） |
| hc-inbox-off | 「hc-inbox-客服」，已停用 | 沒有 |

渠道授權直接寫入 `agent_channel_accesses`：建立成員的 API 只能給「建立者看得到的渠道、同樣的層級」，沒有替成員指定 `read_only`、`reply_only` 的介面（團隊授權可以指定層級，但沒有建立團隊的途徑，TEAM-01）。seed 的 agent 帳號沒有任何渠道授權，表現與 hc-inbox-none 相同。

## 完備度對照

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 沒做到或矛盾 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| core-inbox | 17 | 44 | 44 | 「Conversation Route Access Is Open to All Authenticated Roles」3 個 scenario 與現況矛盾（HC-INBOX-20）；「Status change reflects immediately in Select」對 `BOT_HANDLED` 不成立（HC-INBOX-06） | 「Pagination respects updatedAt order」：API 有分頁，前端從不請求第二頁（HC-INBOX-01） |
| channel-scoped-visibility | 6 | 14 | 14 | 「與即時推播一致／socket 與列表一致」沒做到（RBAC-04，已實測）；「團隊對話只限團隊成員操作」程式有，但沒有團隊可用（TEAM-01） | 有 |
| bot-handoff-config | 6 | 16 | 16 | 「Webhook intercepts handoff_request postback」的通知部分（CONV-03） | 機器人設定表單在渠道設定頁（channels 領域） |
| socket-room-authorization | 4 | 15 | 15 | 0（本次實測「對話的渠道看不到」訂閱被拒） | 前端不使用 `subscribe`（HC-INBOX-14） |
| fb-chat-media | 2 | 6 | 6 | 「Video file too large for FB」錯誤碼不符；「Non-LINE/FB channel type」過時（HC-INBOX-20） | 影片傳送沒有前端 |

「找不到同名測試」不等於沒有測試：例如 `channel-scoped-visibility` 的行為在 `apps/api/tests/feature/modules/channel/channel-scoped-visibility.test.ts` 有測，名稱不同。AGENTS.md 要求測試以 scenario 命名，這些 spec 尚未對齊。

**有後端、沒有前端入口**（與 Skill 一致，本次確認）：`/send-video`；`/typing`；`HandoffModal`；`POST /conversations/:id/case`；列表的 `assigneeId=<特定成員>`、`unread`；`useMessages.loadOlder`；`PATCH status: BOT_HANDLED`。收件匣沒有「內部備註」功能（`CaseNote` 屬於工單）。

**前端送出的值與後端 Zod**：狀態、渠道類型、`assigneeId`（自己或 `unassigned`）、`closedAfter`（ISO）、`{status: ACTIVE|AGENT_HANDLED}`、`{assignedToId: uuid|null}`、結案 `{reason?}`、訊息 `{contentType:'text', content:{text, quickReplies?}, privacyMode?}`，後端都接受。沒有發現前端送出、後端拒絕的值；唯一的例外是 Instagram 對話送圖片（前端允許、後端 501）。

## 待真機驗

- LINE、FB、Instagram 的客服回覆、圖片送達、轉接訊息送達；LINE 回覆走 push、計入額度（流程 3、4、5）。
- 顧客點「轉接客服」按鈕（LINE quick reply、FB postback）轉真人（流程 14）。
- 機器人回覆、自動轉真人（次數上限、關鍵字、媒體）、AI 建議回覆的實際內容（流程 12、15）：本機沒有可用的 LLM。
- 閒置自動關閉（流程 16）。
- 跨租戶指派（`assignedToId` 指向別的租戶的成員）：本機只有一個租戶，且本機以超級使用者連線、不受 RLS 限制，正式環境應被 RLS 擋下，未驗證。

## UAT 操作紀錄

只讀，沒有建立、修改或刪除任何資料，沒有 ledger 紀錄。登入 `admin@open333crm.dev` 後以 `/auth/me` 確認租戶為 Demo；開收件匣、切到已關閉分頁、開一段未讀數為 0 的 Bot 處理中對話（避免觸發標已讀）；Playwright 記錄的非 GET 請求為 0；結束後登出。持有 UAT 鎖約 1 分鐘。

## 建議新增到 AUDIT.md 的項目

- HC-INBOX-01：收件匣列表與聊天視窗只載 50 筆，沒有分頁（含 HC-INBOX-07）。
- HC-INBOX-02：重新開啟對話可造成同一聯絡人同一渠道有兩段未關閉對話。
- HC-INBOX-03：指派不驗證對象是否啟用、是否看得到該渠道。
- HC-INBOX-04：收件匣操作不依權限與存取層級隱藏，層級不足的訊息是英文。
- HC-INBOX-05：`GET /conversations/:id` 回傳不可見渠道的身分（可併入 RBAC-04 的表格）。
- RBAC-04：驗證狀態可由「靜態確認」改為「執行時確認」（本機以 socket 實測 `message.new` 送達沒有渠道授權的成員）。
- HC-INBOX-18：CSAT 關閉對話不寫結案紀錄。

## 文件過時之處

- `docs/ref/features/tenant/INBOX.md`「關閉對話」表：CSAT 逾時的 `closeSource` 寫 `csat`，程式不寫（HC-INBOX-18）。
- `docs/ref/features/tenant/INBOX.md` 沒有提到列表與聊天視窗各 50 筆的限制（手冊有），也沒有提到重新開啟可能產生兩段未關閉對話。
- `docs/ref/features/tenant/INBOX.md`「誰看得到哪些對話」沒有提到 `GET /conversations/:id` 的聯絡人身分未過濾。
- `openspec/specs/core-inbox/spec.md` 的「Conversation Route Access Is Open to All Authenticated Roles」應移除或改為 `MODIFIED`；`openspec/specs/fb-chat-media/spec.md` 的渠道範圍與錯誤碼（HC-INBOX-20）。
- `apps/web/public/manual/ch01-inbox.html` 第 2 節建議「改到聯絡人頁找」較舊的對話；只有 WebChat 身分的聯絡人不在聯絡人清單，這個方法找不到他們。
