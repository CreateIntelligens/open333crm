## 1. schema 與 RLS

- [x] 1.1 寫失敗的 feature 測試 `apps/api/tests/feature/lib/outbox-rls.test.ts`，以 `app_tenant` 連線涵蓋 Scenario「寫入別的租戶的事件」（event-delivery），並對 `side_effect_claims` 做同樣的檢查（side-effect-claims「認領紀錄受租戶隔離並保存 30 天」的隔離部分）。執行後確認失敗原因是資料表不存在，再進入 1.2
- [x] 1.2 在 `schema.prisma` 新增 `Outbox`、`SideEffectClaim`（design 決策 1、2），`WebhookDelivery` 新增 `eventId` 與 `@@unique([subscriptionId, eventId])`。建立 migration，含兩張表的 `ENABLE`、`FORCE ROW LEVEL SECURITY` 與 `tenant_isolation` policy（`postgres-rls-tenant-isolation` skill）。讓 1.1 通過

## 2. 共用模組 `packages/core/src/outbox/`

- [x] 2.1 把 `apps/api/src/lib/db-invariants.ts` 搬到 `packages/core`，api 改從 `@open333crm/core` import。`apps/api/tests/unit/lib/db-invariants.test.ts` 跟著搬到 `packages/core/tests/unit/`；`apps/api/tests/feature/lib/db-invariants.test.ts` 留在 api，改從 `@open333crm/core` import。兩個測試搬移前後都通過（重構，不改行為）
- [x] 2.2 寫失敗的單元測試 `packages/core/tests/unit/outbox/claim.test.ts`，以 mock 的交易涵蓋 side-effect-claims 的 Scenario「第一次認領」「已經認領過」「子鍵不同」
- [x] 2.3 實作 `claimSideEffect()`（design 決策 3），讓 2.2 通過
- [x] 2.4 寫 feature 測試 `apps/api/tests/feature/lib/side-effect-claims.test.ts`，以兩個真實交易涵蓋 Scenario「已經認領過」（之後的查詢成功）、「兩個交易同時認領同一個鍵」「先認領的交易 rollback」。這些行為來自 PostgreSQL 的 `ON CONFLICT DO NOTHING`，測試寫好就會通過，以突變驗證：把 `skipDuplicates` 拿掉，確認「已經認領過」失敗，再還原。突變記在本項下方
  - 突變（2026-10-21）：拿掉 `claimSideEffect()` 的 `skipDuplicates`，「已經認領過」與「兩個交易同時認領同一個鍵」失敗（`Unique constraint failed`），還原後通過
- [x] 2.5 寫失敗的單元測試 `packages/core/tests/unit/outbox/dispatch.test.ts`，以 mock 的 `Queue` 涵蓋 event-delivery 的 Scenario「一般情況」「只送給訂閱了這個事件的訂閱者」「建立 job 失敗」，以及 `kind = 'job'` 送到 `queueName`
- [x] 2.6 實作 `writeOutbox()`、`dispatchOutboxRows()`、佇列名稱、訂閱者清單與對外事件清單（design 決策 3、4、11），讓 2.5 通過

## 3. `TenantCtx` 改走 outbox

- [x] 3.1 修改 `apps/api/tests/unit/lib/tenant-ctx.test.ts`：`publish`、`enqueue` 在交易內寫 outbox、commit 之後交給快路徑；rollback 時不交給快路徑。刪除「事件不重複送出」測試（requirement 已移除）。確認新測試失敗
- [x] 3.2 修改 `tenant-ctx.ts`（design 決策 5）與 `tests/support/mock-tenant-ctx.ts`，讓 3.1 通過；`tsc --noEmit` 通過
- [x] 3.3 寫 feature 測試 `apps/api/tests/feature/lib/outbox.test.ts`，涵蓋 event-delivery 的 Scenario「commit 之後 outbox 有這個事件」「rollback 時 outbox 沒有這個事件」，以及 tenant-transaction-context 的 Scenario「行程在送出 job 之前結束」（不執行快路徑，直接呼叫 relay）與「行程在推播之前結束」
  - 另加 Scenario：快路徑以綁定租戶的短交易標記已送出。快路徑原本要用 `prismaAdmin`，`check-prisma-admin-usage.mjs` 不允許 `tenant-ctx.ts` 使用，改成 `withTenant()` 之後仍受 RLS 約束

