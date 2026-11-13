## 0. 前置

- [x] 0.1 確認 `fix-line-follow-unfollow-events` 已歸檔（2026-11-13 於本分支歸檔）（本 change 的 `first-contact-greeting`「首次進站時送出招呼語」MODIFIED 以它的版本為底）；未歸檔前不可歸檔本 change
- [x] 0.2 確認 `fix-meta-webhook-page-routing` 的狀態（2026-11-13：仍有 14 項長期待辦未歸檔，維持 ADDED）：已歸檔就把 `comment-reply-meta-subscription`「重新連結粉專時保留留言欄位」改寫成 `meta-page-connect` 的 MODIFIED（保留其既有 scenario 名稱）；未歸檔則維持本 change 的 ADDED，並在歸檔前再核對一次
- [x] 0.3 新增測試支援檔：`apps/api/tests/support/fake-meta-graph.ts`（依 host＋path＋method 設定回應、記錄每次呼叫、白名單外的 host 讓測試失敗）、`apps/api/tests/support/meta-webhook.ts`（組 FB／IG 留言與私訊 payload、算簽章、呼叫入口）、`apps/api/tests/support/comment-reply-fixtures.ts`（建租戶、方案、渠道、規則、角色與可見範圍，`afterAll` 刪除）；fixture 放 `packages/channel-plugins/tests/fixtures/meta-comments/`，「待實測」的錯誤碼在檔頭註明（2026-11-13：fixture 寫成 TS 模組以便檔頭註解；`comment-reply-fixtures.ts` 只含租戶、方案、渠道、角色、可見範圍，新資料表的 helper 留 TODO 給第 3 節之後）

## 1. 渠道外掛

- [x] 1.1 特性測試（重構前補，寫好就通過）：`packages/channel-plugins/tests/unit/facebook-send-message.test.ts`「Direct message unchanged」——斷言 `recipient: { id }`、`messaging_type` 與 body 其他欄位；以突變驗證（見 12.1）
- [x] 1.2 測試 `packages/channel-plugins/tests/unit/facebook-comment-events.test.ts`：「New comment on a post」「Comment by the page itself」「Comment without from」「Other feed changes」「Reply to another comment」；另加 `verb=remove` 回傳 `kind: 'remove'`
- [x] 1.3 測試 `packages/channel-plugins/tests/unit/threads-comment-events.test.ts`：「一般貼文留言」「自己帳號的留言」「廣告貼文留言」「直播留言」
- [x] 1.4 測試 `packages/channel-plugins/tests/unit/comment-private-reply.test.ts`：「Private reply body」「Token expired」「Network failure」「文字私訊」「非文字內容」；公開回覆 URL（FB `/{id}/comments`、IG `/{id}/replies`）；錯誤碼 10、200、551、100/33、613、500 的正規化
- [x] 1.5 測試 `packages/channel-plugins/tests/unit/comment-post-reference.test.ts`：「Numeric post ID」「Unrecognized input」；`{pageId}_{id}`、`/posts/<id>`、`story_fbid=`、`fbid=` 網址
- [x] 1.6 測試 `packages/channel-plugins/tests/unit/comment-subscription.test.ts`：FB `subscribeFields` 送出的 `subscribed_fields` 等於傳入的完整清單（排序後 deepEqual）並帶 `appsecret_proof`；IG 打 `graph.instagram.com/.../me/subscribed_apps`；自備 App 用渠道自己的 App Secret
- [x] 1.7 測試 `apps/workers/tests/unit/lib/plugin-registry-comments.test.ts`：「Comment extension available in both registries」
- [x] 1.8 實作：`packages/channel-plugins/src/index.ts` 型別（`ParsedCommentEvent`、`ChannelCommentExtension`、`CommentReplyCapabilities`、`MetaErrorInfo`）與 `extensions.comments`；FB 抽 `postMessage()`（design D6）後實作 `extensions.comments`；IG 實作；錯誤正規化（design「外掛契約」）
- [x] 1.9 `webhook-account-routing.ts` 的分派函式改泛型 `<T extends { accountId?: string }>`；既有 `webhook-account-routing.test.ts` 要過，並以突變驗證（見 12.2）

## 2. 比對與規則的純函式

- [x] 2.1 重構前先跑 `packages/automation/tests/unit/keyword-match.test.ts` 當基準；補「關鍵字回覆的 `＋１` 不命中 `+1`」案例（關鍵字回覆行為不變）
- [x] 2.2 測試 `packages/automation/tests/unit/keyword-match-normalize.test.ts`：「全形半形與大小寫」「全部關鍵字才命中」「短關鍵字包含比對」「只有貼圖的留言」
- [x] 2.3 實作：抽出 `matchKeywords(keywords, matchMode, text, { normalize })`；`matchKeywordTrigger()` 改呼叫它（`lowercase`），留言用 `nfkc`
- [x] 2.4 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply-match.test.ts`：「非指定貼文的留言」「兩條規則都命中」（純函式層）、停用與已刪除規則不命中、別的渠道的規則不命中、規則建立後才發布的貼文命中
- [x] 2.5 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply-expiry.test.ts`：「7 天前的留言」「安全邊際內」「6 天前的留言」「排隊到過期」（`now` 注入；邊際值以常數斷言）
- [x] 2.6 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply-content.test.ts`：「素材含留言者名稱與變數」「同一則留言重算選到同一則文字」
- [x] 2.7 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply.schemas.test.ts`：「關鍵字正規化後重複」「指定貼文卻沒有貼文」「開啟公開回覆但沒有文字」「沒帶公開回覆」（正反成對：合法值 parse 後值不變；`publishedAt` 用前端送的格式）
- [x] 2.8 測試 `packages/shared/tests/unit/comment-reply-codes.test.ts`：每個狀態、原因、警示代碼都有中文標籤
- [x] 2.9 實作：`comment-reply-match.ts`、`comment-reply-content.ts`、`comment-reply.schemas.ts`、`comment-reply.types.ts`、`packages/shared/src/comment-reply.ts`（design D8）；7 天期限另放 `comment-reply-expiry.ts`

