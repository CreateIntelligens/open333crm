# 實作落差複查紀錄

本文件按日期記錄[實作落差與驗證紀錄](./AUDIT.md)的複查結果。`AUDIT.md` 只描述各項目的現況；每次複查的範圍、方法與結果記錄在本文件。

新的複查紀錄加在最上方。

## 2026-10-01：對照 One ID 的合併，移除 RLS-02，AUTH-05 與 RBAC-01 改為部分修正

整理 P1 項目的修復順序時發現，2026-09-30 合併的 `481452a`（#185，`add-cross-channel-one-id`）已經修掉三個 P1 項目的全部或一部分，但 `AUDIT.md` 仍以修正前的狀態描述這三項。本次逐項對照 `main` 的程式後更新：

| 項目 | `481452a` 改了什麼 | 處理 | 優先 |
| --- | --- | --- | --- |
| RLS-02 | approve 與 reject 路由在 `withTenant` 內呼叫服務，並傳入 `request.agent.tenantId`；`rejectMerge()` 與 `claimSuggestionForApproval()` 改由呼叫端傳入 executor，`where` 帶 `tenantId`；`merge-suggestion-service.ts` 不再匯入 module-level singleton | 已修正，從 `AUDIT.md` 移除 | — |
| AUTH-05 | 刪除 `POST /api/v1/fan/auth`。`signFanToken()` 因此沒有呼叫端 | 部分修正。`authenticate` 與 socket 驗證仍不區分 token 種類 | P1 → P2 |
| RBAC-01 | `contact.routes.ts` 的每條路由都掛上 `requirePermission()` | 部分修正。工單、對話、標籤、短連結的路由仍然沒有授權判斷 | P1，不變 |

**AUTH-05 調為 P2 的理由。** 原本標為 P1，是因為任何人知道一組聯絡人 ID 與租戶 ID，就能從 `/fan/auth` 取得能通過客服認證的 token。這條路徑刪除之後，利用剩下的問題需要先取得外洩的 refresh token，或曾經是該租戶的成員。One ID change 的 `tasks.md` 9.3.3 預計接回粉絲 token 的簽發路徑，但這個 change 沒有在 `authenticate` 加上 token 種類的檢查。因此內文註明這一項必須在 9.3.3 之前修正。

**RBAC-01 的權限碼重新計算。** 在 `apps/api/src` 逐一搜尋 `permissions.ts` 的權限碼字串。完全沒有出現的碼從 15 個減為 12 個：`contact.view`、`contact.update` 與 `case.view` 都出現在 `contact.routes.ts`。`case.view` 只守在 `GET /contacts/:id/cases`，`case.routes.ts` 本身仍不檢查，因此在內文另外說明。`contact.merge` 原本只以稽核紀錄的 `action` 字串出現，現在已經是路由的檢查。

連帶修改：

- RLS-03 不再提到 RLS-02，匯入 singleton 的 `packages/core` 檔案從三個減為兩個。
- IDENT-01 刪除「影響 RLS-02 的現況」一句。
- `AUTHENTICATION.md`、`PORTAL.md` 與其他引用 AUTH-05、RBAC-01 的功能區文件，改寫「呼叫 `/fan/auth` 取得粉絲 token」與「聯絡人路由沒有權限碼」的描述。

**本次沒有查證的項目。** `481452a` 也新增了 `contact-merge.service.ts`，把多套合併實作收斂成一套。CONTACT-01（兩套合併實作的行為不一致）可能因此過時，本次沒有查證，留待下次複查。

## 2026-10-01：組織決定不部署 Ollama，重寫 LLM-01 至 LLM-03，新增 LLM-04

組織因主機資源不足，決定不部署 Ollama。原本的 LLM-01 至 LLM-03 都假設 Ollama 有部署，問題在於「連錯位址」或「設定不一致」。這個決定之後，三項依新的前提重寫：

| 項目 | 原本的問題 | 重寫後的問題 | 優先 |
| --- | --- | --- | --- |
| LLM-01 | Ollama 位址預設指向 API 容器自己 | 租戶的 Chat 與 Embedding 設定預設使用 Ollama | P2，不變 |
| LLM-02 | Compose 與資料庫的 Chat 模型預設不同 | Compose 仍有 `ollama` 服務 | P3 → P4 |
| LLM-03 | `OLLAMA_BASE_URL` 只對 Chat 生成生效（部分修正） | `OLLAMA_*` 環境變數已無作用 | P3 → P4，狀態改回未處理 |

LLM-03 原本的「部分修正」指 `ee251c8` 的位址補救。這個補救改連的是 Ollama 容器。Ollama 不再部署，所以這個補救不再算修正。

**LLM-04。** 本次查證「Chat 改用 Gemini 能否繞過 LLM-01」時發現：`tenant_settings` 的 Embedding 設定沒有供應商欄位，`embedding.service.ts` 只會呼叫 Ollama。逐一查看 `generateEmbedding()` 與 `embedArticle()` 的呼叫端，確認各功能失敗時的行為。其中 `attemptKbAutoReply()` 失敗時回傳 `false`，兩個呼叫端（`automation.worker.ts`、`action-executor.ts`）都不轉真人。

DB-01 補上一句：正確的維度要等 LLM-04 選定新模型才能決定。

## 2026-10-01：改寫 AGENTS.md 的開發流程，新增 ARCH-01、ARCH-02、RLS-07

起因是改寫 `AGENTS.md`：依 SDD、TDD、SOLID 把模組結構規則改成「開發流程」一節，每條規則附上理由與檢查指令。原本寫在 `AGENTS.md` 的例外清單已經過時，例如規則 1 列 5 個模組、規則 4 列 4 處 import，都與實際不符。因此依修正成本分開處理：

| 規則 | 處理 | 依據 |
| --- | --- | --- |
| 1. route 不直接查資料庫 | 新增 ARCH-01，附快照 | 多為單筆查詢，搬進 service 即可 |
| 2. service 從參數接收 executor | 指向既有的 RLS-01 | 違反的是 Canvas 引擎與 `packages/core` 中沒人使用的服務，RLS-01 已記錄 |
| 3. 一個 route 檔一種資源 | 不列清單 | 拆檔成本高；`platform.routes.ts` 拆檔前須先處理 SEC-03 |
| 4. 跨模組只走對方的 service | 新增 ARCH-02 | 規則改為「不可 import 別的模組的 `.routes.ts`、`.worker.ts`、`.scheduler.ts`」；引用 helper 檔不算違規。改定義後只剩一處 |
| 5. 渠道差異走外掛 | 不列清單；改由 `CHANNEL-PLUGINS.md` 記錄位置 | 改成走外掛要擴充外掛介面與兩個行程的註冊表 |

每條規則的檢查指令都照 `AGENTS.md` 的寫法實際執行過。

**RLS-07。** 為了寫「完成的定義」，實際以 `--strict` 執行兩支租戶隔離檢查。`check-tenant-scoping.mjs` 通過；它在沒有疑似漏帶時，訊息仍寫「dry-run」，但 exit code 正確。`check-prisma-admin-usage.mjs` 在 `main` 上就失敗，原因是 `207da85` 讓短連結轉址改用 `prismaAdmin`，卻沒有更新白名單。`AGENTS.md` 的完成定義因此寫成「不新增違規」，既有的違規查 `AUDIT.md`。

## 2026-10-01：導入 Vitest，移除 CI-03，並修正在 main 上失敗的測試

CI-03（測試由 `tsx` 個別執行，沒有統一入口）已修正，從 `AUDIT.md` 移除。修正的 commit 是 `609148c`、`0fb276a`、`3c7b97f`、`6a4a4cd`、`14f51f9`：

- 導入 Vitest；
- 每個套件分成 `tests/unit` 與 `tests/feature` 兩組；
- feature 組使用獨立的測試資料庫。

CI-01 仍未處理：CI 依然不執行測試。內文改寫為目前的本機執行方式。

**方法。** 在 `docker-compose.dev.yml` 起的本機環境中執行全部測試。每個檔案各執行兩次：一次沒有 PostgreSQL 與 Redis，一次有。再比較兩次的結果。

**結果。** 轉換前，在 main 上有 5 個測試檔失敗。逐一查證後，都是程式改了、測試沒跟上，沒有發現程式錯誤：

| 測試 | 失敗的原因 | 失敗起點 | 修正的 commit |
| --- | --- | --- | --- |
| `cli-session-auth` | 預設 scope 新增 `cli:analytics:read`；登入改走 `prismaAdmin`；登入會檢查租戶是否啟用；錯誤訊息改為中文 | `7aebbce`、`b493c17`、`6bca767` | `01cce76` |
| `passkey.service` | 錯誤訊息改為中文，測試比對英文訊息 | `9dd15dd` | `56682dd` |
| `tagging.service` | RLS 把 `deleteTenantTag()` 內的 `$transaction` 移到呼叫端的 `withTenant`，測試仍檢查 service 內的交易 | `6bca767` | `a31eb68` |
| `sla-contract` | automation 佇列改為延遲建立的 `automationQueue()`，比對的字串不再存在 | `fff80d8`（2026-05-28） | `bd46722` |
| `inbox-realtime-source` | 入站管線拆檔，payload 改由 `inbound-socket-presenter.ts` 組成 | `0051dea`（2026-06-03） | `0f09d25` |

**另外的發現。**