## 4. relay 與清理

- [x] 4.1 寫失敗的單元測試 `apps/api/tests/unit/modules/outbox/outbox-relay.test.ts`，涵蓋 Scenario「行程在送出前結束」「寬限時間內不補送」（event-delivery）
- [x] 4.2 實作 `outbox-relay` 排程（design 決策 6），在 `index.ts` 註冊，讓 4.1 通過。`schedule-registrations.test.ts` 跟著更新
- [x] 4.3 寫失敗的單元測試 `apps/api/tests/unit/modules/outbox/outbox-cleanup.test.ts`，涵蓋 Scenario「已送出 8 天」「未送出的事件」（event-delivery）、「建立 31 天的紀錄」「建立 29 天的紀錄」（side-effect-claims）
- [x] 4.4 實作 `outbox-cleanup` 排程，讓 4.3 通過
  - 突變（2026-10-21）：寬限時間改成 0，「寬限時間內不補送」失敗；outbox 保留改成 5 天、認領紀錄改成 28 天，「已送出 6 天：保留」「建立 29 天的認領紀錄：保留」失敗；outbox 改以 `createdAt` 判斷，「未送出的事件」失敗。還原後通過
- [x] 4.5 寫 feature 測試 `apps/api/tests/feature/lib/outbox-dedupe.test.ts`，以真實 Redis 涵蓋 Scenario「快路徑與補送同時送出」「job 已完成 1 小時後再送一次」。行為來自 BullMQ 的 job id 去重，以突變驗證：拿掉 job id，確認失敗，再還原
  - 突變（2026-10-21）：拿掉訂閱者 job 的 `jobId`，兩個 Scenario 都失敗，還原後通過

## 5. 訂閱者佇列與舊寫法的轉送

- [x] 5.1 寫失敗的單元測試 `apps/api/tests/unit/events/event-bus.test.ts`，涵蓋 Scenario「舊寫法發出事件」：`eventBus.publish()` 為每個訂閱者佇列 `add()` 一個帶事件 id 的 job，不寫 outbox
- [x] 5.2 把 `eventBus` 改成轉送器（design 決策 7），讓 5.1 通過
- [x] 5.3 寫失敗的單元測試 `apps/api/tests/unit/events/subscriber-workers.test.ts`，涵蓋 Scenario「webhook 失敗重試」：webhook job 失敗時，自動化佇列沒有新增 job
- [x] 5.4 在 API 行程建立三個訂閱者佇列的 `Worker`（design 決策 4），三個訂閱者改從佇列取得事件，不再訂閱 `eventBus`。job data 的 `timestamp` 轉回 `Date` 再交給處理程式，5.3 一併斷言處理程式收到的 `timestamp` 是 `Date`。讓 5.3 通過
  - `eventBus.publish()` 仍在行程內 emit，只給測試以 `subscribe()` 觀察；正式的訂閱者都改從佇列取得事件。`keyword.matched` 暫時留在 core 的自動化訂閱清單，否則 8.11、9.2 完成之前關鍵字規則不會執行；8.11 移除

## 6. 通知訂閱者