## 3. 資料庫與 RLS

- [x] 3.1 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-rls.test.ts`：`app_tenant` 未綁租戶查 4 張新表 count = 0；綁 A 寫 `tenantId` 為 B 的列被擋；以 A 的 `tenantId` 參照 B 的 `channelId`／`ruleId`／`commentAuthorId` 外鍵錯誤；`(channelId, commentId)` 並行兩次只有一筆；去重部分唯一索引只在 `SENDING`／`SENT` 生效
  - 突變驗證（2026-11-13，直接改測試庫後還原）：dedupe 部分索引改成 `PENDING`／`SENT` → 兩個 dedupe 案例失敗；規則外鍵改單欄 → 「參照 B 的 ruleId」失敗；收回 `comment_reply_usages` 的 GRANT＋`comment_authors` 關 FORCE → 資料表設定與未綁租戶案例失敗；拿掉 `(channelId, commentId)` 唯一 → 並行案例失敗；`comment_reply_rules` policy 改 `true` → 3 個 RLS 案例失敗
- [x] 3.2 實作：schema（design「資料模型」）；migration `…_add_comment_reply_tables`（含部分索引、ENABLE＋FORCE RLS、`tenant_isolation`、明確 GRANT `app_tenant`）、`…_conversation_comment_origin`；`scripts/check-tenant-scoping.mjs` 的 `TENANT_MODELS` 加 4 個 model；`pnpm db:generate`
- [x] 3.3 確認 `platform-table-grants.test.ts`、`rls-isolation.test.ts` 通過

## 4. 收件

- [x] 4.1 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-intake.test.ts`（經真入口，真外掛，只攔 fetch）：「FB 留言命中規則」「舊模式渠道網址」「IG 留言命中規則」「沒命中規則」「粉專自己的留言」「方案不含留言自動私訊」「租戶沒有方案」「簽章錯誤」「一個請求帶兩個租戶的留言」「回呼網址與粉專屬於不同租戶」「同一請求有私訊與留言」「留言收件丟錯」「同一個請求重送三次」「兩個入口並行」「緊急停止後的留言」「緊急停止不影響私訊」「顧客刪除留言」「日誌不含留言內容」；另加：渠道停用、租戶停用、下游轉發 `immediate`、1,000 筆 feed changes 不超過 payload 上限且回應時間不因留言變長、沒有啟用規則的渠道不寫資料
  - 2026-11-13：經真入口（processPlatformMetaWebhook／processWebhookEvent，部分經 Fastify inject 打真的 webhook.routes）＋真外掛＋fake-meta-graph。修正前（留言分支拿掉）29 個測試 17 個失敗。另加「平台關閉 FB 私訊能力時不收件」
- [x] 4.2 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-intake.test.ts`：「手動輸入的貼文 ID 命中 webhook 留言」「從最近貼文挑選的 ID 命中 webhook 留言」「刪除後不再命中」「兩條規則都命中」「調整順序後套用新的第一條」
  - 2026-11-13：規則刪除、調整順序以直接改資料表＋`bumpCommentReplyRulesVersion()` 模擬後台路由（第 7 節）的異動，路由合併後可改打真路由
  - 2026-11-14（整合）：另加「試算與收件經真路由與真入口」三個測試：規則經真的 `/rules` 路由建立、排序、刪除、停用，留言經 webhook 收件（驗證兩組共用 `cr:rules-ver:<channelId>`）；突變：`bumpCommentReplyRulesVersion` 改遞增別的鍵 → 3 個測試失敗
- [x] 4.3 實作：`comment-reply-intake.service.ts`、`comment-reply-entitlement.ts`（方案 feature、能力開關、緊急停止，讀平台設定快取 60 秒）、`comment-reply-intake.flow.ts`（`inTenant`、`ON CONFLICT DO NOTHING`、`enqueueJob`）；規則快取與 Redis 版本號；`webhook.service.ts` 加留言分支（私訊之後、丟錯只記 `comment_intake_failed`）；`cr:last-event:<channelId>`
  - 2026-11-13：平台設定讀取沿用後台 API 組（wip/cr-routes）的 `comment-reply-platform-settings.ts`（`readCommentReplyPlatformSettings`，同一份檔案內容）；方案檢查用 `comment-reply-plan.ts` 的 `isCommentReplyPlanEnabled()`；規則來源 `listActiveRulesForChannel()`（與 cr-routes 同名同簽章，合併時收成一份）
  - 2026-11-14（整合）：`listActiveRulesForChannel()` 只留 `comment-reply-rule.service.ts`；規則版本號只留 `comment-reply-rule-cache.ts`；送出工作的排入收成 `comment-reply-enqueue.ts` 的 `enqueueCommentReplyDelivery()`（收件、重試、補回共用）
- [x] 4.4 測試 `apps/api/tests/feature/modules/webhook/webhook-shutdown-drain.test.ts`：關閉 app 時進行中的留言背景處理仍完成（design D3）；實作 in-flight 追蹤與 `onClose` 等待
  - 2026-11-13：`webhook-inflight.ts`；突變：拿掉 onClose 等待 → 測試失敗

## 5. 送出

- [x] 5.1 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply-delivery.flow.test.ts`（mock executor＋外掛替身）：每一種 SKIPPED 原因、「Meta 呼叫不在交易內」的步驟順序、`ALREADY_REPLIED` 在當機復原與非復原時的分支、限流延後不消耗 attempts、公開回覆的每一種子狀態、「工作資料只有識別欄位」
- [x] 5.2 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply-rate-gate.test.ts`：token bucket 補充與容量、渠道之間互不影響、Meta `retryAfterMs` 暫停、數字來自平台設定
  - 2026-11-13：算法以純函式 `takeFromBucket()` 測，Lua 由 feature「本小時額度用完」以真 Redis 驗證
- [x] 5.3 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-delivery.test.ts`（以 `index.ts` 同一個 runner 工廠處理 job）：「FB 文字規則送出成功」「IG 文字規則送出成功」「Meta 呼叫不在交易內」「素材含留言者名稱與變數」「排隊期間規則被停用」「排隊期間方案移除功能」「排隊期間素材被停用」「7 天前的留言」「Unix 秒的留言時間」「同一筆紀錄的工作執行兩次」「送出後寫結果前中斷」「權杖失效」「使用者無法接收」「測試階段的權限錯誤」「未對照的錯誤」「第一次網路錯誤第二次成功」「一直回 500」「本小時額度用完」「另一個渠道不受影響」「Meta 回限流一次」「私訊成功後公開回覆」「私訊失敗不公開回覆」「公開回覆缺權限」「公開回覆額度用完」「緊急停止時已排隊的工作」「關閉私訊能力後的排隊工作」「關閉公開回覆能力後送出」「測試階段不擋送出」；FB 素材規則站內路徑換公開網址；成功時沒有呼叫 `getProfile`
- [x] 5.4 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-dedupe.test.ts`：「同一人留五則」「關閉每人一次」「第一則失敗後的留言仍會嘗試」「同一人兩則留言並行」「不同規則各送一次」「已私訊過的詳情指出先前的紀錄」；規則刪除重建後會再私訊；第一則 `EXPIRED` 後會再嘗試
  - 2026-11-13：「第一則失敗後的留言仍會嘗試」改成兩則都在第一則失敗前收件（才測得到「收件時佔名額」的突變）
- [x] 5.5 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-quota.test.ts`：「本月已達上限」「並行不超賣」「Meta 明確拒絕不吃額度」「跨月重新計算」「升級後重試被上限略過的紀錄」；網路逾時後的額度不還；公開回覆不計入；同一筆紀錄重試不重複扣減
  - 2026-11-13：「升級後重試被上限略過的紀錄」的重試步驟以直接改回 PENDING＋重跑 job 模擬（重試路由屬第 7 節）