- **需要資料庫的測試會默默跳過。** 8 個測試檔在沒有 `DATABASE_URL` 時以結束碼 0 結束，看起來與通過無異。除非明確設定 `DATABASE_URL`，或根目錄有 `.env`，否則它們從未真正執行。這次給了資料庫之後，它們全部通過。改用 Vitest 後，feature 組一律由 global setup 提供測試資料庫，不再有這種跳過。
- **本機開發時 RLS 不生效。** 本機 API 以 `crm` 連線，而 `crm` 是 superuser，會繞過 RLS。`app_tenant` 與 `app_admin` 在本機沒有密碼。feature 組的 global setup 會替沒有密碼的角色設定測試用密碼，`rls-isolation` 才能以 `app_tenant` 實際驗證隔離。

## 2026-09-30：RBAC-06 定案，並補上分歧的來源

使用者決定 `supervisor` 預設不擁有 `channel.view_all`，以 core 的 `default-roles.ts` 為準，demo seed 與 CHANGELOG 的描述是錯的。RBAC-06 的處理狀態改為「已定方向」。

同時以 `git log --follow` 查兩份檔案的歷史，確認分歧的來源。討論時曾推測是「平台開通流程比較晚做」，但歷史不支持：`seed-data/rbac-roles.ts` 與 `default-roles.ts` 都在 `723f6e1`（2026-08-25）加入，平台開通流程的 `seedRolesForTenant()` 呼叫在同一天的 `acb7568` 加入。分歧來自之後兩次新增權限碼：`ad686d2` 只讓 core 取得新碼，`4382dc3` 只更新 demo seed。

## 2026-09-30：撰寫渠道外掛文件，新增 CHAN-02、CHAN-03、PKG-06

起因是新增[渠道外掛](../modules/CHANNEL-PLUGINS.md)。做法是從 `ChannelPlugin` 介面出發，對每個方法與擴充 grep 呼叫端；比對 API 與 workers 各自註冊的外掛；再列出 `apps/api/src` 與 `apps/workers/src` 所有以 `channelType` 分支的地方。

| 新項目 | 判定依據 |
| --- | --- |
| CHAN-02 | `apps/workers/src/index.ts` 的 `pluginRegistry.set()` 只有 `linePlugin`、`fbPlugin`；`deliverToChannelFromWorker()` 找不到外掛時呼叫 `recordDeliveryFailure()`；`useKeywordReplies.ts` 建立規則時送出 `conditions: { all: [] }`；`kb-autoreply.service.ts` 呼叫 `automation.worker.ts` 的 `hasMatchingKeywordRule()`，命中時不走知識庫回覆；`webchatPlugin.sendMessage()` 只寫 log |
| CHAN-03 | `webhook.routes.ts` 以常數傳入 `CHANNEL_TYPE.LINE` 等；`processWebhookEvent()` 以參數 `channelType` 呼叫 `getChannelPlugin()`，沒有與 `channel.channelType` 比較；`facebook/index.ts` 與 `threads.ts` 以 `===` 比較簽章；`line/index.ts` 直接呼叫 `timingSafeEqual()` |
| PKG-06 | `setWebhook`、`extensions.audience`、`getAllChannelPlugins`、`hasChannelPlugin`、`getPlugin(`、`registerPlugin` 在 `apps/` 沒有出現；三個 `line/worker-*.ts` 在整個 repo 沒有被 import |

**文件修正。** `tenant/AUTOMATION.md` 與 `tenant/CHANNELS.md` 的限制表補上 CHAN-02。

**`AGENTS.md` 規則 5 補上例外。** 規則 1 到 4 都列出不符合規則的模組，規則 5 原本沒有。以 grep 列出 `apps/api/src` 與 `apps/workers/src` 所有比較 `channelType` 的地方，分成改變行為的分支（`conversation`、`channel`、`csat`、`webhook`、`marketing`，以及 workers 的 `channel-delivery.ts`）與只擋不支援渠道的檢查；再以 grep 列出直接呼叫 `api.line.me`、`graph.facebook.com`、`graph.instagram.com` 的服務。規則 5 原本寫「在 `apps/api/src/index.ts` 註冊外掛」，漏了 workers 另有一份註冊表，這正是 CHAN-02 的成因，一併補上。

## 2026-09-30：撰寫事件與背景工作文件，新增四個項目

起因是新增[事件與背景工作](../modules/EVENTS.md)。做法是以腳本列出 `AppEventName` 的每個事件在 `apps/api/src` 的 `eventBus.publish` 與 `eventBus.subscribe`，再逐一對照每個 `new Queue(` 與 `apps/workers` 的 `new Worker(`、兩條 Redis 轉發頻道，以及 API 行程內的每個 `setInterval`。

| 新項目 | 判定依據 |
| --- | --- |
| APP-07 | `scheduler.ts` 以 `new Queue(FLOW_RESUME_JOB, …)` 建立佇列，`FLOW_RESUME_JOB` 是 `'flow:resume'`；`pnpm-lock.yaml` 鎖定 `bullmq@5.71.0`，該版 `dist/esm/classes/queue-base.js` 在名稱含 `:` 時拋出錯誤（以 unpkg 的原始碼確認，本機沒有安裝相依套件）；`apps/` 沒有 `new Worker('flow:resume'` |
| APP-08 | `removeOnComplete` 在 `apps/`、`packages/*/src` 只出現在 `automation.worker.ts` 與 `data-erasure.service.ts`；`apps/workers/src/index.ts` 的每個 `new Worker(` 只傳 `{ connection }`；`notification.worker.ts` 的 `message.received` 訂閱者每則訊息至少送一筆工作；`docker-compose.prod.yml` 的 `redis` 服務沒有 `command` 或 `maxmemory` |
| APP-09 | 列出 API 行程的 `setInterval` 與 `setTimeout` 排程，都沒有 Redis 鎖或 advisory lock；`socket.plugin.ts` 與 `canvas.worker.ts` 各自訂閱 Redis 頻道；`@socket.io/redis-adapter` 在 `apps/api/src` 沒有 import |
| PKG-05 | `CaseService`、`InboxService`、`ContactService` 在 `apps/` 沒有出現；`packages/core/src/index.ts` 沒有匯出 `automation/engine.ts`；`package.json` 的 `exports` 只有 `.` |

**文件修正。** `CANVAS-FLOW-ENGINE.md` 原本寫「喚醒優先用 BullMQ 的延遲工作」，實際上 BullMQ 路徑從未成功，已改為只靠資料庫輪詢；同一份文件把 Canvas 的事件寫成「發到 eventBus」，實際是 `packages/core` 另一套走 Redis 的 `EventBus`，已改正。`tenant/README.md` 的事件表補上 `crm:events`，其餘細節改為連到新文件。

**另外修正 `AGENTS.md`。** Socket 事件路由一節的範例原本寫 `eventBus.publish("case.assigned", { tenantId, payload })`。實際的簽章是 `publish(event: AppEvent)`，只接受一個含 `name`、`tenantId`、`timestamp`、`payload` 的物件，照範例寫會編譯失敗。已改成實際的寫法。

## 2026-09-30：撰寫權限計算文件，新增 RBAC-05、RBAC-06

起因是新增[權限計算](../modules/PERMISSIONS.md)。做法是從 `packages/core/src/rbac/` 的註冊表開始，沿著 `requirePermission()`、`getEffectiveTenantPermissions()`、渠道可見範圍與 socket 房間授權讀一遍，再追查權限碼怎麼進入每個租戶的角色：開通流程、reconcile 腳本與 demo seed。

| 新項目 | 判定依據 |
| --- | --- |
| RBAC-05 | `seedRolesForTenant()` 對每個系統角色先 `rolePermission.deleteMany({ where: { roleId } })` 再 `createMany()`；`reconcile-system-role-permissions.mjs` 對所有租戶呼叫它；`setRolePermissions()` 對系統角色只檢查 `ADMIN_LOCKED`；腳本沒有呼叫任何 Redis 清除；`.github/workflows/deploy.yml` 沒有出現 `reconcile` |
| RBAC-06 | 以腳本擷取兩個檔案的 `SUPERVISOR_CODES`、`AGENT_CODES` 與 demo seed 的 `ADMIN_ONLY` 做集合比對；`git log -S"channel.view_all" -- packages/core/src/rbac/` 只有新增權限碼的 commit，`default-roles.ts` 從未包含它；CHANGELOG 的 CM-173 條目 |

**文件修正。** `tenant/MEMBERS.md` 的「有效權限怎麼算」改為摘要並連到新文件。

## 2026-09-30：撰寫認證機制文件，新增三個項目並修正 SEC-03

起因是新增[認證與憑證](../modules/AUTHENTICATION.md)。做法是逐一讀 `auth.plugin.ts` 的每個認證裝飾器、每種憑證的簽發與驗證函式、兩個 socket namespace 的 handshake，以及沒有客服登入的對外端點，再列出每個裝飾器寫入 `request.agent` 的欄位，與讀取這些欄位的程式對照。