- [x] 6.1 寫失敗的單元測試 `apps/api/tests/unit/modules/notification/notification.worker.test.ts`，涵蓋 standalone-worker-runtime 的 Scenario「同一個事件處理兩次」「同一個事件通知多位客服人員」（以 job id 斷言），以及 usage-quota-alerts 的 Scenario「告警事件處理兩次」
- [x] 6.2 實作 design 決策 10：`notification:dispatch` 的 job id、`usage-alert-email` 佇列與它的 `Worker`。讓 6.1 通過；usage-quota-alerts 既有的測試照常通過
  - 突變（2026-10-22，review-loop 第 3 輪補上 Scenario「Email provider fails」）：`processUsageAlertEmail()` 吞掉寄信的錯誤，`usage-quota-alert.test.ts` 的「Email provider fails」失敗，還原後通過

## 7. 對外 webhook

- [x] 7.1 寫失敗的單元測試 `apps/api/tests/unit/modules/webhook-subscriptions/webhook-dispatcher.test.ts`，涵蓋 webhook-subscription-egress 的 Scenario「清單內的事件」「不在清單內的名稱」「同一個事件送出兩次」「一個網址失敗」「測試網址回傳 500」
- [x] 7.2 實作 design 決策 11：`event-webhook` 拆成每個訂閱一個 `webhook-delivery` job、payload 的 `id`、`X-Webhook-Event-Id`、送出紀錄以 `createOrFindExisting()` 建立。`POST /webhook-subscriptions/:id/test` 改成在請求內只送一次、用新產生的事件 id。刪掉 `dispatchWebhook()` 的行程內重試迴圈，`webhook-delivery` job 與測試路由共用「送出一次 HTTP」的函式。讓 7.1 通過
- [x] 7.3 寫 feature 測試涵蓋 Scenario「重試期間 API 重新啟動」：第一次失敗後關閉 `Worker`、再建立新的 `Worker`，第二次照常送出

## 8. 自動化訂閱者（API）

- [x] 8.1 把 `hasMatchingKeywordRule()`、`BotConfig`、`DEFAULT_BOT_CONFIG`、`DEFAULT_HANDOFF_PROMPT_TEXT` 與關鍵字比對搬進 `packages/automation`（design 決策 8），`kb-autoreply.service.ts`、`automation.worker.ts` 與 workers 改 import 新位置。既有測試 `keyword-suppresses-ai.test.ts`、`keyword-yield-channel.test.ts` 改 import 路徑，搬移前後都通過（重構）。之後 ARCH-02 的檢查指令沒有輸出
  - 2026-10-22：`hasMatchingKeywordRule()` 改放 `apps/api/src/modules/automation/keyword-yield.ts`。放在 `packages/automation` 時，web 打包那個套件會帶進 core 與 BullMQ，`pnpm build` 失敗。新增 `browser-safe.test.ts`：套件 import core 或 channel-plugins 時失敗（先寫測試，看它失敗，再搬移）