- [x] 5.6 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-queue-wiring.test.ts`：走真的 outbox relay＋BullMQ＋Redis，一則留言到 `SENT`（佇列名、job 名、job data 接線）
- [x] 5.7 測試 `apps/api/tests/feature/modules/queue-monitoring/comment-reply-failed-job.test.ts`：「資料庫錯誤重試用盡」；業務失敗（551）job 正常完成、沒有 `queue-failed` 告警
- [x] 5.8 實作：`comment-reply-delivery.service.ts`（認領、去重、額度、終態、還名額）、`comment-reply-delivery.flow.ts`（design「資料流」步驟 0～6、D9～D14）、`comment-reply-rate-gate.ts`（Redis Lua token bucket）、`comment-reply.worker.ts`；`apps/api/src/index.ts` 註冊 Worker（concurrency 5）；`COMMENT_REPLY_QUEUE` 加進 `API_QUEUES`
  - 2026-11-13：`COMMENT_REPLY_QUEUE` 加進 `API_QUEUES` 由後台 API 組（wip/cr-routes）完成；本分支的 `monitored-queues.test.ts`「API 行程的每個 Worker 都在監控清單內」要等兩邊合併才會過（2026-11-14 合併後通過）

## 6. 聯絡人與收件匣

- [x] 6.1 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-contact.test.ts`：「新留言者」「私訊失敗仍保留聯絡人」「舊顧客留言」「同一人兩則留言並行」「不送招呼語也不發建立事件」「新留言者私訊成功」「留言者 ID 與 PSID 不同」「PSID 已屬於舊顧客」「留言收件建立聯絡人時不發布」；IdentityMap 已拼接時建在拼接的聯絡人
- [x] 6.2 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-inbox-origin.test.ts`（經真的私訊 webhook）：「顧客回覆比寫結果先到」「顧客第一次回覆」「顧客再傳第二則」「兩則回覆並行」「echo 不重複」「一般私訊不受影響」「關聯步驟丟錯」「對話列表帶來源」「已有對話的顧客再次留言」「留言私訊後顧客第一次回覆」「留言建立的聯絡人第一次進站時發布一次」；30 天前的 SENT 不關聯；補入的訊息不改 `lastMessageAt` 與未讀數
  - 2026-11-13：「對話列表帶來源」呼叫 `listConversations()`（路由需登入，service 回傳的 `origin` 就是 API 的欄位）；另加「兩個關聯同時進行時只關聯一次」（12.15 的突變靠它）
- [x] 6.3 測試 `apps/api/tests/feature/modules/webhook/inbound-message-processing.test.ts`（擴充）：「留言者自己傳第一則私訊」「留言建立的聯絡人自己傳私訊」；一般 FB 新顧客第一次私訊仍送招呼語（正向迴歸）
  - 2026-11-13：三個情境放在 `comment-reply-inbox-origin.test.ts`（同一個真入口 processInboundMessage）；原檔以 WEBCHAT＋替換 deliverToChannel 測一般管線，接不了留言收件
- [x] 6.4 既有招呼語測試 `apps/api/tests/unit/modules/webhook/first-contact-greeting.test.ts` 與 `inbound-first-contact-resolver.test.ts` 保持通過；以突變驗證（見 12.3）
  - 2026-11-13：`first-contact-greeting.test.ts`、`inbound-first-contact-resolver.test.ts` 通過；`inbound-message-refactor.test.ts` 的原始碼字串斷言隨 processInboundMessage 多帶 tenantPrisma 更新
- [x] 6.5 實作：`comment-reply-contact.service.ts`（design D16，P2002／ON CONFLICT 處理、合併引擎 `source='COMMENT_REPLY'`）、`comment-reply-inbox.service.ts`（`attachCommentOrigin`，design D18）、`webhook/inbound-comment-origin.ts`；`processInboundMessage()` 帶租戶 executor 並在落地後呼叫；`resolveInboundContact()` 新 UID 先查 `comment_authors`；招呼語排除與 `contact.created` 補發（design D17）；對話列表 API 回 `origin`
  - 2026-11-13：留言建立的聯絡人判斷（`resolveCommentContactEvent`）只在有留言擴充的 FB／IG 渠道做（取捨見程式註解）

## 7. 後台 API

- [x] 7.1 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-rule-routes.test.ts`：「建立 FB 文字規則並讀回」「選 LINE 渠道」「沒有 manage 權限」「IG 規則選素材」「選收據範本素材」「其他租戶的素材」「文字含顧客專屬券連結」「沒有行銷權限也能選素材」「IG 渠道沒有素材選項」「修改時帶渠道」「無法辨識的貼文參照」「平台未開放公開回覆」「排序清單少一條」「試算與收件結果相同」「只有檢視權限試算」「分店帳號只看到自己渠道的規則」「讀看不到的渠道的規則」「唯讀層級修改規則」「其他租戶的規則」「IG 私訊尚未開放」「方案不含時路由被擋」「平台勾選後可用」；渠道外掛不支援公開回覆時 400；排序 ids 重複 400（2026-11-13：32 個測試；「試算與收件結果相同」目前比對試算與收件共用的 `listActiveRulesForChannel()`＋`matchCommentRule()` 結果，收件 flow 合併後應再補一次經 webhook 的比對（2026-11-14 已補：`comment-reply-intake.test.ts`「試算與收件結果相同」經真路由與真 webhook 入口）；「方案不含時路由被擋」另在 `requirePermission` 加 `details.reason: PLAN_FEATURE_NOT_INCLUDED`）
- [x] 7.2 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-rule-limits.test.ts`：「建立第三條啟用規則」「以停用狀態建立」「停用一條後再啟用」「方案沒有設定上限」「降級後超過上限」；`PATCH /rules/:id` 把 isActive 改 true 也被擋；已刪除規則不計入；覆寫值優先
- [x] 7.3 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-log-routes.test.ts`：「分店帳號只看到自己渠道的紀錄」「讀看不到的渠道的紀錄」「沒有檢視權限」「沒有收件匣權限」「重試可重試的失敗」「重試不可重試的失敗」「重試已送出的紀錄」「重試已過期的留言」「重試觸發紀錄時寫稽核」；`q` 搜尋、cursor 分頁穩定、`countOnly`（2026-11-13：「重試可重試的失敗」斷言紀錄改回 PENDING 並以 `deliver` 排入 `comment-reply`，「工作執行成功後是 SENT」待送出消費者；2026-11-14 已補：`comment-reply-quota.test.ts`「重試可重試的失敗」經真的重試路由排入、真 runner 執行到 SENT，「升級後重試被上限略過的紀錄」也改打真路由；突變：`retryLogFlow` 拿掉排入 → 2 個測試失敗）
- [x] 7.4 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-channel-routes.test.ts`：「用量與上限」「Meta 回應很慢」「自備 App 的渠道」「只列看得到的渠道」「FB 開啟留言接收」「IG 開啟留言接收」「自備 App 的渠道用自己的密鑰」「缺渠道修改權限」「Meta 回權限錯誤」「Meta 回其他錯誤」「關閉後只剩私訊欄位」「權杖失效」「平台未開放貼文挑選」「解析 FB 貼文網址」「任意外部網址」「沒有設定時的預設」「關閉測試階段」
- [x] 7.5 測試 `apps/api/tests/feature/modules/meta-connect/meta-connect-comment-fields.test.ts`：「已開啟接收的粉專重新連結」「未開啟接收的粉專重新連結」「方案不含功能時新連結」「站內路徑」「外部網址」；方案含功能且 `fbPrivateReply` 開啟時新連結訂 `feed`；欄位清單另以一份字面清單比對（測試註解寫明理由）（2026-11-13：returnTo 由 callback 帶給渠道頁 `?metaConnect=…&returnTo=…`，前端渠道頁連結完成後導回的部分尚未實作）
- [x] 7.6 測試 `apps/api/tests/feature/modules/tenant-audit/comment-reply-audit.test.ts`：「建立留言規則時寫稽核」；修改、刪除、啟用切換、排序、開關留言接收各寫一筆，payload 不含留言內容
- [x] 7.7 實作：`comment-reply-rule.service.ts`、`comment-reply-log.service.ts`、`comment-reply.flow.ts`、`comment-reply-rule.routes.ts`、`comment-reply-log.routes.ts`、`comment-reply-channel.routes.ts`（design「API」）；權限點（design D20）與預設角色；`meta-connect.service.ts` 的 `BASE_SUBSCRIBED_FIELDS`、`subscribedFieldsFor()`、可傳欄位的 `subscribePage()`、`returnTo`（design D19）；租戶稽核（design D24）；`apps/api/src/index.ts` 註冊路由（2026-11-13：另有 `comment-reply-channel.service.ts`、`comment-reply-access.ts`、`comment-reply-request.ts`、`comment-reply-plan.ts`；重試以 `requeueCommentReplyLog()` 排入）

## 8. 資料治理

- [x] 8.1 測試 `apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts` 與 `apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`（擴充）：「匿名化清除留言自動私訊的個資」「硬刪除刪除留言自動私訊紀錄」；既有 scenario 保持通過
- [x] 8.2 測試 `apps/api/tests/feature/modules/data-export/data-export-flow.test.ts` 與 `apps/workers/tests/unit/handlers/data-export.handler.test.ts`（擴充）：「匯出含留言自動私訊資料」；匯出不含權杖
- [x] 8.3 測試 `apps/api/tests/feature/modules/contact/comment-reply-merge.test.ts`：「Comment private reply joins the contact created from a comment」「Comment author moved back on reversal」「合併後顯示存活者」「解除合併後顯示原本的人」
- [x] 8.4 實作：`apps/workers/src/handlers/data-erasure.handler.ts`、`data-export.handler.ts` 加新表（design D27）；`contact-merge.service.ts` 搬 `comment_authors.contactId` 並記入合併紀錄、解除合併搬回

## 9. 平台層

- [x] 9.1 測試 `apps/api/tests/feature/modules/platform/platform-comment-reply-settings.test.ts`：「寫入合法的能力開關」「寫入不合法的值」；5 個鍵各一組合法與不合法值
- [x] 9.2 測試 `apps/api/tests/feature/modules/platform/platform-comment-reply-health.test.ts`：「健康表只列開啟接收的渠道」「非平台身分」；24 小時統計與佇列數量（2026-11-13：服務在 `modules/platform/comment-reply-health.service.ts`，已在 check-prisma-admin-usage 白名單 `modules/platform/` 內，不需另加）
- [x] 9.3 測試 `apps/api/tests/feature/modules/platform/comment-reply-plan-feature.test.ts`：「部署後既有方案都不含」；`/platform/registry` 回傳 `comment_reply` 與兩個權限點；平台在方案勾選後權限天花板放行（快取失效）
  - 突變驗證：`updatePlan` 拿掉 `invalidatePlanPermissions` → 「勾選後天花板放行」失敗；seed 的 light 方案加 `comment_reply` → 「部署後既有方案都不含」失敗
- [x] 9.4 測試 `apps/api/tests/unit/modules/platform/plan-limits.test.ts`（擴充）：兩個新上限鍵依「有效上限解析」解析（覆寫優先、null 無上限）
  - `LimitKey` 改由匯出的 `LIMIT_KEYS` 推導；解析邏輯本來就是泛型，所以除了「上限鍵清單」外的案例寫好就通過（對照既有的覆寫優先、null 無上限突變）
- [x] 9.5 既有 `apps/api/tests/unit/modules/queue-monitoring/monitored-queues.test.ts` 加入 `comment-reply` 後先紅再綠；測試 `apps/api/tests/feature/modules/queue-monitoring/comment-reply-queue-list.test.ts`：「列出留言自動私訊佇列」（2026-11-13：`API_QUEUES` 已加、新測試紅轉綠；「API 行程的每個 Worker 都在監控清單內」要等送出消費者以 `[COMMENT_REPLY_QUEUE]` 註冊進 `startQueueWorkers()` 才通過，所以未勾）（2026-11-14 合併後通過，`index.ts` 以 `[COMMENT_REPLY_QUEUE]` 註冊）
- [x] 9.6 測試 `apps/api/tests/feature/modules/role/reconcile-comment-reply-permissions.test.ts`：跑 reconcile 腳本後既有租戶的 ADMIN、SUPERVISOR system role 有 view＋manage，AGENT 有 view（依 Open Questions 2 定案）（2026-11-13：腳本從 repo 根目錄解析不到 workspace 套件，測試呼叫腳本所用的 `seedRolesForTenant()` 並核對腳本呼叫它）
- [x] 9.7 元件測試 `apps/web/tests/unit/components/admin/plan-limit-keys.test.tsx`：「設定上限並讀回」（兩個上限欄位，留空送 null）
- [x] 9.8 元件測試 `apps/web/tests/unit/components/admin/comment-reply-platform-settings.test.tsx`：「從頁面存設定」；緊急停止開關、限速與保存天數的範圍錯誤訊息；健康表渲染
- [x] 9.9 實作：`packages/core/src/rbac/features.ts` 加 `comment_reply`（不寫方案資料 migration，design D23）；`plan-limits.service.ts` 的 `LimitKey`；`/admin/plans` 的 `LIMIT_KEYS`；`platform.routes.ts` 的 5 個鍵型別驗證與 `comment-reply-platform-settings.ts`（解析函式，租戶端共用）；`GET /platform/comment-reply/health`（加進 `check-prisma-admin-usage.mjs` 白名單）；`/admin/comment-reply` 頁與平台側欄入口
  - 部分完成（wip/cr-db）：`features.ts` 的 `comment_reply`、`LimitKey`／`LIMIT_KEYS`、權限點 `comment_reply.view`／`comment_reply.manage` 與預設角色；`/admin/plans` 的 `LIMIT_KEYS`、5 個平台設定鍵、健康 API、平台頁尚未做

## 10. 維運排程

- [x] 10.1 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-recover.test.ts`：「Redis 裡的工作不見了」「卡住超過 7 天」；`SENDING` 超過 2 分鐘重新排入
- [x] 10.2 測試 `apps/api/tests/unit/modules/comment-reply/comment-reply-health.test.ts`：「權杖連續失效」「卡住的處理中紀錄」「限流排隊不告警」；失敗率告警排除使用者端原因；驗簽失敗告警
  - 2026-11-13：「限流排隊不告警」另以 feature（comment-reply-recover.test.ts「限流排隊的紀錄不算卡住」）驗證統計查詢