| 新項目 | 判定依據 |
| --- | --- |
| AUTH-06 | `authenticateJwtOrCliSession` 與 `authenticateJwtOrPartnerKey` 的 JWT 分支只設定 `id`、`tenantId`、`role`；`knowledge.routes.ts` 的 `/partner-ingest` 掛 `requirePermission('knowledge.admin')`；`getEffectiveTenantPermissions()` 在 `roleId` 為空時回傳空集合 |
| AUTH-07 | `JWT_EXPIRES_IN` 在 `apps/`、`packages/` 只出現在 `config/env.ts` 的定義；`docs/10_TECH_STACK.md` 的範例列出這個變數 |
| IDENT-02 | `line-login.routes.ts` 與 `fb-login.routes.ts` 的 `/authorize` 沒有 `preHandler`；`/callback` 取得 `verifyIdToken()` 的 `userId` 後沒有使用；`updateContactEmail()` 以 state 的 `lineUid` 查渠道身分；`apps/web/src` 與 `apps/widget` 沒有呼叫 `/authorize`；`stateStore` 是模組層的 `Map` |

**既有項目的補充。** AUTH-02 補上 Partner API 金鑰：`verifyPartnerApiKey()` 只查 `keyPrefix`、`isActive` 與 `expiresAt`；`PartnerApiKey.createdById` 在 schema 中沒有關聯；`agent` 模組的清除流程沒有處理 `partnerApiKey`。

**修正 SEC-03。** 內文原本寫五處註冊「每一處都寫 `global: false`」。`chatbox.routes.ts` 與 `webchat.routes.ts` 註冊時沒有指定 `global`，外掛預設為 `true`，這兩個模組的每條路由都受每分鐘 60 次的限制。已把表格改成列出每一處的註冊方式與效果。

**優先順序的判斷。** IDENT-02 標為 P2：要先知道目標的渠道身分 ID，但成員在後台就看得到。AUTH-06 標為 P3：目前受影響的只有外部夥伴專用的路由，但新路由沿用同一個裝飾器時會重現。

## 2026-09-30：功能區文件移到 `docs/ref/features/`

`docs/ref/modules/` 原本同時放兩種文件：以程式模組為單位的（模組總覽、互動流程引擎），以及以產品功能區為單位的（平台後台、租戶後台、SLA）。後者一份文件跨好幾個程式模組，放在 `modules/` 底下，讀者照目錄名稱找不到。因此把功能區文件移到新的 `docs/ref/features/`：

| 原路徑 | 新路徑 |
| --- | --- |
| `docs/ref/modules/platform/` | `docs/ref/features/platform/` |
| `docs/ref/modules/tenant/` | `docs/ref/features/tenant/` |
| `docs/ref/modules/SLA.md` | `docs/ref/features/SLA.md` |

`modules/` 只留模組總覽與互動流程引擎。本檔較早的紀錄提到的舊路徑，是當時的位置，不回頭改寫；可點擊的連結已改成新路徑。

## 2026-09-30：租戶後台逐模組深入，新增十九個項目並修正 SEC-04

起因是把[租戶後台](../features/tenant/README.md)拆成各功能區的獨立文件。做法是逐一讀每個功能區的路由、服務、workers handler 與前端呼叫點，對照前端文案與實際行為，並追查跨模組的事件與 token 流向。

| 新項目 | 判定依據 |
| --- | --- |
| RLS-06 | `handleCsatResponse()` 以 `/^csat:(\d):([a-f0-9-]+)$/i` 比對 `textContent` 或 `postbackData`；`recordCsatScore()` 以 `case.findUnique({ where: { id: caseId } })` 查詢；`webhook.routes.ts` 以 `fastify.prismaAdmin` 呼叫 `processWebhookEvent()`；`recordKbFeedback()` 有 `conversation: { tenantId }` 條件 |
| RBAC-04 | `socket.plugin.ts` 在 `connection` 時無條件 `socket.join()` 加入 `tenant:<租戶 ID>` 房間；`sendMessage()` 與 `emitToConversationAndTenant()` 都以 `io.to()` 把 `message.new` 發到租戶房間；`contact.routes.ts` 與 `ai.routes.ts` 沒有引用 `channel-visibility`；`case.routes.ts` 的 `POST /` 與 `GET /stats` 沒有呼叫 `assertCaseChannelVisible` 或 `resolveChannelVisibility` |
| TEAM-01 | `team.create`、`agentTeamMember.create` 在 `apps/*/src`、`packages/*/src` 與 `seed.ts` 都沒有出現；`ChannelTeamAssignment.tsx` 只呼叫 `GET /channels/teams` 列出既有團隊 |
| AUTH-05 | `auth.plugin.ts` 以 `config.JWT_SECRET` 註冊 `@fastify/jwt`，`authenticate` 只 `jwtVerify()`；`portal-auth.service.ts` 的 `signFanToken()` 以同一把密鑰簽 `{ sub: 'fan', contactId, tenantId }`；`/fan/auth` 只 `contact.findFirst({ where: { id: contactId, tenantId } })`；`resolveRoleId()` 以 `agent.findFirst({ where: { id: request.agent.id, tenantId } })` 查角色；`signRefreshToken()` 與 `createLineMcpConfirmation()` 也用同一把密鑰 |
| SEC-05 | `auth.routes.ts` 以 `global: false` 註冊外掛；有 `config.rateLimit` 的路由只有 Passkey 各路由與 `/cli/login`；`git log -L` 顯示 `/login` 從未設定；`login()` 沒有失敗計數 |
| CONV-02 | `ChatWindow.tsx` 的 `handleAssign` 與狀態選單呼叫 `PATCH /conversations/:id`；`updateConversation()` 沒有 `eventBus.publish`；`conversation.assigned` 在 `apps/api/src` 只出現在 eventBus 型別、`notification.worker.ts` 的訂閱與 `action-executor.ts` 的 socket `emit` |
| CONV-03 | `sendMessage()` 的失敗分支只寫 log 或 `lineDeliveryStatus`；`deliveryFailed` 只有 `apps/workers/src/lib/channel-delivery.ts` 寫入；`POST /:id/messages` 以 `const { message } = await sendMessage(…)` 丟棄 `delivery`；`useMessages.ts` 不讀 `delivery` |
| AUTO-03 | `automation-actions.ts` 的 `add_tag` 以 `{ name: tagName!, tenantId }` 查詢，找不到就 `tag.create({ data: { tenantId, name: tagName } })` |
| AUTO-04 | `keyword-replies/page.tsx` 的說明文字；`checkKeywordTriggers()` 沒有狀態條件；`RATE_LIMIT_MAX` 只在 `action-executor.ts`；`git log -S` 指向 `fff80d8` |
| AUTO-05 | 比對 `AUTOMATION_EVENT_NAMES` 與 `automation.worker.ts` 送進 queue 的 `trigger:` 值；`contact.updated`、`message.postback`、`case.status_changed`、`case.updated` 在 `apps/api/src` 與 `apps/workers/src` 沒有 `name: '…'` 的發布 |
| CONTACT-01 | 比對 `mergeContacts()` 與兩份 `mergeContactIntoTarget()` 觸及的資料表；`diff` 確認兩份 `mergeContactIntoTarget()` 相同；migration 中 `point_transactions_contactId_fkey` 與 `portal_submissions_contactId_fkey` 為 `ON DELETE RESTRICT` |
| IDENT-01 | `mergeSuggestion.create` 只在 `detectPhoneDuplicates()`；該函式、`stitchByPhone()`、`stitchByLiffCookie()` 在 `apps/*/src` 沒有呼叫端 |
| MKT-01 | `/broadcasts/:id/send` 的 handler `await executeBroadcast()`；狀態白名單含 `sending` 與 `failed`；`executeBroadcast()` 沒有查詢既有 `BroadcastRecipient` |
| SHORT-01 | `/s/track` 的 handler 直接把 `cid`、`lineUid` 傳給 `trackClick()`；`shortlink-redirect.routes.ts` 沒有 `rateLimit`；`isUnique` 只在有 `lineUid` 時去重 |
| ANA-01 | migration 中 `"createdAt" TIMESTAMP(3)`；`analytics.service.ts` 以 `date_trunc(…, "createdAt")` 分組，沒有 `AT TIME ZONE` |
| CHAN-01 | `deleteChannel()` 呼叫 `prisma.channel.delete()`；schema 中 `Conversation`、`ChannelUsage`、`RichMenu` 的 `channel` 關聯沒有 `onDelete`；`apps/api/src` 沒有 `P2003` |
| AUD-01 | 列出 `apps/api/src/modules` 中所有 `writeTenantAudit` 的 `action`；`auth`、`marketing`、`automation`、`knowledge`、`tag` 的路由檔沒有呼叫 |
| ERASE-01 | 列出 `data-erasure.handler.ts` 觸及的資料表；`ClickLog`、`BroadcastRecipient`、`KbArticleFeedback`、`FlowExecution` 在 schema 中只有 `contactId` 欄位、沒有 `Contact` 關聯 |
| DB-04 | `Conversation.teamId` 在所有 `conversation.create`／`update` 附近都沒有寫入；`parentCaseId`、`caseRelation` 在 `apps/*/src` 沒有出現；`isBlocked` 在 `apps/web/src` 沒有出現、在 `apps/api/src` 只出現在 `contact.routes.ts` 的 schema |

**既有項目的補充。** RBAC-03 補上 `recordCsatScore()` 只通知 `SUPERVISOR` 的一列。PLAN-06 補上現成但沒有呼叫端的 `clearQuotaAlertFlags()`。PLAN-07 補上重新啟用渠道不檢查數量上限。APP-02 補上 WhatsApp 可以建立但沒有外掛。RLS-02 補上 IDENT-01 的影響：目前沒有任何合併建議，跨租戶路徑沒有資料可以操作。RLS-02 的優先順序維持 P1，因為接上產生端後會立即生效。