- [x] 8.2 `packages/automation` 目前沒有測試設定：照 `packages/core` 加上 Vitest、`test` script 與 `#src/` imports。接著寫失敗的單元測試 `packages/automation/tests/unit/keyword-match.test.ts`，涵蓋 automation-engine 的 Scenario「舊資料含空白關鍵字」「訊息沒有命中」
- [x] 8.3 統一關鍵字比對，讓 8.2 通過
- [x] 8.4 寫失敗的單元測試 `apps/api/tests/unit/modules/automation/auto-handoff.test.ts`，涵蓋 bot-handoff-config 的 Scenario「同一則訊息處理兩次」「兩次處理同時進行」（第二個 `claimOne` 回傳 false）「寫入系統訊息失敗」
- [x] 8.5 改寫自動轉接（design 決策 8）：摘要與 `prepareStoredMessageContent()` 在交易之前，交易內只做認領與寫入。讓 8.4 通過
- [x] 8.6 寫失敗的單元測試 `apps/api/tests/unit/modules/automation/bot-reply-claim.test.ts`，涵蓋 automation-engine 的 Scenario「同一則訊息處理兩次」（每則入站訊息最多一則機器人回覆）、「agent 失敗改由 KB 回覆」「已認領就不呼叫 LLM」
- [x] 8.7 agent 與 KB 的回覆改成認領 `bot_reply`，拆掉 `persistAndDeliverAgentReply()` 自己開的交易（design 決策 8）。LLM、遮罩與 KB 檢索在交易之外，照舊用 `prismaAdmin`。讓 8.6 通過
- [x] 8.8 寫失敗的單元測試 `apps/api/tests/unit/modules/automation/sentiment-claim.test.ts`，涵蓋 Scenario「同一則訊息處理兩次」（情緒分析）、「兩次處理同時進行」
- [x] 8.9 情緒分析改成認領 `sentiment`、經 `ctx.publish` 發出 `sentiment.negative`。讓 8.8 通過
- [x] 8.10 寫失敗的單元測試 `apps/api/tests/unit/modules/automation/automation.worker.test.ts`，涵蓋 automation-engine 的 Scenario「Automation event enqueued by API」「Same event delivered twice」（job id 是事件 id），並斷言 API 不再發出 `keyword.matched`、`message.received` 的 context 帶 `messageId`
- [x] 8.11 自動化訂閱者送出 `automation:evaluate` 時帶事件 id 當 job id，`message.received` 的 context 加上 `messageId`（design 決策 9），移除 `checkKeywordTriggers()`。讓 8.10 通過；「Standalone worker is down when job is enqueued」以既有測試確認
  - `automation` 佇列的 job id 是事件 id，所以 `attempts` 與以時間計算的保留期限在這裡一起改（9.8 的 api 端）。core 的自動化訂閱清單移除 `keyword.matched`

## 9. workers 的規則評估

- [x] 9.1 寫失敗的單元測試 `apps/workers/tests/unit/handlers/automation.handler.test.ts`，涵蓋 automation-engine 的 Scenario「訊息命中關鍵字規則」（以 `keyword.matched` 執行、LINE 用 reply）與「keyword.matched 每則訊息每條規則最多發出一次」的「同一則訊息評估兩次」。既有測試 `automation-keyword-scope.test.ts`、`automation-keyword-reply.test.ts` 以 `keyword.matched` job 為前提，改成以 `message.received` job 觸發關鍵字規則；改動前先以 `git log -S` 確認這些斷言的來源
- [x] 9.2 實作 design 決策 9 的關鍵字規則評估與 `keyword_matched` 認領，讓 9.1 通過
  - `automation-keyword-scope.test.ts` 不改：API 部署前已送出的 `keyword.matched` job 仍只評估 `ruleId` 那條規則，避免部署時重複回覆（`8217364b`）。`automation-keyword-reply.test.ts` 測的是 `executeWorkerAutomationActions()` 以 `keyword.matched` 執行時用 reply，行為沒變，也不改
- [x] 9.3 寫失敗的單元測試 `apps/workers/tests/unit/lib/automation-actions.test.ts`，涵蓋 Scenario「同一個事件評估兩次」「升級工單不重複升級」「不同事件各自執行」，另外斷言 context 沒有 `eventId` 時不寫認領紀錄（SLA 路徑，design 決策 9）；`sla-outcome-once.test.ts` 照常通過
- [x] 9.4 每個動作執行前認領 `automation_action`，`notify` 的 job id 照 design 決策 9。讓 9.3 通過
  - 突變（2026-10-21）：沒有事件 id 也認領，「沒有事件 id（SLA 路徑）」失敗；認領鍵改用規則 id 取代事件 id，「不同事件各自執行」失敗。還原後通過
- [x] 9.5 寫失敗的測試，涵蓋 event-delivery 的 Scenario「建立工單與事件一起寫入」「建立工單失敗」，以及 automation-engine「Unified Contact Tagging Emits contact.tagged」的 Scenario「Automation add_tag emits event」
  - 改在既有的 `automation-create-case.test.ts`、`automation-add-tag.test.ts`：原本斷言 `domain:event`，改成斷言 outbox。「建立工單失敗」沿用既有的並行測試，加上 outbox 是空的斷言