- [x] 10.3 測試 `apps/api/tests/unit/modules/channel/meta-token-health.test.ts`（擴充）：「Meta 取消了 feed 訂閱」「查詢時網路錯誤」
- [x] 10.4 測試 `apps/api/tests/feature/modules/comment-reply/comment-reply-retention.test.ts`：「超過保存天數的紀錄」；每月用量保留 25 個月
- [x] 10.5 實作：API `job-scheduler` 註冊 `comment-reply-recover`（5 分鐘）、`comment-reply-health`（5 分鐘，含 `lastCommentEventAt` 同步）、`comment-reply-retention`（每小時），皆 `withoutOverlapping`；`meta-token-health` 加訂閱檢查（design D25、D26）；補訂閱腳本 `apps/api/src/scripts/comment-reply-subscriptions.ts`（`--dry-run` 預設，加進白名單）
  - 2026-11-13：補訂閱腳本的欄位暫以 `SUBSCRIBED_FIELDS`＋`feed`／IG `messages`＋`comments` 組成，7.7 的 `subscribedFieldsFor()` 合併後改用它（2026-11-14 已改：FB 用 `subscribedFieldsFor()`、IG 用 `IG_BASE_SUBSCRIBED_FIELDS`＋`IG_COMMENT_FIELD`；原本引用不存在的 `SUBSCRIBED_FIELDS` 讓 `pnpm build` 失敗）