**修正 SEC-04。** 表格中 `auth.routes.ts` 那一列原本寫「租戶登入、passkey、CLI 登入各每分鐘 10 次」。租戶的密碼登入實際上沒有限制，已改正，並另立 SEC-05。

**優先順序的判斷。** AUTH-05 標為 P1：只驗登入的路由涵蓋整個收件匣，socket 更能即時收到全租戶的訊息，而被停用的成員就具備取得 token 的條件。SEC-05 標為 P1：不需要任何前提就能暴力嘗試密碼。RLS-06 比照 RLS-02、RLS-05 標為 P1，而且觸發者是任何外部使用者，不需要是租戶成員。

**同時修正的文件錯誤。** `tenant/INBOX.md` 初稿寫「客服收不到看不見的渠道的即時事件」，查到租戶房間後改正。`OVERVIEW.md` 把 MCP 的認證寫成「JWT 或 CLI session」，實際只接受帶 `mcp:read` 的 CLI token，已改正。

## 2026-09-30：撰寫租戶後台文件時的盤點，新增十一個項目

起因是撰寫[租戶後台](../features/tenant/README.md)。做法是從側欄的每一項出發，追到負責的路由、服務與背景工作，再對照前端實際呼叫的端點。

| 新項目 | 判定依據 |
| --- | --- |
| RLS-05 | `line-profile.routes.ts` 只掛 `authenticate`，把 `channelId` 交給 `syncLineContactProfile(fastify.prismaAdmin, …)`；服務的 `channelIdentity.findUnique` 與 `channel.findFirst` 都沒有 `tenantId`；`check-prisma-admin-usage.mjs` 以 `/modules\/line\/line-profile/` 列入白名單；`apps/web/src`、`apps/cli/src` 與 `modules/mcp` 都找不到 `sync-profile` |
| RBAC-03 | grep `role: 'AGENT'`、`role: { in: ['SUPERVISOR', 'ADMIN'] }`、`role: 'ADMIN'` 的結果；`resolveRoleAssignment()` 對自訂角色回傳 `input.role ?? fallbackRole` |
| A2A-01 | `a2a-bridge.worker.ts` 以 `tenant.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })` 挑租戶；`agent.service.ts` 的 `recordUsage()` 以 `input.tenantId` 記錄用量，並帶 `keySource` |
| CONV-01 | `inactivityCloseHours` 在 `apps/api/src`、`apps/web/src`、`apps/cli/src` 與 `seed.ts` 只出現在 `inactivity-close.worker.ts` 的讀取；`tenantSettings.create`／`upsert` 只出現在設定類服務的延遲建立與 `settings.routes.ts`，開通租戶的 `platform-tenant.service.ts` 與 `trial` 模組都沒有 |
| CASE-01 | `CaseDetail.tsx` 的 `handleStatusChange()` 呼叫 `PATCH /cases/:id`；`updateCase()` 有 `validateTransition()`，但沒有 `caseEvent.create` 與 `eventBus.publish`；`transitionCase()` 兩者都有 |
| AUTO-01 | 逐一比對 `executeWorkerAutomationActions()` 的分支與 `AUTOMATION_ACTION_DEFINITIONS`；`action-executor.ts` 在 `apps/api/src` 沒有 import 者；`git log -S "executeActions("` 指向 `9255245` |
| AUTO-02 | `automationLog.create` 與 `runCount: { increment: 1 }` 只出現在 `action-executor.ts`；`automationExecution` 在 `apps/*/src` 與 `packages/*/src` 都沒有出現 |
| APP-05 | `sla.warning`、`sla.breached` 在 `apps/api/src` 只出現在 eventBus 的型別宣告與 `notification.worker.ts` 的訂閱 |
| APP-06 | `index.ts` 無條件註冊 `simulatorRoutes`；`SimulatorPanel.tsx` 以 `process.env.NODE_ENV !== 'development'` 隱藏；`simulateInboundMessage()` 發布 `message.received` |
| DB-02 | 與標籤相關的 `expiresAt` 只出現在 `line-login.service.ts` 與 `fb-login.service.ts` 的合併程式 |
| DB-03 | `dailyStat` 在 `apps/api/src` 與 `apps/workers/src` 只出現在 `analytics.aggregator.ts` |

**優先順序的判斷。** AUTO-01 標為 P1：前端直接提供這些動作，照正常操作建立的規則就會靜默失效，不需要特殊條件。RLS-05 比照 RLS-02 標為 P1：兩者都要先取得其他租戶的識別碼，但取得之後就能跨租戶讀寫。A2A-01 只在啟用橋接時觸發，因此標為 P2。

**同時修正的文件錯誤。** `modules/OVERVIEW.md` 把 `settings` 模組寫成「僅需登入」。實際上 `settings.routes.ts` 在整個 plugin 掛了 `requirePermission("settings.manage")`。已改正，並補上原本漏列的 `/api/v1/simulator` 與 `sync-profile` 兩條路由。

## 2026-09-30：CLI token 的授權路徑，新增 RBAC-02，並修正 SEC-03 與 SEC-04

起因是補寫 PLAN-08 時讀到 `requirePermission()` 遇到 `isCliSession` 就直接放行。做法是追完 CLI token 的整條路徑：哪些驗證函式接受它、哪些路由掛這些驗證函式、token 怎麼發出、scope 怎麼決定，以及 CLI 路由與 MCP 工具做了哪些檢查。

| 新項目 | 判定依據 |
| --- | --- |
| RBAC-02 | `authenticate` 只接受 JWT；接受 CLI token 的只有 `authenticateCliSession` 與 `authenticateJwtOrCliSession`，掛在 `/auth/me`、`/auth/cli/logout`、`cli.routes.ts` 與 MCP；這些路由只檢查 scope；`/auth/cli/login` 不分角色發出含 `cli:analytics:read` 的預設 scope；`/settings/cli-sessions` 的 `scopes` 不設白名單；`mcp.server.ts` 的工具沒有任何角色或方案檢查 |

`requirePermission()` 的 `isCliSession` 放行本身目前碰不到，因為沒有路由同時接受 CLI token 又掛 `requirePermission()`。真正的問題在於 CLI 整條路徑用 scope 取代了 RBAC 與方案天花板，因此寫成 RBAC-02，放行那段列為其中一點。

**修正 SEC-03。** 原本寫「這是整個 API 唯一一處註冊這個外掛」，這句從寫入時就是錯的。`auth.routes.ts` 自 2026-06-04（`00aa7ee`）、`trial.routes.ts` 自 2026-08-25（`acb7568`）就各自註冊了；`chatbox.routes.ts` 與 `webchat.routes.ts` 也有。實際是五個路由模組各自註冊。SEC-03 所說的陷阱（搬移路由時 `config.rateLimit` 會被靜默忽略）仍然成立，而且適用於五個模組，因此改寫描述與標題，結論不變。

**補正 SEC-04。** 原本的表只列三個模組。`chatbox.routes.ts` 與 `webchat.routes.ts` 的 `keyGenerator` 也是 `request.ip`，同樣受影響，已補上。

## 2026-09-30：對照 main 複查，並移除文件中的程式碼行號

本地 `main` 同步到 `8611bf8` 後，本分支落後 `main` 46 個 commit。這些 commit 改到 AUDIT 常引用的檔案，因此逐項對照 `main` 複查。

結果：沒有任何項目被修正，也沒有任何結論被推翻。受影響檔案的改動全是錯誤訊息整理（`bc3b529`、`9dd15dd`、`ad4edc6`、`6f7a724`）：英文訊息改成中文、回應格式統一。逐項確認的行為如下：

| 項目 | 在 `main` 上的確認結果 |
| --- | --- |
| AUTH-03 | `auth.plugin.ts` 只改訊息，仍然沒有撤銷 token 的機制 |
| AUTH-04 | `updatePlatformUser()` 只改訊息，改 email 仍然不通知 |
| SEC-04 | `trustProxy: true` 仍在 |
| RBAC-01 | 15 個權限碼在 `apps/api/src` 仍然出現 0 次 |
| SLA-01 | `firstResponseAt` 仍然沒有寫入端 |
| SLA-03 | 挑政策時仍然沒有 `isDefault`，也沒有 `orderBy` |
| PLAN-12 | `ai.routes.ts` 只改訊息，路由仍然沒有權限碼 |

`ad4edc6` 修正了 403 的回應格式：改成全站一致的結構，並在 `details` 附上 `requiredPermission`。回應仍然分不出是角色沒有權限，還是方案不含這個功能，因此 PLAN-08 的結論不變。這個細節已寫進 PLAN-08，並列出本分支與 `main` 兩個版本的回應內容。寫入時另外確認：`requirePermission()` 比對的已經是交集，所以無法分辨是角色沒有還是方案不含；而訊息「如需使用請聯繫管理員」把使用者導向租戶管理員，實際能處理的是平台方。

複查時發現 9 處行號引用已經指到別的程式碼，其中 `index.ts` 的 `trustProxy` 偏移後落在空白行。行號會隨任何改動偏移，而且過期時會默默指到別的程式碼，讀者不會發現。因此把現況文件的行號全部移除，改用不會因上下文增減而移動的定位方式：