- [x] 9.6 `create_case`、`add_tag` 改寫 outbox 並在 commit 之後呼叫快路徑；移除 `publishDomainEvent()` 與 `socket.plugin.ts` 的 `domain:event` 訂閱。讓 9.5 通過
- [x] 9.7 寫 feature 測試涵蓋 Scenario「API 行程沒有在執行」：workers 寫入 outbox 時沒有訂閱者 `Worker`，之後建立 `Worker`，事件照常處理
  - 寫在 `apps/api/tests/feature/lib/outbox-workers.test.ts`（只有 api 有 feature 測試）。另加「快路徑也失敗」：API 啟動後由 relay 補送
- [x] 9.8 `automation`、`notification` 佇列改成 design 決策 9、10 的 `attempts` 與保留期限。`notification` 佇列的兩個發送端（api 的 `notification.worker.ts`、workers 的 `lib/notification-queue.ts`）都要改
  - `automation` 佇列在 8.11 改（發送端在 api）；`notification` 佇列的 api 端在 6.2、workers 端在 9.4 改

## 10. data-export 與 data-erasure

- [x] 10.1 寫失敗的單元測試 `apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`，重現 bug：Scenario「已完成的請求再執行一次」（第二次執行把 `completed` 改成 `failed`），並涵蓋「上一次執行中途結束」。確認失敗是 assertion 失敗
- [x] 10.2 `data-erasure` worker 照 design 決策 12 修改：開頭認領 `pending` 或 `processing`；`completed` 的條件更新放在刪除交易的第一個語句；`failed` 以 `processing` 為條件。讓 10.1 通過；tenant-data-erasure 既有的 Scenario「聯絡人已不存在時記錄失敗」照常通過
- [x] 10.3 在 10.1 的測試檔加上 tenant-data-erasure 的 Scenario「兩次同時執行」：mock 的交易讓第二次執行的 `completed` 條件更新回傳 0 筆，斷言第二次執行的交易 rollback、請求維持 `completed`、`error` 是空值、只送進一個完成通知的 job。列鎖讓後到的交易等待，這是 PostgreSQL 的行為；workers 沒有 feature 測試套件，所以不以真實資料庫測試
  - 突變（2026-10-21）：開頭的認領只收 `pending`，「上一次執行中途結束」失敗；交易內不檢查 `completed` 條件更新的結果，「兩次同時執行」失敗。還原後通過。假交易以 undo 紀錄 rollback，只還原自己寫過的資料，與 PostgreSQL 相同
- [x] 10.4 寫失敗的單元測試 `apps/workers/tests/unit/handlers/data-export.handler.test.ts`，涵蓋 tenant-data-export 的 Scenario「已完成的請求再執行一次」「上一次執行中途結束」「兩次同時執行」（第二次的 `completed` 條件更新回傳 0 筆）
- [x] 10.5 `data-export` worker 開頭認領 `pending` 或 `processing`，`completed` 與 `failed` 以 `processing` 為條件（design 決策 12）。讓 10.4 通過
  - 突變（2026-10-21）：開頭的認領只收 `pending`，「上一次執行中途結束」失敗，還原後通過。失敗通知也只在 `processing` 改成 `failed` 成功時送出

## 11. 文件與完成檢查

- [x] 11.1 更新文件：
  - `docs/ref/modules/EVENTS.md`：訂閱者、佇列、outbox、對外事件清單。
  - `docs/ref/features/tenant/GOVERNANCE.md`：webhook 的重試、事件 id 與測試送出。
  - `AGENTS.md`：Socket Event Routing 的 Path B 改寫 outbox。
  - 提到 `domain:event` 的文件改成 outbox：`docs/ref/features/tenant/CONTACTS.md`、`docs/ref/features/tenant/README.md`、`docs/ref/features/tenant/AUTOMATION.md`、`docs/ref/system/INFRASTRUCTURE.md`。完成後 `grep -rn "domain:event" docs AGENTS.md` 只剩 AUDIT 的歷史紀錄
  - 另外更新了 `OVERVIEW.md`、`NOTIFICATIONS.md`、`CANVAS-FLOW-ENGINE.md`、`docs/ref/system/README.md`，它們也描述 eventBus 的訂閱者