## 11. 前端

- [x] 11.1 元件測試 `apps/web/tests/unit/components/comment-replies/comment-reply-rule-editor.test.tsx`：必填錯誤文案與焦點、重複關鍵字、短關鍵字提示仍可儲存、比對方式只在 2 個以上關鍵字時顯示、IG 停用素材選項、指定貼文未選、超過 7 天的貼文提示、公開回覆未填文字、缺公開回覆權限時停用、編輯時渠道唯讀、後端 `details.field` 顯示在欄位下、離開確認、儲存成功訊息不含勾勾；「前端隱藏未開放的能力」；沒有 `marketing.view` 時素材選項仍可用
- [x] 11.2 元件測試 `apps/web/tests/unit/components/comment-replies/comment-reply-rule-list.test.tsx`：只有 view 時沒有建立、排序、刪除；空狀態 F；`OVER_PLAN_LIMIT` 警示
- [x] 11.3 元件測試 `apps/web/tests/unit/components/comment-replies/comment-reply-test-panel.test.tsx`：試算命中與未命中的文字，只呼叫 `/rules/test`
- [x] 11.4 元件測試 `apps/web/tests/unit/components/comment-replies/comment-reply-logs.test.tsx`：7 種狀態與「排隊中」「可能已送達」的顯示、未知原因代碼、篩選同步 URL、重試按鈕的出現條件與確認文案、「到收件匣查看對話」的權限條件、留言內容含 `<script>` 以純文字顯示
- [x] 11.5 元件測試 `apps/web/tests/unit/components/comment-replies/comment-reply-readiness-card.test.tsx`：空狀態 A（沒有渠道、渠道都不在可見範圍）、B（未開啟接收）、C（權限不足；IG 顯示重新產生權杖）、D（測試階段；自備 App 不顯示）、E（方案未含）、平台暫停中
- [x] 11.6 元件測試 `apps/web/tests/unit/components/inbox/conversation-comment-origin.test.tsx`：「來自留言」標籤（顯示期間依 Open Questions 6）、「查看留言紀錄」連結只對有 `comment_reply.view` 顯示
- [x] 11.7 既有 `apps/web/tests/unit/components/settings/role-permission-matrix.test.tsx` 出現「留言自動私訊」群組；`apps/web/tests/unit/app/no-emoji-in-ui.test.ts` 涵蓋新頁面
- [x] 11.8 實作：`/dashboard/comment-replies`（規則、觸發紀錄分頁）、`/new`、`/[ruleId]`；側欄「行銷與渠道」入口（`comment_reply.view`）；前置條件卡；收件匣標籤與系統訊息連結；共用代碼表的中文標籤