| 情況 | 寫法 |
| --- | --- |
| 在某個函式裡 | 檔名加函式名，例如 `plan-limits.service.ts` 的 `resolveEffectiveLimit()` |
| schema | 檔名加 model 或欄位，例如 `schema.prisma` 的 `Case` |
| 沒有函式名可指 | 引用一段可以 grep 的程式碼，例如 `case.routes.ts` 的 `action: 'case.delete'` |

範圍是 `AUDIT.md` 41 處、`modules/SLA.md` 1 處、`modules/platform/README.md` 1 處。改完後以腳本確認 41 個定位在本分支與 `main` 上都找得到。

本文件的行號不改。每一則紀錄都有日期，記的是當天的程式碼。

## 2026-09-30：摘要表加上內文連結與處理狀態

摘要表的 ID 改成連到內文的連結。錨點用明確的 `<a id>` 放在每個標題上方，不依賴標題文字自動產生的錨點，因此標題改寫時連結不會斷。

另外新增「處理狀態」欄，把修正進度從其他欄位分離出來。先前修正進度散在三處：

| 位置 | 原本的寫法 | 問題 |
| --- | --- | --- |
| 驗證狀態欄 | LLM-03 寫「部分修正」 | 覆蓋掉原本的驗證方式，這一欄因此混了兩種意思 |
| 問題描述 | SEC-01 寫「（API 已修正）」 | 狀態寫進了問題描述裡 |
| 內文的修正方向區塊 | AUTH-01、TRIAL-02、USAGE-02 | 摘要表看不出來 |

分離後，LLM-03 的驗證狀態改為「靜態確認」。它目前的描述來自 2026-09-23 的分支複查，當時的比對是靜態的。

部分修正的項目仍在問題描述寫明哪部分已修、哪部分未修，並附修正的 commit。只看「部分修正」四個字，讀者無從得知修了什麼。SEC-01 與 LLM-03 的描述都依此改寫。

各項的處理狀態依內文判定：LLM-03 與 SEC-01 是部分修正；AUTH-01 與 TRIAL-02 的修正方向已經討論定案；USAGE-02 的修正方向是提出的建議，還沒確認。其餘各項都是未處理。

同時定下規則：一項完全修正之後從 `AUDIT.md` 移除，修正它的 commit 記在本文件。

## 2026-09-30：整理 `AUDIT.md` 的章節結構

`AUDIT.md` 隨盤點逐次增長，章節與摘要表已經對不上。這次只調整結構，不改任何項目的內容與 ID。整理前後以腳本比對內容行，差異只有下列刻意的改動。

整理前的問題：

- 摘要表的「範圍」欄中英混用（`Apps`、`Security`、`Test`、`用量`、`AI` 等），而且沒有一個值與章節名稱相同。
- PLAN-12 放在「AI 用量與金鑰」章節，摘要表卻標「試用與方案」。USAGE-01、AI-01、USAGE-02 在內文中交錯排列。
- 「試用與方案」與「授權與安全」各自塞進十多項。後者混合了 License、渠道加密金鑰、平台帳號、租戶帳號與 RBAC。
- 兩個章節開頭記的是發現經過（「以下四項在 2026-09-23 盤點…發現」），這屬於本文件的範圍，而且數量會過期。

整理後：

- 章節依內容重新分組：租戶隔離與權限、帳號與登入、金鑰與 License、試用、方案與額度、AI 用量與成本、SLA、部署與應用程式、共用套件、Storage、LLM 與資料庫、CI 與測試。安全相關的章節排在前面。
- 摘要表的「範圍」欄改成章節名稱，列的順序與內文相同。
- 業務領域的章節開頭改成一行「功能說明見⋯」，連到對應的模組文件。原本的發現經過已記在本文件先前的紀錄中，直接刪除。
- 檔頭的最近複查日期改為 2026-09-30，優先順序的標示日期同步更新。

## 2026-09-30：平台模組的設計缺陷補查，新增 AUTH-03、AUTH-04、TRIAL-03

起因是請求再看一次平台模組有沒有漏掉的設計缺陷。做法是回頭比對平台各領域文件已記的事實，哪些還沒有對應的 AUDIT 項目，再逐項回原始碼確認。

| 新項目 | 判定依據 |
| --- | --- |
| AUTH-03 | `authenticatePlatformSuperuser` 只查 `isActive` 與 `mustChangePassword`；`PlatformUser` 沒有 `tokenVersion` 或 `passwordChangedAt`；平台沒有登出路由 |
| AUTH-04 | JWT 的 `role` 固定是 `PLATFORM_SUPERUSER`；`apps/api/src/modules/platform/` 找不到 MFA、TOTP、passkey 或 WebAuthn；`updatePlatformUser()` 改 email 時不寄信 |
| TRIAL-03 | `purgedAt` 的寫入端只有排程，讀取端只有狀態顯示與復原；全 repo 沒有依 `tenantId` 刪除業務資料的程式，也沒有刪除租戶的路由 |

查證後確認沒有問題、不開項目的部分：

- 入站 webhook 在 `webhook.service.ts:58` 檢查 `tenant.isActive`，停用的租戶不會繼續收訊息，也不會觸發 AI 自動回覆。
- `mustChangePassword` 在 `platform.routes.ts:152` 的 guard 確實有擋，改密碼以外的操作都會被拒。
- `PATCH /platform-users/:id` 寫 `platform_user.update` 稽核，payload 是請求內容，改 email 會留下紀錄。
- 平台臨時密碼以明文 email 寄送，但有 `mustChangePassword` 強制首次登入就改密碼，屬於常見做法。

## 2026-09-30：平台 KV 設定的寫入與讀取，新增 TRIAL-02

起因是[平台設定](../features/platform/SETTINGS.md)描述的 KV 做法缺點很多，要為它提出修正方向。做法是追完一個設定值從寫入到被使用的整條路徑：`/admin/trial` 設定分頁、`PUT /settings/:key`、`getTrialPolicy()`，以及各參數在 `trial.service.ts` 與 `trial.scheduler.ts` 的使用處。

| 新項目 | 判定依據 |
| --- | --- |
| TRIAL-02 | `PUT` 的驗證是 `z.unknown()`；`getTrialPolicy()` 只做 `typeof`；`durationDays`、`dataRetentionDays`、`verifyTokenTtlHours` 直接乘上毫秒數使用，沒有範圍檢查；`planSlug` 在 `verifyAndProvision()` 查不到方案時回 500；前端 `saveSetting()` 沒有 `catch`；沒有刪除端點 |

原本 `SETTINGS.md` 只記了型別不符會靜默退回預設值。這次補上相反方向：型別正確但範圍錯誤的值會通過檢查並照用。兩個方向都沒有訊息。

`SETTINGS.md` 的敘述裡有三處數量（「三件事」「六個鍵」「五個鍵」），一併改成不含數量的寫法。

同日討論後改寫修正方向：KV 表保留為底層儲存，上面加一層依設定群分路徑的殼層，由註冊表產生。原本「在寫入端驗證」與「改成單一鍵」兩個建議併入這個設計，底層採一群一列。

## 2026-09-30：價目表的寫入途徑，新增 USAGE-02

起因是[用量統計](../features/platform/USAGE.md)的「價目表沒有維護介面」一節，要為它提出修正方向。查證時追了三件原本沒寫的事：seed 在正式環境是否可用、查無價目是否進快取、缺價期間的成本能否事後修正。

| 新項目 | 判定依據 |
| --- | --- |
| USAGE-02 | `modelPricing` 的唯一寫入端是 `seed.ts:168`；`seed.ts` 的 `main()` 會建立 Demo Tenant 與固定密碼帳號；`getPricing()` 把 `null` 一併寫入 `pricingCache`；`clearPricingCache()` 全 repo 零呼叫端；成本在 `recordAiUsage()` 寫入時定版，沒有重算路徑 |

因此原本那節寫的「調價要改 seed 或直接改資料庫」在正式環境只剩後者一條路。三項查證都併進 `USAGE.md` 的同一節。

條目附了修正方向：補一組 `ModelPricing` 的平台路由並寫稽核、快取失效改走 Redis、查無價目不進快取、既有零成本列若不重算至少讓 `/admin/usage` 顯示 `usageMissing` 筆數。schema 不需要改動，`(model, effectiveFrom)` 已經支援版本化。

## 2026-09-29：AI 的方案控制點，新增 PLAN-12

承上一則。確認 AI-01 退回平台金鑰之後會扣哪一份額度時，延伸出一個問題：方案若不含 AI，租戶是不是就無限制可用。做法是回頭清點 AI 的所有入口與可用的控制點。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-12 | `FEATURES` 的八個 slug 沒有 `ai`；`ai.routes.ts` 七條路由中五條只有 `fastify.authenticate`；`kb-autoreply` 與自動化動作不經過路由；控制只剩 `limits.monthlyTokens`，而未定義與 `null` 都回傳無上限 |

問題的前提不成立：方案表達不出「沒有 AI」。要停用只能把 `monthlyTokens` 設成 `0`，`0` 會讓 `used >= limit` 恆成立。

兩點與 PLAN-07 對照後刻意寫進條目，避免日後被讀成比實際嚴重：`seedPlans()` 的五個方案都定義了 `monthlyTokens`，現況沒有踩到；`/admin/plans` 的欄位標題寫明「留空 = 無上限」，`setLimit()` 對非數字輸入也會維持原值。`maxChannels` 沒有這兩層保護。

## 2026-09-29：BYOK 的金鑰解析路徑，新增 AI-01