- [x] 11.2 更新 `docs/ref/system/AUDIT.md`，並在 `AUDIT-REVIEWS.md` 記錄：
  - RLS-08 的進度。
  - ARCH-02 移除。
  - HOOK-01 改為部分修正：有了對外事件清單，`replyToken` 仍待決定。
  - APP-08 改為部分修正：新的佇列與 `automation`、`notification` 以時間保留 job。
  - APP-09：`domain:event` 那一列移除。
  - ARCH-02 完全修正，依 AUDIT 的規則移除；`AGENTS.md` 結構規則 4 的既有例外改成「沒有」。APP-04、AUTO-05 的內容也一併更新
- [x] 11.3 `CHANGELOG.md`：`Changed` 寫事件改走 outbox 與 webhook 的改動，`Fixed` 寫 data-erasure 重跑的 bug 與自動轉接的並行重複
- [x] 11.4 `pnpm test`、`pnpm test:feature` 通過
  - 2026-10-21：`pnpm test:feature` 65 個檔案、507 個測試全數通過。`pnpm test` 只有 api 的「repo 本身：舊寫法沒有比基準檔多」失敗，這個失敗在 `origin/main` 上就有（見 11.5）
- [x] 11.5 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規；`node scripts/check-tenant-ctx.mjs --strict` 通過，舊寫法減少時以 `--update-baseline` 更新基準檔
  - `check-tenant-scoping` 與 main 比對後，新增一處 `automation.worker.ts` 的 `findUnique` 沒帶 `tenantId`，已改成 `findFirst` 並帶 `tenantId`，改後沒有新增。`check-prisma-admin-usage` 通過。`check-tenant-ctx --strict` 失敗，原因是 main 上的 `deidentification.service.ts`（TenantDb 3 → 7）與 `ai.routes.ts`（request.tenantPrisma 7 → 8），本 change 沒有改動這兩個檔案。2026-10-22 依使用者決定以 `--update-baseline` 記入基準檔，改由 #337 階段 4 處理（規劃 5.1 節）
- [x] 11.6 `node scripts/validate-openspec.mjs outbox-event-delivery` 與 `--specs` 通過
- [x] 11.8 review-loop（2026-10-22，5 輪）：依 Codex 與自己的審查修正，並依使用者的決定定下審查基準（design 第 14 節）、錯誤處理規則（design 第 13 節）。每個修正都先寫會失敗的測試；改動前就會通過的測試以突變驗證：
  - `processUsageAlertEmail()` 吞掉寄信的錯誤時，「Email provider fails」失敗
  - 轉接 commit 之後送出失敗改成往外丟時，「Delivery fails after handoff commit」失敗
  - 規則動作的 catch 改成往外丟時，「Action fails after claim」失敗
  - `analyzeSentiment()` 在 LLM 失敗時改成丟錯，`sentiment-llm-fallback.test.ts` 的「Sentiment LLM fails」失敗（最後一輪 Codex 指出：原本的測試把 `analyzeSentiment` mock 成丟錯，繞過了真正的呼叫路徑，改成只 mock LLM）
  - 2026-10-22：`pnpm test`、`pnpm test:feature`（507 個測試）全數通過
- [ ] 11.7 合併後以 `pnpm exec openspec archive outbox-event-delivery` 歸檔，確認 `event-delivery`、`side-effect-claims` 兩份新主規格的 `## Purpose` 是 delta 的內容，不是「TBD」，再執行 `node scripts/validate-openspec.mjs --specs`，確認「略過 N 則」沒有變多