- [x] 11.9 回歸：MODIFIED 需求既有的 scenario（`channel-plugins`、`first-contact-greeting`、`inbound-contact-resolution`、`contact-management`、`tenant-data-erasure`、`tenant-data-export`、`queue-monitoring`、`tenant-audit-log`）由既有測試涵蓋，改動後全部重跑通過：`inbound-message-processing.test.ts`、`webhook-account-routing.test.ts`、`first-contact-greeting.test.ts`、`line-system-events.test.ts`、`contact-merge-routes.test.ts`、`contact-merge-same-channel.test.ts`、`data-erasure-flow.test.ts`、`data-export-flow.test.ts`、`failed-event.test.ts`、`tenant-audit.test.ts`、`meta-connect.test.ts`、`meta-connect-routes.test.ts`、`automation-keyword-scope.test.ts`
  - 2026-11-14（整合）：全部在 `pnpm test`（api 1930、workers 177 通過）與 `pnpm test:feature`（api 185 檔、1835 個測試通過，獨立資料庫 `open333crm_test_crmerge`）中重跑通過

## 12. 突變驗證（寫好就通過或需確認測到那一道檢查）

- [x] 12.1 `postMessage()` 把 `recipient: { id }` 改成 `{ comment_id }` 或拿掉 `messaging_type`：「Direct message unchanged」失敗（2026-11-13 實測：main 的 body 本來就沒有 `messaging_type`，改以「多加 `messaging_type`」突變；兩種突變都讓 2 個測試失敗）
- [x] 12.2 泛型分派忽略 `accountId`：`webhook-account-routing.test.ts` 與「回呼網址與粉專屬於不同租戶」失敗（前半 2026-11-13 完成：`routeWebhookMessages` 忽略 accountId → 14 個測試 11 個失敗；`routePlatformMessages` 的同類突變現有測試抓不到（都是單一粉專 payload），留給「回呼網址與粉專屬於不同租戶」）
  - 後半 2026-11-13：`routeWebhookMessages` 忽略 accountId →「回呼網址與粉專屬於不同租戶」失敗；`routePlatformMessages` 全部歸第一個帳號 →「一個請求帶兩個租戶的留言」失敗
- [x] 12.3 讓留言建立的聯絡人第一次回覆也送招呼語：「留言私訊後顧客第一次回覆」「留言建立的聯絡人自己傳私訊」失敗
  - 2026-11-13：招呼語條件改成 `!isFirstContact && !fromCommentReply` 才略過 →「留言私訊後顧客第一次回覆」「留言建立的聯絡人自己傳私訊」失敗