起因是一個提問：BYOK 是什麼。查證時發現這個詞在文件裡出現多次卻從未定義，也順著 `resolveGeminiKey()` 讀完整條金鑰解析路徑。

| 新項目 | 判定依據 |
| --- | --- |
| AI-01 | `ai-key.service.ts` 的解密 `catch` 區塊是空的，直接落到 fallback 回傳 `source: 'platform'`；`llm.service.ts:80` 的 `!isByok` 決定是否計成本，`incrMonthlyTokens()` 與 `llm.service.ts:264` 決定是否計額度與是否擋下 |

釐清一件容易搞反的事：退回之後**成本由平台承擔**，不是由租戶承擔。呼叫改用平台的 `GEMINI_API_KEY`，Google 的帳單開給平台；租戶付出的是額度，因為那些 token 開始計入 `monthlyTokens`，用完還會被擋。租戶的金錢支出不變，系統本來就沒有計費機制（見 PLAN-10）。

`ai-key.service.ts` 的加解密複用 `channel.service.ts` 的函式，與渠道憑證共用 `CREDENTIAL_ENCRYPTION_KEY`，因此一次金鑰輪替會讓所有租戶的 BYOK 同時退回。

`AUDIT.md` 原本為 USAGE-01 開的「用量統計」章節改名為「AI 用量與金鑰」，兩項共用。BYOK 的定義補在[用量統計](../features/platform/USAGE.md)第一次使用該詞的位置。

## 2026-09-29：用量頁的說明文字，新增 USAGE-01

起因是一個提問：[用量統計](../features/platform/USAGE.md)記下的「失敗呼叫完全不計入」有沒有寫在前端介面上。做法是把 `/admin/usage` 的每一句說明文字與 `platform-usage.service.ts` 的查詢條件逐句對照。

結果是介面寫對了。頁首的「僅計成功呼叫」、「AI 呼叫數」卡片的「成功呼叫」、「總成本」卡片的「平台承擔（不含 BYOK）」三句都與實作相符。錯的只有服務檔開頭的註解，而那正是先前誤讀的出處。

| 新項目 | 判定依據 |
| --- | --- |
| USAGE-01 | 三個查詢都沒有 `keySource` 條件也不看 `usageMissing`，但只有成本卡標了「不含 BYOK」；`platform-usage.service.ts:65` 是 `take: 50`，排行標題沒有標上限 |

## 2026-09-29：方案異動申請的讀取途徑，新增 PLAN-11

起因是[方案異動審核](../features/platform/PLAN-CHANGES.md)的「平台看不到歷史」一節。確認平台側除了待審列表之外還有沒有其他讀取途徑，逐一查了三條：租戶詳情頁的 `select`、平台稽核的查詢端點，以及租戶側的列表。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-11 | `listPendingRequests()` 的 `where` 寫死 `status: 'pending'`，平台側無第二個列表端點；`getTenantDetail()` 的 `select` 不含 `planChangeRequests`；`getPlatformUserAuditLogs()` 只能依 `platformUserId` 或 `targetType = 'platform_user'` 查，上限 200 筆 |

同一批資料，租戶側的 `listTenantPlanChangeRequests()` 不分狀態回最近 50 筆。因此這是讀取途徑的落差，不是資料保存的問題。

## 2026-09-29：摘要表加上修復優先順序

`AUDIT.md` 的摘要表新增「優先」欄。方向與級距先在 repo 內量過再決定，不是套外部慣例：

| 出處 | 既有寫法 |
| --- | --- |
| `docs/00_WHY_AND_VISION.md` | `P1` 到 `P3` 標示問題輕重，`P1` 最重 |
| `docs/JIRA_STRUCTURE.md` | 優先 label 是 `critical`／`high`／`medium`／`low` |
| `docs/TRIVY_SCAN_REPORT_*.md`、`docs/security/dependency-triage-*.md` | `CRITICAL`／`HIGH`／`MEDIUM`／`LOW` |

三處一致：數字越小越優先，級距是四級。因此採 P1 到 P4，並在 `AUDIT.md` 加一節寫明判定標準。repo 沒有 1 到 9 的先例，項目數也支撐不起九級的分辨度。

這一輪只標優先順序，沒有改動任何項目的內容。

## 2026-09-29：計費面盤點，新增 PLAN-10

起因是一個提問：加購既然是永久提高每月額度，租戶的帳單是不是每個月都被算進去。做法是靜態搜尋整個 repo 的計費相關實作，再逐一確認 `priceMonthly`、`PlanChangeRequest`、`model_pricings` 與 `billing.view` 各自的角色。

結論是系統不產生帳單，因此不存在重複收費。`Plan.priceMonthly` 的 schema 註解寫明「顯示用，不接金流」，schema 沒有帳單、發票或付款的資料表，也沒有任何程式把用量或方案換算成應收金額。這是設計決策，不開項目。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-10 | `PlanChangeRequest` 沒有金額欄位；`limitOverrides.monthlyTokens` 是合併值；`Plan.limits` 沒有變更歷史且稽核只記新值；`limitOverrides` 沒有讀取端 |

`priceMonthly` 的讀取端只有兩處，都在平台後台：`/admin/plans` 的顯示，以及 `listPlans()` 的排序。租戶端沒有任何路由或頁面拿得到它。

`model_pricings` 算的是平台自己的 LLM 進貨成本，不是租戶售價；它只出現在 `/admin/usage`。

RBAC-01 的 `billing.view` 一併補上說明：該權限碼的描述是「租戶站內方案/用量頁」，而那個頁面不存在。`/dashboard/plan` 只有申請表與申請列表。

PLAN-02 的結論也隨之收斂。先前寫「不確定是缺陷還是原本的設計」，在確認沒有計費機制之後可以講得更明確：永久提高額度不會造成重複收費，實際結果是平台往後每個月都無償提供同樣的加購量。

## 2026-09-29：方案三個控制面的其餘部分，新增 PLAN-08 與 PLAN-09

承上一則。上一輪只追了數值上限，這一輪補完方案的另外兩個控制面（功能天花板、渠道白名單），以及改方案這個操作本身。做法是靜態追路由、服務與前端頁面，沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-08 | 比對 `getEffectivePermissions()` 與 `getEffectiveTenantPermissions()` 的呼叫端：guard 走後者，`setRolePermissions()` 的越權防護走前者；`GET /roles/matrix` 回整份註冊表；`seedRolesForTenant()` 給 admin 的是 `PERMISSIONS.map((p) => p.code)` |
| PLAN-09 | `listPlans()` 沒有 `_count`；`RolePermissionMatrix.tsx` 與 `/admin/plans` 都沒有方案感知；`plan.update` 的稽核 payload 是請求主體 |

PLAN-07 一併擴充：`seedPlans()` 的 `upsert` 沒有傳 `allowedChannelTypes`，五個方案都落在預設值 `[]`，而 `[]` 代表不限制。加上原本缺的 `maxChannels`，渠道這個維度的兩個分級機制都沒有方案填過值。

本次確認無誤、不開項目的部分：

- 所有 guard 路徑都用套過天花板的 `getEffectiveTenantPermissions()`：`rbac.guard.ts`、`socket-room-authorization.ts`、`channel-visibility.ts` 與 `/auth/me/permissions`。沒有漏走天花板的判斷點。
- `features` 雖然不驗 slug（見[方案與功能](../features/platform/PLANS.md)），但 `/admin/plans` 的功能清單是從 `GET /registry` 產生的勾選項，介面操作打不出不存在的 slug。風險只存在於直接呼叫 API。
- `limits` 沒有任何快取，`getEffectiveLimit()` 每次都查資料庫，因此改上限不會有陳舊資料問題。
- `permissionOverrides.deny` 在路由層驗過權限碼。資料庫裡若留著已下架的碼，`ceiling.delete()` 對不存在的碼是空操作，沒有後果。

## 2026-09-29：AI 月額度的寫入與判定路徑，新增三個方案項目

起因是質疑加購直接改寫 `limitOverrides.monthlyTokens` 的做法。做法是靜態追完整條路徑：`plan-change.service.ts` 的核准、`plan-limits.service.ts` 的上限解析、`token-quota.service.ts` 的計數與告警、`llm.service.ts` 的硬擋點，以及 `limitOverrides` 的所有讀寫端。沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-05 | `resolveEffectiveLimit()` 只判斷 key 是否存在，不與方案的 `limits` 比大小；三個換方案入口都只寫 `planId` |
| PLAN-06 | `clearTokenQuotaCache()` 只 `del` 計數器 key；告警旗標另有 key，`checkQuotaThresholdCrossing()` 以 `SET NX` 搶旗標，過期時間是月底 |
| PLAN-07 | 比對 `seedPlans()` 每個方案的 `limits` 鍵與 `LimitKey` 的四個值，`maxChannels` 在每個方案都缺 |

PLAN-07 是另一條線索：整理[方案與功能](../features/platform/PLANS.md)的「無上限」一節時，發現該節把「刻意設成無上限」與「缺少設定」列成同一組情況，於是逐一驗證每種情況在現有資料上是否成立，查出 `maxChannels` 從來沒有任何方案定義過。該節已改寫成依性質分列，並標出哪幾種是 fail-open。

判定的共同根因是一個資料模型問題：`limitOverrides` 的語意是狀態覆寫（絕對值），加購是事件（一次性增量）。把事件累加進狀態欄位之後，來源、時效與次數三項資訊都無法還原。PLAN-02、PLAN-03、PLAN-05、PLAN-06 都是這個根因的下游結果。