- [x] 12.4 `matchKeywordTrigger()` 也改成 NFKC：2.1 補的案例失敗（2026-11-13 已驗證：改成 `{ normalize: 'nfkc' }` 後「關鍵字回覆的全形「＋１」不命中半形「+1」」失敗，還原後通過）
- [x] 12.5 拿掉外掛「排除自己帳號」：「粉專自己的留言」「Comment by the page itself」「自己帳號的留言」失敗（外掛部分 2026-11-13 完成：「Comment by the page itself」「自己帳號的留言」失敗；「粉專自己的留言」待第 4 節）
- [x] 12.6 拿掉 `ON CONFLICT DO NOTHING`（改一般 INSERT 吞錯）：「同一個請求重送三次」「兩個入口並行」失敗（斷言 Meta 呼叫次數）
- [x] 12.7 認領不檢查 `status='PENDING'`：「同一筆紀錄的工作執行兩次」失敗
- [x] 12.8 拿掉 7 天判斷；安全邊際改 0：「7 天前的留言」「排隊到過期」；「安全邊際內」失敗
- [x] 12.9 月額度改成先讀再寫（非原子）：「並行不超賣」失敗
- [x] 12.10 去重改成收件時佔名額：「第一則失敗後的留言仍會嘗試」失敗
- [x] 12.11 補訂閱只送 `['feed']`、少送 `message_echoes`：「FB 開啟留言接收」「已開啟接收的粉專重新連結」失敗（外掛部分 2026-11-13：`subscribeFields` 改送 `feed` → `comment-subscription.test.ts` 2 個測試失敗）（2026-11-13 路由情境：`commentSubscriptionFields` 改送 `['feed']` →「FB 開啟留言接收」失敗；重新連結改送 4 個私訊欄位 →「已開啟接收的粉專重新連結」失敗；`BASE_SUBSCRIBED_FIELDS` 少 `message_echoes` → 7 個測試失敗）
- [x] 12.12 拿掉 `inbox.view` 判斷：「沒有收件匣權限」失敗（2026-11-13：拿掉 `viewer.canViewInbox` 判斷 →「沒有收件匣權限」失敗）
- [x] 12.13 拿掉渠道可見範圍過濾：「分店帳號只看到自己渠道的規則」「分店帳號只看到自己渠道的紀錄」失敗（2026-11-13：`listRules` 拿掉可見渠道條件 →「分店帳號只看到自己渠道的規則」失敗；`listLogs` 拿掉 →「分店帳號只看到自己渠道的紀錄」失敗）
- [x] 12.14 拿掉背景的方案 feature 檢查（只留路由 403）：「方案不含留言自動私訊」「排隊期間方案移除功能」失敗
- [x] 12.15 `attachCommentOrigin` 的條件更新不檢查 `conversationId IS NULL`：「顧客再傳第二則」「兩則回覆並行」失敗
- [x] 12.16 `resolvePostUrl` 直接 fetch 使用者網址：「任意外部網址」失敗（2026-11-13：FB 外掛 dist 的 `resolvePostUrl` 開頭加 `fetch(input)` →「任意外部網址」與「解析 FB 貼文網址」失敗（白名單外 host 違規））
- [x] 12.17 限流延後改成丟錯讓 BullMQ 重試：「本小時額度用完」（重試次數沒有增加）失敗
- [x] 12.18 403 斷言 `details.requiredPermission`／`details.limitKey`／`details.capability`，確認不是另一道守門剛好給 403（2026-11-13 第 7、9 節部分：POST /rules 的守門改成 view → 被 CHANNEL_ACCESS_DENIED 擋下，「沒有 manage 權限」因斷言 `requiredPermission` 失敗；拿掉 subscribe-comments 的 `channel.update` → 「缺渠道修改權限」失敗；上限與能力開關的 403 都斷言 `limitKey`／`capability`。收件、送出相關路由待第 4、5 節）
  - 2026-11-13：外掛 dist 的 `fromId === accountId` 改 false →「粉專自己的留言」失敗
  - 2026-11-13：收件快路徑檢查拿掉＋`ON CONFLICT DO NOTHING` 改 `DO UPDATE`（每次都回傳 id）→「同一個請求重送三次」「兩個入口並行」失敗（斷言只排 1 個 job、Meta 1 次）
  - 2026-11-13：認領的條件更新拿掉 `status='PENDING'` →「同一筆紀錄的工作執行兩次」失敗。原本兩次執行依序跑時，第二次在讀紀錄時就被擋（同一結果的第二道檢查），改成每個交易提交後延遲 100ms 讓兩次都先讀到 PENDING
  - 2026-11-13：flow 拿掉 7 天判斷 →「7 天前的留言」（feature）失敗；期限函式永遠 false → 單元「7 天前」「安全邊際內」「邊界」「排隊到過期」失敗；安全邊際改 0 →「常數」「安全邊際內」「排隊到過期」失敗
  - 2026-11-13：月額度改成先讀再寫（中間 50ms）→「並行不超賣」失敗
  - 2026-11-13：去重持有者含 PENDING 且一律判重複 →「第一則失敗後的留言仍會嘗試」失敗
  - 2026-11-13：`checkTenantEntitlement` 的方案檢查拿掉 →「方案不含留言自動私訊」（收件）「排隊期間方案移除功能」（送出）失敗
  - 2026-11-13：條件更新拿掉 `conversationId IS NULL` →「顧客再傳第二則」「兩則回覆並行」仍通過（查詢條件與依序處理是同一結果的另一道檢查）；新增「兩個關聯同時進行時只關聯一次」（交易內延遲讓兩個關聯都讀到未關聯）→ 失敗
  - 2026-11-13：限流延後改成丟錯 →「本小時額度用完」（重試次數增加）失敗
  - 2026-11-14（收件、送出相關路由）：收件與送出是背景工作，沒有 403；與它們相關的路由是重試。新增「只有檢視權限重試」斷言 `details.requiredPermission` 是 `comment_reply.manage`，突變：重試路由守門改成 view → 失敗。唯讀層級重試斷言 `CHANNEL_ACCESS_DENIED`（既有）

## 13. 文件

- [x] 13.1 `docs/ref/modules/CHANNEL-PLUGINS.md`（留言擴充、兩處入站聯絡人建立邏輯需同步）、`docs/ref/DATABASE-ERD.md`、`docs/16_DB_SCHEMA.md`（新表與索引理由）、`docs/ref/modules/PERMISSIONS.md`
- [x] 13.2 `docs/ref/features/platform/`：5 個平台設定鍵、`/admin/comment-reply`、runbook（留言沒觸發、緊急停止、webhook 被 Meta 停用、大量 PENDING）
- [x] 13.3 新增 `.claude/skills/feature-comment-reply/`（或併入 `feature-channels`）功能顧問說明；操作手冊章節於上線後補（截圖需真實畫面）（2026-11-14：`.claude/skills/feature-comment-reply/SKILL.md`，`feature-map.json` 加 `comment-reply` 領域；平台文件 `docs/ref/features/platform/COMMENT-REPLY.md`）
- [x] 13.4 若修到 AUDIT 項目（例如平台設定一般鍵無型別檢查 TRIAL-02 的部分修正），更新 `docs/ref/system/AUDIT.md` 與 `AUDIT-REVIEWS.md`（2026-11-14：TRIAL-02 補新鍵已有型別檢查，狀態不變；AUDIT-REVIEWS 加紀錄）

## 14. Meta 與 UAT 外部動作（每一步都需使用者同意；UAT 就是正式環境）

- [ ] 14.1 【需使用者同意】合併與部署（合併 main 即自動部署）；部署前在 UAT 跑唯讀 SQL（`_prisma_migrations`、方案、`conversations` 大小、磁碟）
- [ ] 14.2 【需使用者同意】部署後：`reconcile-system-role-permissions`、SCAN＋DEL `perms:tenant:*`；確認既有 FB 私訊仍進收件匣；平台佇列頁看得到 `comment-reply`；`/admin/comment-reply` 能開且能力全關
- [ ] 14.3 【需使用者同意】創造智能 Meta App（671495162407854）App 層：page 加 `feed`、instagram 加 `comments`；操作前後截圖欄位清單
- [ ] 14.4 【需使用者同意】平台把測試租戶放進含 `comment_reply` 的方案、打開 `fbPrivateReply`；測試粉專 Open333test 先 `GET subscribed_apps` 存證，再「開啟留言接收」，再 `GET` 對照 messaging 欄位全在，立刻傳一則私訊確認（M9）
- [ ] 14.5 【需使用者同意】UAT 階段一實測（05 §5.2 步驟 1-3～1-18）：留言收私訊、回覆進收件匣、重複留言、全形、粉專自己回覆、無角色帳號留言（M3）、封鎖者（M2）、Graph API Explorer 取「已私訊過」「超過期限」錯誤碼（M2）、重新連結（M9）、IG 重新產生權杖並實測（M6、M7）、記錄 `from.id` 與 `recipient_id`（M1）
- [ ] 14.6 把實測結果回填：外掛錯誤對照與 fixture、design 的 M1～M10、測試階段卡文案；必要時修改 D16、D28
- [ ] 14.7 【需使用者同意】FB 私訊對方案含 feature 的租戶開放
- [ ] 14.8 【需使用者本人】修 App 基本資料（資料刪除網址、隱私權政策、聯絡信箱），送審 `pages_read_engagement`、`pages_manage_engagement`、IG 三項（04 §6）
- [ ] 14.9 【需使用者同意】審核通過後依序打開 `fbPostPicker`、`fbPublicReply`、`igPrivateReply`、`igPostPicker`、`igPublicReply`，`testPhase` 改 false；請租戶重新連結取得新權限
- [ ] 14.10 【需使用者同意】UAT E2E `apps/web/tests/e2e-uat/tenant-comment-replies.spec.ts`（規則往返、前端實際送出的 body 讀回不變、權限角色畫面；不觸發 Meta）

## 15. 完成定義

- [x] 15.1 `pnpm test`（2026-11-14：17 個套件全部通過；api 1930、web 1091、workers 177）
- [x] 15.2 `pnpm test:feature`（本 change 改了資料庫、Redis、RLS）（2026-11-14：`TEST_DATABASE_NAME=open333crm_test_crmerge TEST_REDIS_URL=redis://localhost:6380/4`，185 檔、1835 個測試通過）
- [x] 15.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有本 change 新增的違規（2026-11-14：三支都 exit 0；tenant-scoping 的 LEAK_SUSPECT 0，comment-reply 有 6 筆 NEEDS_REVIEW，皆為已以租戶條件讀出後依主鍵更新，或 where 由變數組成且含 tenantId）
- [x] 15.4 `node scripts/check-workspace-esm.mjs --strict`（2026-11-14：exit 0）
- [x] 15.5 `pnpm build`（2026-11-14：exit 0；補訂閱腳本引用不存在的 `SUBSCRIBED_FIELDS` 已修正）
- [x] 15.6 `CHANGELOG.md` 在 `## [YYYY-MM-DD]` 區段寫 `Added` 條目（不可用 `[Unreleased]`）（2026-11-14：`## [2026-11-14]` 的 Added 與 Changed）
- [x] 15.7 每個 scenario 至少一個測試、測試名稱＝scenario 名稱；`planning/05-qa.md` §3.3 整合缺口表：每個 flow 單元測試的分支都有 feature 情境走過同一個入口（2026-11-14：本 change 新增的 scenario 都有同名測試，新補「留言收件建立聯絡人時不發布」；另 16 個 scenario 是 MODIFIED 需求帶進來的既有 scenario（`channel-plugins` 2、`contact-management` 8、`first-contact-greeting` 4、`inbound-contact-resolution` 2），由 11.9 的既有測試以原本的名稱涵蓋，未改名。§3.3 缺口表：補「排隊期間渠道停用」「排隊期間租戶停用」「第一次送出就回已私訊過」「Meta 回超過可私訊的期限」，五列都有 feature 情境走過同一個入口）
- [x] 15.8 `node scripts/validate-openspec.mjs add-comment-keyword-private-reply` 與 `node scripts/validate-openspec.mjs --specs`（2026-11-14：兩者都通過；`--specs` 123 項）
- [ ] 15.9 確認 0.1、0.2 的相依 change 已歸檔並核對 MODIFIED 內容後，以 `pnpm exec openspec archive add-comment-keyword-private-reply` 歸檔；新主規格的 `## Purpose` 換掉「TBD」