本次另外確認四件事，都不另開項目：

- **硬擋是呼叫前檢查。** `llm.service.ts:264` 在呼叫 LLM 之前比對 `used >= limit`，通過之後不限制該次呼叫的用量，也沒有預留機制。上限實際上是「軟上限加一次呼叫」。
- **額度的單位與成本的單位不同。** `monthlyTokens` 不分模型，但 `model_pricings` 算出的每 token 成本差異很大。平台用 token 設天花板，帳單是金額，兩者沒有對應關係，也沒有金額上限機制。
- **稽核記不到加購量。** approve 的稽核 payload 只寫 `{ type }`，沒有加購量，也沒有覆寫的前後值。要查只能回頭加總 `plan_change_requests.topupTokens`，而且那只在 `Plan.limits` 從未被編輯過時推得回來；方案的 `limits` 沒有變更歷史。
- **快取的對象與變動頻率相反。** 變動極慢的上限在每次 AI 呼叫查兩次資料庫（`isMonthlyTokenExceeded()` 與 `checkQuotaThresholdCrossing()` 各一次）；變動極快的已用量做了完整的 Redis 計數器，還處理了併發回填的 lost-update。該快取的沒快取。

## 2026-09-29：正式環境 Compose 的環境變數流向，新增 DEP-02

起因是先前討論平台寄信設定時擱置的一項：`.env.prod.example` 裡有幾個變數，正式環境的 Compose 未必送得到讀取端。做法是靜態比對 `docker-compose.prod.yml`、`docker-compose.yml`、各個 `.env.*.example` 與原始碼的讀取位置；另外用一份最小 Compose 檔確認 Compose 對缺少 `env_file` 的行為。

| 新項目 | 判定依據 |
| --- | --- |
| DEP-02 | 比對 `docker-compose.prod.yml` 的 `env_file` 分配、`nginx/entrypoint.sh` 與 `nginx/certbot-entrypoint.sh` 實際使用的變數，再 `grep` 每個變數在 `apps/` 下的讀取端與缺少時的 fallback |

Compose 的行為單獨確認過：`env_file` 指向的檔案不存在時，`docker compose config` 就報 `env file ... not found`，不會進到啟動階段。因此 `docker-compose.prod.yml` 開頭那份步驟說明照著做會在第一步就失敗，而不是啟動後才出問題。

本次另外確認兩件事，都不另開項目：

- `.github/workflows/deploy.yml` 沒有 `-f`，也沒有 `COMPOSE_FILE`，因此部署用的是 `docker-compose.yml`，不是 `docker-compose.prod.yml`。兩份檔案各自定義完整堆疊，反向代理也各一套（前者是 caddy，後者是 nginx + certbot）。
- 同一份 workflow 的「Fix caddy port for UAT」那一步執行 `sed -i 's/"80:80"/"8888:80"/'`，但 `docker-compose.yml` 裡沒有 `80:80`，caddy 早就寫成 `127.0.0.1:8888:80`。這一步現在是空操作，沒有後果。

## 2026-09-24：權限碼強制點盤點，新增 RBAC-01 與 PLAN-04

起因是討論要不要在[模組總覽](../modules/OVERVIEW.md)加一欄「這個模組屬於哪個 feature」。評估的結論是不加，因為推導所需的依據在一半以上的模組並不存在，而過程中查出的問題比那張對照表重要。做法是靜態比對原始碼與 OpenSpec 紀錄，沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| RBAC-01 | 逐一以權限碼 `grep` 掃 `apps/api/src`（排除測試），56 個碼中 15 個零命中；另比對命中處是 `requirePermission()` 還是稽核 `action` 字串 |
| PLAN-04 | 逐模組統計路由數與 `requirePermission`／`requireAnyPermission` 出現次數，再依 `permissions.ts` 的 `feature` 欄位分組；另查 `maxTags` 在 `apps/api/src` 只出現於型別宣告 |

不加對照表的理由值得留存：`apps/api/src/modules` 下的模組只有 18 個使用 `requirePermission`，模組到 feature 的推導對其餘模組沒有依據；而且就算推導得出，寫下「`case` 屬於 `inbox`」會讓讀者以為方案關掉 `inbox` 就停用案件功能，實際上不會。該欄位會把一個不成立的因果關係固化進文件。改為在[平台後台](../features/platform/README.md)的天花板一節補一句結構性事實：這個交集只在路由呼叫 `requirePermission()` 時計算。

盤點時另外確認三件事，都不另開項目：

- `guards/license.guard.ts` 的 `requireFeature()` 沒有任何呼叫端，而且讀的是 LIC-01 那份寫死的授權資料。feature 層級的閘門從未接上。
- `requireRole()`、`requireAdmin()`、`requireSupervisor()` 也沒有呼叫端。`case.routes.ts` 的 git 歷史查不到曾經使用，因此缺少授權判斷不是切換 guard 時漏掉的。
- 前端 `Sidebar.tsx` 會用 `/auth/me/permissions` 過濾選單，但「收件匣」「工單」「聯繫人」「通知」四個節點沒有 `perm` 欄位。前端隱藏本來就不等於後端擋住，這四項連隱藏都沒有。

## 2026-09-23：平台後台各領域逐檔細查，新增兩個方案項目

起因是把[平台後台](../features/platform/README.md)的領域文件從一兩句話補成完整說明。過程中逐支服務、逐條路由對照原始碼，發現兩項與方案有關的問題，也修正了三處我自己寫錯的描述。做法是靜態閱讀原始碼與前端頁面，沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-01 | `grep -rn "isActive" apps/api/src apps/web/src` 的命中全部屬於 `Tenant`、`Agent` 或 `PlatformUser`；三條指派方案的路徑都只用 `slug` 查，沒有一條加 `isActive` 條件 |
| PLAN-02 | `approveRequest()` 的 `token_topup` 分支寫入 `limitOverrides.monthlyTokens`；`token-quota.service.ts` 的計數器 key 帶年月且月底過期，`limitOverrides` 沒有期限欄位 |

同一次細查修正了三處既有文件的錯誤描述，都不另開項目：

- 有效上限的公式原本寫成 `limitOverrides[key] ?? Plan.limits[key]`。`resolveEffectiveLimit()` 實際用 `hasOwnProperty` 判斷，因此覆寫成 `null` 的意思是「這個租戶無上限」，不是「回去看方案」。`plan-limits.service.ts` 自己的註解也寫成 `??`。
- 用量統計原本寫「失敗的呼叫計入次數，但不計 token 與成本」。三個查詢的 `where` 都有 `success: true`，失敗的呼叫連次數都不算。`platform-usage.service.ts` 開頭的註解同樣寫錯。
- 改動租戶方案的入口原本列四處，漏了 `platform-tenant.service.ts` 的 `updateTenant()`。該函式帶 `planSlug` 時會改方案，也確實失效了兩層快取。

另外確認四件事，都不另開項目：

- 平台帳號沒有角色分級。`PlatformUser` 沒有 `role` 欄位，唯一的檢查是 JWT 的 `role` 是否等於 `PLATFORM_SUPERUSER`。能登入平台後台就能做這個模組的每一件事。
- 停用的生效時機兩邊不同。平台側每個請求都回查 `platform_users`，停用即時生效；租戶側的 `authenticate` 只驗簽章，但 `login()` 與 `POST /auth/refresh` 都會擋下停用的租戶，因此延遲最多是一個 access token 的有效期。兩者都是刻意的取捨。
- `ModelPricing` 沒有維護介面。平台後台沒有對應的路由或頁面，只有 `packages/database/prisma/seed.ts` 會寫入，而查價在行程內快取 10 分鐘。
- 平台的 rate-limit 以 `request.ip` 分組，而 `apps/api/src/index.ts` 設了 `trustProxy: true`，這個值取自 `X-Forwarded-For`。當時判斷要看部署架構才能定案，先併入 SEC-03。後續查了 `nginx/nginx.conf.template`，確認是附加而非覆寫，偽造值仍在最左邊，因此另開 SEC-04。

## 2026-09-23：試用生命週期追查，新增 TRIAL-01

起因是閱讀[平台後台](../features/platform/README.md)的試用管理一節時，發現該節只列函式行為、沒有說明誰能觸發，讀者無法判斷延長試用是逐筆操作還是批次。釐清的過程中比對了升級的兩條路徑，發現結果不一致。做法是靜態閱讀原始碼，沒有啟動容器。

判定依據，逐項串成一條可達的路徑：

| 環節 | 依據 |
| --- | --- |
| 試用租戶的 `ADMIN` 持有 `settings.manage` | `permissions.ts:101` 標示其 `feature` 為 `core`；`permission.service.ts:116` 讓 `core` 恆開 |
| 試用租戶可送出 upgrade 申請 | `POST /api/v1/plan-change` 只要求 `authenticate` 加 `settings.manage`；`createPlanChangeRequest()` 沒有試用租戶的檢查 |
| 核准後 `trialEndsAt` 不變 | `plan-change.service.ts:90` 的 upgrade 分支只寫 `planId` |
| 排程仍掃到該租戶 | `trial.scheduler.ts:34` 的條件是 `{ trialEndsAt: { not: null }, isActive: true }`，沒有方案條件 |
| 審核者看不到試用狀態 | `listPendingRequests()` 不回傳 `trialEndsAt`；`/admin/plan-changes` 頁面沒有相關欄位 |

同一次追查另外確認兩件事，都不另開項目：

- 試用政策的參數不是寫死的，存在 `PlatformSetting` 的 `trial.*` 鍵，預設值在 `trial-policy.service.ts` 的 `DEFAULTS`。`enabled` 預設為 `false`，整個試用功能需要平台後台手動開啟。
- `extendTrial()` 以「現有到期日與今天取較晚者」為基準，兩個方向都正確：尚未到期的租戶不會因延長而縮短，已到期的租戶不會把延長的天數浪費在過去。

## 2026-09-23：platform 模組盤點，新增兩個安全項目

盤點起因是評估「拆分 `platform.routes.ts` 有沒有風險」。評估的結論是先不拆，但過程中查到兩項與拆分無關、現在就存在的問題。做法是靜態閱讀原始碼，沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| SEC-02 | 以 route 區塊切分 `platform.routes.ts`，逐塊檢查 `post`／`patch`／`put`／`delete` 是否含 `writePlatformAudit`，四條沒有；再確認對應的三支服務內部也沒有寫 |
| SEC-03 | `grep -rn "rateLimit" apps/api/src` 只有 `platform.routes.ts` 一處註冊；比對 `apps/api/src/plugins/*.ts`，七支全部以 `fastify-plugin` 匯出並在根層註冊 |

盤點時另外確認三件事，都不另開項目：

- `platform` 模組的 service 層是 repo 中拆得最細的，十一支服務對應八個領域，`platform.routes.ts` 是唯一沒有跟著拆的檔案。模組歸屬與各領域的對應寫進[模組總覽](../modules/OVERVIEW.md)的平台後台一節。
- `platform` 模組沒有任何測試。這一點併入既有的 CI-01，不另計。
- 兩支租戶隔離檢查腳本的白名單是 `/modules\/platform\//`，以目錄為單位。在該目錄內怎麼拆都仍在白名單內，把檔案搬出目錄則會掉出白名單。

## 2026-09-23：SLA 功能盤點，新增四個項目

盤點範圍是 `apps/api/src/modules/sla`、`apps/workers/src/handlers/sla.handler.ts` 與 `packages/shared/src/sla`。做法是靜態閱讀原始碼與 schema，沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| SLA-01 | `grep -rn "firstResponseAt" apps/ packages/` 命中 15 處，全部是 schema 宣告、型別宣告、`select` 子句或讀取端，沒有任何一處寫入 |
| SLA-02 | `getActiveCases()` 的 `take: 100`，查詢沒有 `orderBy`，`where` 也沒有 `tenantId` |
| SLA-03 | `grep -rn "isDefault" apps/` 的 SLA 相關命中只有 `sla.routes.ts` 的寫入端與 `SlaManagement.tsx` 的顯示；`case.service.ts:279` 挑政策時沒有這個條件 |
| SLA-04 | `schema.prisma` 的 `SlaPolicy` 沒有 `Case` relation，`Case.slaPolicy` 是 `String?`；`sla.handler.ts:103` 以 `name` 回查 |

SLA-01 與其他三項的性質不同：它每天對每張套用政策的工單各產生一次假的逾時事件，不需要特定操作觸發，連帶讓分析報表的平均首次回應時間永遠沒有數值。其餘三項要在特定條件下才顯現。

盤點時另外確認 `apps/api/src/modules/sla/sla.worker.ts` 是刻意寫成的 no-op，用途是防止 API 行程啟動第二個掃描器，不是遺留程式碼。真正漏掉的第二套掃描器是既有的 APP-01（`packages/core` 的 `sla-monitoring` consumer），沒有另開項目。

## 2026-09-23：Canvas 模組盤點，新增四個租戶隔離項目

這次不是複查既有項目，是盤點 `apps/api/src/modules/canvas` 與 `packages/core/src/canvas` 時新增的項目。做法是靜態閱讀原始碼與設定檔，沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| RLS-01 | `grep -rn "from '@open333crm/database'" packages/*/src` 列出五個檔案，其中四個匯入 module-level `prisma` singleton |
| RLS-02 | 從 `canvas.routes.ts` 的 `/identity/suggestions/:id/approve` 追到 `merge-suggestion-service.ts` 的 `approveMerge()`，兩端都沒有 `tenantId` |
| RLS-03 | 兩支腳本的 `SCAN_DIR` 都寫死 `apps/api/src`；在 `main` 上執行 `node scripts/check-tenant-scoping.mjs` 只對 `canvas.worker.ts` 提出兩則提示，沒有提到 `packages/core` |
| RLS-04 | `.env.api.example` 有 `DATABASE_URL` 與 `DATABASE_URL_ADMIN`，沒有 `DATABASE_URL_TENANT`；`prisma.plugin.ts:31` 在未設定時 fallback |

RLS-02 與其他三項不同：它不只是第二層 RLS 失效，應用層也沒有比對租戶，因此兩層都不生效。

盤點時另外確認 Canvas 的 `AI_GEN` 節點呼叫 `BRAIN_SERVICE_URL`，這個變數在 repo 內沒有任何地方設定，預設值 `http://localhost:3001` 指向 API 自己，而 API 沒有 `/api/generate` 路由。這項歸入既有的 PKG-03（`brain` 尚未接線），沒有另開項目。細節見[互動流程引擎](../modules/CANVAS-FLOW-ENGINE.md)。

## 2026-09-23：所有分支的靜態複查，加上本機執行時重現

複查範圍是所有本地與遠端分支的最新 commit。做法分兩層：先用 `git grep` 比對每個項目的程式碼與設定，比對規則同樣先在盤點時的 commit `c6c4eff` 上驗證；再把 `docker-compose.dev.yml` 的開發環境啟動，實際重現其中十項。

靜態比對的結果：

- LLM-03：commit `ee251c8` 讓 `OLLAMA_BASE_URL` 對 Chat 生成路徑生效。`AUDIT.md` 已把這個項目改寫成部分修正，並列出仍然不讀環境變數的路徑。
- 其他 19 項：每個分支上都仍判定為存在。

執行時重現的結果：

| 項目 | 做法 | 結果 |
| --- | --- | --- |
| APP-01 | 掃 Redis 的 `bull:*` 鍵 | `sla` 與 `sla-monitoring` 同時存在 |
| APP-02 | 在 api 容器匯入 `@open333crm/channel-plugins` | 只匯出 `linePlugin`、`fbPlugin`、`webchatPlugin`、`threadsPlugin` 四個實例 |
| APP-03 | 比對啟動 log 與 `apps/api/src/index.ts` | log 寫 `LINE, FB, WEBCHAT`，程式註冊四個外掛 |
| PKG-02 | 在 api 容器 `import('@open333crm/channel-plugins/fb')` | `ERR_MODULE_NOT_FOUND` |
| PKG-03、PKG-04 | 看 `packages` 容器建置的目錄 | `brain` 與 `ui` 都在建置並啟動 watch |
| STO-01 | 在 workers 容器呼叫 `MinioStorageProvider` | `ECONNREFUSED 127.0.0.1:9000`。容器內只有 `S3_*`，沒有 `MINIO_*` |
| LLM-01、LLM-02 | 查 `tenant_settings` 的欄位預設值 | `chatBaseUrl` 與 `embeddingBaseUrl` 是 `http://localhost:11434`；`chatModel` 是 `qwen2.5:3b`，Compose 下載 `qwen2.5:0.5b` |
| DB-01 | 查 `information_schema` | 兩個 `embedding` 欄位都是 `vector(1536)` |
| DEP-01 | `docker volume ls` | `nm_videoworker` volume 存在，`apps/video-worker` 只有 `node_modules` |
| SEC-01 | 看 workers 容器的環境變數 | 本機有設定金鑰，因此本機不會走到備援字串。`credentials.ts` 的備援字串仍在 |

APP-01 另有一項旁證：在 api 容器單獨匯入 `@open333crm/channel-plugins` 之後，Node 程序不會自己結束，必須強制結束。匯入會連帶建立 Redis consumer。

本次另外發現兩件事，不屬於 `AUDIT.md` 的 20 個項目：

- `scripts/check-workspace-esm.mjs` 是 2026-09-15 新增的第三支嚴格檢查腳本，來自 CM-175 的 ESM interop 問題。三支腳本都沒有 CI 執行。`DELIVERY.md` 已補上這一支。
- 三支腳本在 `main` 上以 `--strict` 執行都通過。

## 2026-09-11：所有分支的靜態複查

複查範圍是所有本地與遠端分支的最新 commit。複查方式是用 `git grep` 比對每個項目的程式碼與設定，不啟動容器。比對規則先在盤點時的 commit `c6c4eff` 上執行，確認所有項目都判定為存在。

結果：

- SEC-01：包含 commit `f507fe1` 的分支已修正 API 端。Workers 端在每個分支上都仍存在。
- CI-01、CI-02：包含 commit `4b384b7` 的分支已沒有 `ci.yml`。`AUDIT.md` 已依這個現況改寫兩個項目的描述。
- 其他項目：每個分支上都仍判定為存在。
- LIC-01 補充：未合併的分支 `feat/add-license-billing-strategy` 把 API 的 `LicenseService` 改成可切換的 provider，不再寫死授權資料。該分支仍不連線到授權伺服器，也沒有改動 Core 的 `LicenseService`。
