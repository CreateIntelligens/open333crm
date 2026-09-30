# 實作落差與驗證紀錄

本文件集中記錄系統盤點時發現的實作落差，只描述各項的現況。其他系統文件只描述主要結構，不重複問題細節；每一項怎麼查證、在哪一次盤點發現，記在[實作落差複查紀錄](./AUDIT-REVIEWS.md)。

摘要表依章節排列，順序與內文相同。點 ID 可跳到該項的內文。

- **驗證環境**：`docker compose -f docker-compose.dev.yml`
- **執行時驗證日期**：2026-09-02
- **最近複查日期**：2026-09-30
- **限制**：開發環境沒有 Ollama，因此部分模型問題只能用設定與資料庫狀態驗證。

## 優先順序怎麼讀

「優先」欄是**修復順序**，不是嚴重度。**數字越小越優先**，P1 排最前面。

| 優先 | 對應 label | 判定標準 |
| --- | --- | --- |
| P1 | `critical` | 目前就在產生錯誤結果、資料跨租戶或安全暴露，不需要特定操作觸發，也沒有補償措施 |
| P2 | `high` | 會產生錯誤行為，但要滿足特定條件才觸發，或已有可繞過的做法 |
| P3 | `medium` | 設定與實際行為不符、介面與資料不一致、維運與稽核的落差。不影響現有功能的正確性 |
| P4 | `low` | 殘留設定、命名不符、未接線的程式碼。移除或改名即可，不影響任何行為 |

排序只反映「先修哪一個」，與修復成本無關。兩項同為 P1 時，先做哪一項由當時的人力與相依關係決定。

最近一次標示日期為 2026-09-30。項目的內容改變時要一併重看它的優先順序。

## 處理狀態怎麼讀

「處理狀態」記的是這一項修到哪裡，「驗證狀態」記的是這一項怎麼被確認，兩者互不影響。

| 處理狀態 | 意思 |
| --- | --- |
| 未處理 | 沒有修正方向，也沒有任何修正 |
| 已提建議 | 內文附有修正方向，還沒決定是否照做 |
| 已定方向 | 修正方向已經討論定案，尚未實作 |
| 部分修正 | 已有 commit 修掉其中一部分。問題描述寫明哪部分已修、哪部分未修，並附修正的 commit |

一項完全修正之後，從本文件移除，修正它的 commit 記在[實作落差複查紀錄](./AUDIT-REVIEWS.md)。

## 摘要

| ID | 範圍 | 優先 | 處理狀態 | 問題 | 驗證狀態 |
| --- | --- | --- | --- | --- | --- |
| [RLS-01](#rls-01) | 租戶隔離與權限 | P1 | 未處理 | Canvas 引擎不走租戶連線 | 靜態確認 |
| [RLS-02](#rls-02) | 租戶隔離與權限 | P1 | 未處理 | 身分合併審核端點沒有租戶檢查 | 靜態確認 |
| [RLS-03](#rls-03) | 租戶隔離與權限 | P3 | 未處理 | 隔離檢查腳本掃不到 `packages/*` | 靜態確認 |
| [RLS-04](#rls-04) | 租戶隔離與權限 | P3 | 未處理 | `.env.api.example` 沒有 `DATABASE_URL_TENANT` | 靜態確認 |
| [RBAC-01](#rbac-01) | 租戶隔離與權限 | P1 | 未處理 | 權限碼有一部分沒有強制點，收件匣一帶的路由只驗身分 | 靜態確認 |
| [AUTH-01](#auth-01) | 帳號與登入 | P2 | 已定方向 | 租戶端沒有忘記密碼流程，唯一的 ADMIN 忘記密碼就沒有復原途徑 | 靜態確認 |
| [AUTH-02](#auth-02) | 帳號與登入 | P2 | 未處理 | 停用租戶不會中斷既有的 Socket 連線，CLI token 也不受影響 | 靜態確認 |
| [AUTH-03](#auth-03) | 帳號與登入 | P2 | 未處理 | 平台帳號改密碼或重設密碼後，已發出的 token 仍然有效 | 靜態確認 |
| [AUTH-04](#auth-04) | 帳號與登入 | P2 | 未處理 | 平台帳號沒有權限分級也沒有第二因子，改 email 不通知原主而可被接管 | 靜態確認 |
| [SEC-02](#sec-02) | 帳號與登入 | P3 | 未處理 | 平台帳號的登入與密碼重設沒有寫入稽核紀錄 | 靜態確認 |
| [SEC-03](#sec-03) | 帳號與登入 | P3 | 未處理 | rate-limit 只註冊在 platform 路由的 scope 內 | 靜態確認 |
| [SEC-04](#sec-04) | 帳號與登入 | P1 | 未處理 | `trustProxy: true` 讓 `request.ip` 可由呼叫端偽造，速率限制形同虛設 | 靜態確認 |
| [SEC-01](#sec-01) | 金鑰與 License | P2 | 部分修正 | 渠道加密金鑰的硬編碼備援值：API 已修正（`f507fe1`），Workers 仍保留 | 靜態確認 |
| [LIC-01](#lic-01) | 金鑰與 License | P4 | 未處理 | API 使用寫死的授權資料 | 間接確認 |
| [LIC-02](#lic-02) | 金鑰與 License | P4 | 未處理 | 可連線的 Core LicenseService 沒有使用者 | 靜態確認 |
| [TRIAL-01](#trial-01) | 試用 | P1 | 未處理 | 走 plan-change 升級的試用租戶不會脫離試用，到期仍被停用 | 靜態確認 |
| [TRIAL-02](#trial-02) | 試用 | P3 | 已定方向 | 試用政策存在無型別的 KV，錯誤的值會靜默失效或靜默生效 | 靜態確認 |
| [TRIAL-03](#trial-03) | 試用 | P2 | 未處理 | 「資料保留天數」到期只做標記，租戶的業務資料永遠不會被刪除 | 靜態確認 |
| [PLAN-01](#plan-01) | 方案與額度 | P3 | 未處理 | `Plan.isActive` 沒有讀取端，停售的方案仍可指派 | 靜態確認 |
| [PLAN-02](#plan-02) | 方案與額度 | P3 | 未處理 | 加購 token 是永久提高每月額度，不是一次性配額 | 靜態確認 |
| [PLAN-03](#plan-03) | 方案與額度 | P3 | 未處理 | 換方案不會回收既有的超額資源，也不會清除 `limitOverrides` | 靜態確認 |
| [PLAN-04](#plan-04) | 方案與額度 | P2 | 未處理 | 方案的功能天花板在收件匣一帶沒有咬合點，關掉 `inbox` 不影響使用 | 靜態確認 |
| [PLAN-05](#plan-05) | 方案與額度 | P2 | 未處理 | 加購過的租戶升級方案，AI 月額度反而停在升級前的數字 | 靜態確認 |
| [PLAN-06](#plan-06) | 方案與額度 | P2 | 未處理 | 核准加購清掉的是用量計數器而非告警旗標，當月後續額度告警全部靜默 | 靜態確認 |
| [PLAN-07](#plan-07) | 方案與額度 | P3 | 未處理 | 渠道的兩個分級欄位都沒有任何方案填過值，渠道維度完全不分級 | 靜態確認 |
| [PLAN-08](#plan-08) | 方案與額度 | P1 | 未處理 | 角色權限的顯示與儲存都不套方案天花板，介面顯示的授予狀態與實際生效的權限不一致 | 靜態確認 |
| [PLAN-09](#plan-09) | 方案與額度 | P3 | 未處理 | 改方案立即對該方案所有租戶生效，介面不顯示影響範圍，稽核不記舊值 | 靜態確認 |
| [PLAN-10](#plan-10) | 方案與額度 | P3 | 未處理 | 加購沒有金額紀錄，覆寫值也拆不開，事後無法對帳 | 靜態確認 |
| [PLAN-11](#plan-11) | 方案與額度 | P3 | 未處理 | 平台只查得到待審的方案異動申請，已核准與已駁回的沒有讀取途徑 | 靜態確認 |
| [PLAN-12](#plan-12) | 方案與額度 | P3 | 未處理 | AI 不在功能天花板的維度內，停用 AI 只能把 `monthlyTokens` 設成 `0` | 靜態確認 |
| [AI-01](#ai-01) | AI 用量與成本 | P2 | 未處理 | BYOK 金鑰解密失敗會靜默退回平台金鑰，成本轉由平台承擔且開始計入租戶額度 | 靜態確認 |
| [USAGE-01](#usage-01) | AI 用量與成本 | P3 | 未處理 | 用量頁沒有標示統計的母體與筆數上限，相鄰兩張卡的母體不同 | 靜態確認 |
| [USAGE-02](#usage-02) | AI 用量與成本 | P2 | 已提建議 | 價目表只能改 seed 或資料庫，缺價期間的成本永久記 0 | 靜態確認 |
| [SLA-01](#sla-01) | SLA | P1 | 未處理 | `Case.firstResponseAt` 沒有寫入端，首次回應 SLA 必定判定逾時 | 靜態確認 |
| [SLA-02](#sla-02) | SLA | P2 | 未處理 | SLA 掃描每輪上限 100 張工單，且不分租戶 | 靜態確認 |
| [SLA-03](#sla-03) | SLA | P3 | 未處理 | `isDefault` 沒有讀取端，預設政策記帳不影響挑選結果 | 靜態確認 |
| [SLA-04](#sla-04) | SLA | P2 | 未處理 | 工單以政策名稱連結，改名或刪除即脫鉤 | 靜態確認 |
| [DEP-01](#dep-01) | 部署與應用程式 | P4 | 未處理 | `video-worker` 只剩殘留 volume 設定 | 靜態確認 |
| [DEP-02](#dep-02) | 部署與應用程式 | P3 | 未處理 | `.env.prod.example` 的變數只送到 nginx 與 certbot，讀取它們的 api、workers 收不到 | 靜態確認 |
| [APP-01](#app-01) | 部署與應用程式 | P3 | 未處理 | `core` 載入時啟動另一套 SLA consumer | 執行時確認 |
| [APP-02](#app-02) | 部署與應用程式 | P3 | 未處理 | Telegram 外掛未註冊 | 執行時確認 |
| [APP-03](#app-03) | 部署與應用程式 | P4 | 未處理 | 啟動 log 少列 Threads | 執行時確認 |
| [APP-04](#app-04) | 部署與應用程式 | P4 | 未處理 | API 的 `*.worker.ts` 實際是 Queue producer | 靜態確認 |
| [PKG-01](#pkg-01) | 共用套件 | P4 | 未處理 | `types` 與 `shared` 重複定義渠道型別 | 靜態確認 |
| [PKG-02](#pkg-02) | 共用套件 | P3 | 未處理 | `channel-plugins/fb` 子路徑指向錯誤 | 執行時重現 |
| [PKG-03](#pkg-03) | 共用套件 | P4 | 未處理 | `brain` 尚未接線，仍持續建置與監看 | 執行時確認 |
| [PKG-04](#pkg-04) | 共用套件 | P4 | 未處理 | `ui` 是空殼，仍持續建置與監看 | 執行時確認 |
| [STO-01](#sto-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Workers 的 MinIO 設定名稱不一致 | 執行時重現 |
| [LLM-01](#llm-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Ollama base URL 預設指向容器自己 | 執行時重現 |
| [LLM-02](#llm-02) | Storage、LLM 與資料庫 | P3 | 未處理 | Compose 與資料庫的 Chat 模型預設不同 | 部分驗證 |
| [LLM-03](#llm-03) | Storage、LLM 與資料庫 | P3 | 部分修正 | `OLLAMA_BASE_URL`：Chat 生成已生效（`ee251c8`），Embedding、`listModels()`、`health()` 仍不讀；兩個 `*_MODEL` 變數仍無讀取端 | 靜態確認 |
| [DB-01](#db-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Prisma 與資料庫的向量維度不一致 | 執行時重現 |
| [CI-01](#ci-01) | CI 與測試 | P2 | 未處理 | 沒有 CI workflow 執行 API 測試 | 靜態確認 |
| [CI-02](#ci-02) | CI 與測試 | P3 | 未處理 | 沒有 CI workflow 執行 lint | 靜態確認 |
| [CI-03](#ci-03) | CI 與測試 | P4 | 未處理 | Vitest API 與 `tsx` 執行方式不一致 | 靜態確認 |

## 租戶隔離與權限

<a id="rls-01"></a>
### RLS-01：Canvas 引擎不走租戶連線

`packages/core/src/canvas/flow-runner.ts:6` 匯入 `@open333crm/database` 的 module-level `prisma` singleton。`packages/core/src/canvas/scheduler.ts:68` 與 `apps/api/src/modules/canvas/canvas.webhook.ts:6` 也用同一個 singleton。

這個 client 由 `packages/database/src/client.ts` 以 `new PrismaClient()` 建立，沒有指定 datasource，因此連線字串是 `DATABASE_URL`。這個 singleton 與 `apps/api/src/plugins/prisma.plugin.ts` 建立的租戶連線不是同一條連線，連線上也不會有 `app.current_tenant`。`AGENTS.md` 明文禁止 `packages/*` 使用這個 singleton。

`FlowRunner` 的查詢全部以主鍵 `executionId` 定位（`flow-runner.ts` 的第 27、70、83、104、278 行），`where` 沒有 `tenantId`。`canvas.service.ts` 的 `triggerFlow()` 建立 execution 時用的是受約束的 `TenantDb`，但建立後把 `execution.id` 交給 `FlowRunner.run()`，之後的讀寫就離開租戶連線。

後果依 `DATABASE_URL` 指向哪個 role 而不同：

- 指向 superuser 或帶 BYPASSRLS 的 role（`.env.api.example` 的 `crm` 屬於這類）：Canvas 的所有讀寫跳過 RLS。
- 指向 `app_tenant`：singleton 的連線沒有 `app.current_tenant`，policy fail-closed，`FlowRunner.run()` 在第一個 `findUniqueOrThrow` 就查不到列，Canvas 會靜默停止運作。

<a id="rls-02"></a>
### RLS-02：身分合併審核端點沒有租戶檢查

`apps/api/src/modules/canvas/canvas.routes.ts` 的第 177 與 183 行把路徑參數直接交給 `approveMerge(suggestionId, agentId)` 與 `rejectMerge(suggestionId, agentId)`，沒有傳入 `request.agent.tenantId`。

`packages/core/src/identity/merge-suggestion-service.ts` 的第 74 與 150 行用 singleton 以主鍵查 `mergeSuggestion`，`where` 也沒有 `tenantId`。`approveMerge` 接著依該筆建議自己的 `tenantId` 合併聯繫人。

兩層租戶隔離在這條路徑上都不生效：應用層沒有比對 `request.agent.tenantId`，資料層走的是不綁租戶的 singleton。持有 `identity.review` 權限的 agent 若取得其他租戶的建議 id，就能核准或駁回該筆建議。同一個檔案的 `listSuggestions()` 有收 `tenantId` 並寫進 `where`，不受這項影響。

<a id="rls-03"></a>
### RLS-03：隔離檢查腳本掃不到 `packages/*`

`scripts/check-tenant-scoping.mjs:24` 與 `scripts/check-prisma-admin-usage.mjs:18` 的 `SCAN_DIR` 都是 `apps/api/src`。`packages/*` 不在掃描範圍，因此這兩道檢查攔不到 RLS-01 與 RLS-02 位於 `packages/core` 的程式碼。

兩支腳本檢查的項目是「query 有沒有 `tenantId`」與「有沒有使用 `prismaAdmin`」，沒有檢查「有沒有匯入 module-level singleton」。即使把 `packages/*` 納入掃描範圍，現有規則仍然抓不到這個寫法。

`packages/core` 另有三個檔案匯入同一個 singleton：`inbox/inbox-service.ts`、`contacts/contact-service.ts` 與 `identity/merge-suggestion-service.ts`。前兩個目前沒有任何 app 使用，情況與 PKG-03 相同。

<a id="rls-04"></a>
### RLS-04：`.env.api.example` 沒有 `DATABASE_URL_TENANT`

`apps/api/src/plugins/prisma.plugin.ts:31` 在 `DATABASE_URL_TENANT` 未設定時 fallback 到 `DATABASE_URL`。`.env.api.example` 只提供 `DATABASE_URL`（`crm`）與 `DATABASE_URL_ADMIN`，沒有 `DATABASE_URL_TENANT`。

照著範例檔部署時，`fastify.prisma`、`request.tenantPrisma` 與 `withTenant()` 都會連到 `crm`。RLS 這一層不會生效，而且啟動時沒有任何警告。

`apps/workers/src/index.ts:59` 對 `DATABASE_URL_ADMIN` 的處理方式相反：變數缺少就拋錯，Workers 不啟動。API 的租戶連線沒有對應的檢查。

<a id="rbac-01"></a>
### RBAC-01：部分權限碼沒有強制點

`packages/core/src/rbac/permissions.ts` 宣告 56 個權限碼（2026-09-24 核對）。其中 15 個在 `apps/api/src` 完全沒有出現：

| feature | 沒有出現的權限碼 |
| --- | --- |
| `inbox` | `inbox.manage`、`case.view`、`case.create`、`case.update`、`case.assign`、`case.escalate`、`contact.view`、`contact.update`、`tag.view`、`tag.manage`、`shortlink.view`、`shortlink.manage` |
| `core` | `agent.delete`、`billing.view` |
| `knowledge` | `knowledge.view` |

其中 `billing.view` 的描述是「租戶站內方案/用量頁」，而那個頁面不存在：租戶端的 `/dashboard/plan` 只有升級與加購的申請表，以及自己的申請列表，看不到方案內容、價格或已用額度（見 PLAN-10）。

另有兩個碼只以稽核紀錄的 `action` 字串出現，不是檢查：`case.delete`（`case.routes.ts:200`）與 `contact.merge`（`contact.routes.ts:101`）。`inbox.view` 與 `inbox.reply` 有被 `requirePermission()` 使用，但掛在 `ai` 模組的兩條 agent 路由上，不在收件匣本身。

結果是 `case`、`conversation`、`contact`、`tag`、`shortlink` 這幾個模組的路由只有 `fastify.authenticate`，沒有任何授權判斷。租戶的角色設定在這個區塊不生效：管理員在角色矩陣取消勾選「刪除案件」，該角色的成員仍然刪得掉。

一個例外要分辨：`channel.view_all` 也沒有出現在 `requirePermission()` 裡，但它透過 `getEffectiveTenantPermissions()` 在 `services/channel-visibility.ts` 與 socket 房間授權中判斷，屬於有強制點的情況。

**這是未完成的遷移，不是設計決策。** `openspec/changes/archive/2026-09-15-rbac-granular-permissions/tasks.md` 的第 9.2 項「分批灰度切換路由 guard（新舊並存），監控 403 異常」沒有打勾，該 change 就已歸檔。同一節的 9.1、9.3、9.4、9.5 也都沒有打勾。

舊的角色守門也已經不在：`requireRole()`、`requireAdmin()`、`requireSupervisor()` 仍由 `guards/rbac.guard.ts` 匯出，但 `apps/api/src` 沒有任何呼叫端。`case.routes.ts` 的 git 歷史也查不到曾經使用過。因此這些路由不是「從舊守門切到新守門時漏掉」，而是從頭就沒有授權判斷。

啟動時的檢查只驗單向：`validateRouteCodes()` 確認路由用到的碼都存在於 registry，不檢查 registry 的碼有沒有人用。因此宣告了卻沒有強制點的碼不會產生任何警告。

對方案天花板的連帶影響見 PLAN-04。

## 帳號與登入

功能說明見[平台帳號認證](../modules/platform/AUTH.md)與[平台帳號管理](../modules/platform/PLATFORM-USERS.md)。

<a id="auth-01"></a>
### AUTH-01：租戶端沒有密碼復原流程

租戶使用者的密碼一律由「建立這個帳號的人」設定：

| 帳號 | 建立者 | 密碼來源 |
| --- | --- | --- |
| 租戶的第一位 ADMIN | 平台人員在 `/admin/tenants` 開通 | 操作者在表單上自己填 |
| 其餘成員 | 租戶自己的 ADMIN | 建立者在表單上自己填 |

兩端的介面都寫明密碼要由建立者轉交：`/admin/tenants` 開通成功的訊息是「（密碼請自行轉交給管理員）」，開通信的內文是「登入密碼由開通人員為您設定，請向開通人員索取；登入後建議立即修改密碼」。這一點沒有落差，落差在後面。

**「建議修改」沒有任何強制機制。** `Agent` 沒有 `mustChangePassword` 欄位，也沒有對應的 guard。建立者知道的那組密碼不會過期，也不會有任何提示要求更換。平台帳號的同一件事是強制的：`mustChangePassword` 加上 `blockIfMustChangePassword`，不改密碼就只能呼叫改密碼那一條。

**租戶端沒有忘記密碼流程。** 三處都沒有：

| 層 | 平台端 | 租戶端 |
| --- | --- | --- |
| 路由 | `POST /platform/auth/forgot-password`、`/reset-password` | 無。`auth.routes.ts` 只有 login、passkey、refresh、logout、me |
| 資料表 | `platform_users.resetTokenHash`、`resetTokenExpiresAt` | 無。`Agent` 沒有對應欄位 |
| 頁面 | `/admin/forgot-password`、`/admin/reset-password` | 無。`/login` 沒有「忘記密碼」連結 |

因此復原只能靠別人代為重設：

| 情況 | 復原途徑 |
| --- | --- |
| 一般成員忘記密碼 | 租戶的 ADMIN 用 `PATCH /agents/:id/password` 重設（需 `agent.password.reset` 權限） |
| 租戶唯一的 ADMIN 忘記密碼 | **沒有任何介面可以復原** |

平台後台幫不上忙。它對租戶成員只有兩個端點：改 email（`PATCH /tenants/:id/agents/:agentId`）與重寄開通信（`POST /tenants/:id/agents/:agentId/resend-welcome`）。重寄的那封信不帶密碼，也不會重設密碼，收件者拿到信之後仍然登入不了。平台沒有重設租戶成員密碼的路由。唯一的辦法是直接改資料庫。

Passkey 不是復原途徑。註冊 passkey 的端點掛在 `fastify.authenticate` 之下，要先登入才能註冊，已經被鎖在外面的人用不到。

**修正方向（2026-09-24 決定，尚未實作）**

補上租戶端的忘記密碼流程，照 `platform-password-recovery.service.ts` 的既有作法：`Agent` 增加 `resetTokenHash` 與 `resetTokenExpiresAt`、兩條公開路由、一個信件模板，以及 `/forgot-password` 與 `/reset-password` 兩頁。`Agent.email` 全域唯一，不需要處理「同一個信箱屬於哪個租戶」的歧義。

同時建議加上 `Agent.mustChangePassword`，讓建立者設定的密碼在第一次登入後就失效。這一項單獨做沒有意義，反而會提高忘記密碼的機率，只有在復原流程存在之後才成立。

兩個前置條件：

- **寄信管道要先確認。** `EMAIL_DELIVERY_MODE` 預設是 `log`，此時所有信件只寫進 log，包含現有的開通信與試用提醒信。倉庫內的 `.env.api` 沒有設定這個變數，因此本機一律走 `log`；`.env.api.example` 的範本值是 `resend`。生產環境的值在伺服器上的 `.env.api`，不在倉庫內。

  部署說明不會提醒設定它。`docker-compose.prod.yml` 開頭的步驟只寫「複製 `.env.prod.example` 成 `.env.prod`，填入 `DOMAIN` 與 `CERTBOT_EMAIL`」，而 `.env.prod` 只給 nginx 與 certbot 使用；api 讀的是 `.env.api`，沒有對應的生產範本。`.env.prod.example` 本身也沒有任何 email 變數。照這份步驟部署的人不會被提醒寄信管道需要設定，而寄不出信不會有任何錯誤，`sendEmail()` 在 `log` 模式下正常返回。

  設定值本身有驗證：`config/env.ts` 的 `superRefine` 規定 `resend` 模式必填 `RESEND_API_KEY` 與 `EMAIL_FROM`、`smtp` 模式必填 `SMTP_HOST`，缺少時 API 啟動就失敗。因此只要線上 API 啟動成功且模式不是 `log`，寄信設定就是完整的。要確認的只有模式本身。

- **SEC-04 應先修。** 新增的是公開端點，擋暴力破解只能靠速率限制，而速率限制目前以可偽造的 `request.ip` 分組。

<a id="auth-02"></a>
### AUTH-02：停用租戶不會中斷既有的連線與 token

`PATCH /platform/tenants/:id/active` 把 `isActive` 設成 `false` 之後，三個存取面的反應不同：

| 存取面 | 會不會被擋 | 最長延遲 |
| --- | --- | --- |
| REST（access token） | 會 | 一個 access token 的有效期。`ACCESS_TOKEN_EXPIRES_IN` 預設 15 分鐘 |
| Socket.IO 既有連線 | **不會** | 連線不中斷就一直有效 |
| CLI token | **不會** | CLI session 自己的有效期。`DEFAULT_EXPIRES_DAYS` 是 30 天 |

REST 這一面是有界的：`authenticate` 只驗簽章不回查資料庫，但 `login()` 與 `POST /auth/refresh` 都會擋下停用的租戶，換不到新的 access token。

**Socket.IO 只在 handshake 驗一次。** `socket.plugin.ts` 的 `io.use()` 驗完 JWT 就把 `agentId`、`tenantId` 寫進 `socket.data`，之後沒有任何地方重驗，也沒有在租戶停用時主動斷線。連線建立後自動加入的 `tenant:{tenantId}` 與 `agent:{agentId}` 兩個房間不需要 `subscribe`，因此推播到這兩個房間的事件會持續送達。`subscribe` 其他房間時 `authorizeSocketRoom()` 會回查資料庫，但那只檢查渠道權限，不檢查租戶是否停用。

斷線後重連會重跑 handshake，此時過期的 token 會被擋下。所以實際的暴露時間取決於連線活多久，WebSocket 長連線可以維持數天。

**CLI token 沒有檢查租戶狀態。** `verifyCliSession()` 依序檢查 `revokedAt`、`expiresAt` 與 `agent.isActive`，**沒有檢查 `tenant.isActive`**。停用租戶之後，該租戶成員手上的 CLI token 仍然可以呼叫 API，直到 token 自己過期或被撤銷。

停用個別成員的情況比較好但不完整：CLI 端有 `agent.isActive` 的檢查會擋下，Socket 端同樣不會斷線。

對照平台端：`authenticatePlatformSuperuser` 每個請求都回查 `platform_users`，停用即時生效，而平台後台沒有 Socket 或 CLI 通道。兩邊的差距不是刻意設計，是租戶端多了兩個當初沒有一起處理的入口。

<a id="auth-03"></a>
### AUTH-03：平台帳號改密碼後，已發出的 token 仍然有效

`auth.plugin.ts` 的 `authenticatePlatformSuperuser` 在驗完簽章後會查一次資料庫，但只檢查 `isActive` 與 `mustChangePassword`。`PlatformUser` 沒有 `tokenVersion` 或 `passwordChangedAt` 這類欄位，簽發時間無從比對。平台也沒有登出路由，登出只是前端丟掉 token。

所以以下三種操作都不會讓已發出的 token 失效：

| 操作 | 位置 |
| --- | --- |
| 自助改密碼 | `platform-password-recovery.service.ts` 的改密碼函式 |
| 忘記密碼後重設 | 同一檔案的重設函式 |
| 登出 | 沒有伺服器端路由 |

情境是平台帳號外洩。管理者發現後重設密碼，攻擊者手上的 JWT 仍然可以用到過期為止，期限是 `PLATFORM_JWT_EXPIRES_IN`（預設 `2h`）。能立刻止血的只有停用帳號，而停用會連帳號本人一起擋掉。

`auth.plugin.ts` 的註解寫「帳號停用或改密碼後立即生效」。這裡的「改密碼」指的是 `mustChangePassword` 旗標被重新標記，不是撤銷 token，讀起來容易誤會。

<a id="auth-04"></a>
### AUTH-04：平台帳號沒有權限分級，也沒有第二因子

所有平台帳號的 JWT 都帶 `role: 'PLATFORM_SUPERUSER'`，平台側沒有權限表。平台端也沒有 MFA 或 passkey；passkey 只有租戶端有。

這個身分可以跨租戶開通、停用、改方案、看用量，也能建立與停用其他平台帳號。單一密碼就是全部權限，而登入端點的速率限制又能透過 SEC-04 繞過。

**同級帳號之間可以互相接管。**

1. 平台帳號 A 以 `PATCH /platform-users/:id` 把帳號 B 的 email 改成自己的。系統不通知 B，B 手上的 token 也不受影響，因為 token 認的是帳號 id。
2. A 對這個 email 呼叫忘記密碼，重設信寄到 A 手上。
3. A 重設 B 的密碼，之後以 B 的身分登入。

B 手上的 token 在過期前仍然可用（見 AUTH-03），過期後 B 就登不進來，而 B 自己走忘記密碼，信會寄到 A 的信箱。

A 的權限沒有因此提高，所有平台帳號本來就同級。問題在稽核歸屬：之後的操作都記在 B 名下。事後的線索只有一條，就是第一步留下的 `platform_user.update` 稽核，payload 記著新的 email。第二、三步的忘記密碼與重設沒有稽核（見 SEC-02）。

<a id="sec-02"></a>
### SEC-02：平台帳號的登入與密碼重設沒有稽核紀錄

`apps/api/src/modules/platform/platform-audit.service.ts` 的 `writePlatformAudit()` 把平台操作寫進 `platform_audit_logs`。`platform.routes.ts` 的異動路由呼叫它，服務層不重複寫，`trial-admin.service.ts` 第 58 行的註解說明了這個分工。

以下四條異動路由沒有呼叫 `writePlatformAudit()`，對應的服務內部也沒有寫：

| 路由 | 服務 |
| --- | --- |
| `POST /api/v1/platform/auth/login` | `platform-auth.service.ts` |
| `POST /api/v1/platform/auth/forgot-password` | `platform-password-recovery.service.ts` |
| `POST /api/v1/platform/auth/reset-password` | `platform-password-recovery.service.ts` |
| `POST /api/v1/platform/trial-signups/:id/resend` | `trial-admin.service.ts` |

平台帳號可以開通與停用租戶、修改方案、讀取跨租戶用量。這個身分的登入與密碼重設目前在 `platform_audit_logs` 裡查不到紀錄，事後無法判斷某次異動之前是誰登入、密碼是否被重設過。

`/platform-users/:id/audit-logs` 查得到的是該帳號的操作紀錄，不包含登入事件。

<a id="sec-03"></a>
### SEC-03：rate-limit 只註冊在 platform 路由的 scope 內

`apps/api/src/modules/platform/platform.routes.ts` 第 105 行在 `platformRoutes()` 函式內部註冊 `@fastify/rate-limit`：

```ts
export default async function platformRoutes(fastify: FastifyInstance) {
  await fastify.register(rateLimit, { global: false, max: 30, timeWindow: '1 minute', ... });
```

這是整個 API 唯一一處註冊這個外掛。三條公開路由靠它保護：`POST /auth/login`（10 次／分鐘）、`POST /auth/forgot-password`（5 次／10 分鐘）、`POST /auth/reset-password`（10 次／10 分鐘）。

目前運作正常，三條路由與 `register` 呼叫在同一個 Fastify encapsulation scope 內。問題是這個寫法與 repo 其他跨領域外掛的慣例不同：`apps/api/src/plugins/` 的七支外掛全部以 `fastify-plugin` 匯出，並在 `index.ts` 的根層註冊，因此不受 scope 限制。

因此存在一個沒有警告的陷阱。把 `/auth/*` 那幾條路由拆到另一個檔案、再從 `index.ts` 另行 `register`，這些路由就落到另一個 scope。路由上的 `config: { rateLimit: ... }` 會被**靜默忽略**，不報錯也不警告，平台超級使用者的登入端點就失去暴力破解保護。

`platform` 模組沒有任何測試，因此這個改動不會被測試擋下。拆分 `platform.routes.ts` 之前，要先把 rate-limit 的註冊移到根層，並以連續請求實際驗證 429 仍會出現。

<a id="sec-04"></a>
### SEC-04：`request.ip` 可由呼叫端偽造

`apps/api/src/index.ts:97` 設定 `trustProxy: true`。這個值的意思是「信任所有上游」，Fastify 底層的 `proxy-addr` 因此取 `X-Forwarded-For` 的**最左邊**那一個位址當作 `request.ip`。最左邊是呼叫端自己寫的值。

前面有沒有反向代理都一樣。`nginx/nginx.conf.template` 的六個 location 區塊全部用：

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

`$proxy_add_x_forwarded_for` 是**附加**，不是覆寫。呼叫端送 `X-Forwarded-For: 1.2.3.4`，經過 nginx 之後變成 `1.2.3.4, <真實 IP>`，而 API 取的是最左邊的 `1.2.3.4`。

同一份設定裡的 `X-Real-IP: $remote_addr` 是覆寫，值可信，但 API 沒有任何地方讀它。

三處速率限制都以 `request.ip` 分組，因此每換一次標頭就等於換一個新的來源：

| 位置 | 上限 |
| --- | --- |
| `platform.routes.ts` | scope 內每分鐘 30 次；登入每分鐘 10 次；忘記密碼每 10 分鐘 5 次 |
| `auth/auth.routes.ts` | 租戶登入每分鐘 10 次 |
| `trial/trial.routes.ts` | scope 內每 10 分鐘 20 次；申請試用每 10 分鐘 5 次 |

平台後台與租戶後台都沒有帳號層級的鎖定，速率限制是唯一擋暴力破解的機制。

被影響的不只是速率限制。`request.ip` 還寫進兩種紀錄，兩者都會記到偽造的值：

- `trial_signups.requestIp`，申請來源。
- 租戶側稽核紀錄的 `ip` 欄位（`agent`、`role`、`contact`、`settings`、`channel`、`data-export` 等模組的異動路由）。

生產環境的 `docker-compose.prod.yml` 只有 nginx 對外開 80 與 443，`api` 沒有對應的 host port。這一點不改變結論：偽造的標頭會原樣通過 nginx。

## 金鑰與 License

<a id="sec-01"></a>
### SEC-01：渠道加密金鑰備援值

盤點時，API 的 `channel.service.ts` 與 Workers 的 `apps/workers/src/lib/credentials.ts` 都有同一個備援字串。缺少 `CREDENTIAL_ENCRYPTION_KEY` 時，兩個檔案都改用這個公開在原始碼中的字串。

Commit `f507fe1` 修正了 API 端：

- `channel.service.ts` 在金鑰缺少或長度不足時拋出錯誤。
- API 啟動時的環境變數驗證要求這個變數，設定缺失會讓 API 啟動失敗。

Workers 端尚未修正。`credentials.ts` 仍保留備援字串，設定缺失不會讓 Workers 啟動失敗。Workers 只用這把金鑰解密，因此不會用備援值加密新資料。Workers 缺少金鑰時，這項設定錯誤要到 Workers 解密渠道憑證時才會出現。

<a id="lic-01"></a>
<a id="lic-02"></a>
### LIC-01、LIC-02：兩份 LicenseService

`license.guard.ts` 使用 `apps/api/src/services/license.ts`。該實作直接建立寫死的授權資料，不會連線到授權伺服器。

`packages/core/src/license/license-service.ts` 會呼叫 `LICENSE_FETCH_URL`，但沒有實際使用者。

## 試用

功能說明見[試用管理](../modules/platform/TRIALS.md)與[平台設定](../modules/platform/SETTINGS.md)。

<a id="trial-01"></a>
### TRIAL-01：走 plan-change 升級的試用租戶到期仍會被停用

試用租戶升級到付費方案有兩條路徑，兩條的結果不同：

| 路徑 | 觸發者 | `planId` | `trialEndsAt` |
| --- | --- | --- | --- |
| `PATCH /api/v1/platform/trial-tenants/:id/convert` | 平台在 `/admin/trial` 操作 | 改 | 清成 `null` |
| `PATCH /api/v1/platform/plan-change-requests/:id/approve` | 租戶申請、平台在 `/admin/plan-changes` 核准 | 改 | **不動** |

`convertToPaid()` 清空 `trialEndsAt`，註解寫明用意是「脫離試用，不再受到期排程管轄」。`approveRequest()` 的 `upgrade` 分支只寫 `planId`（`plan-change.service.ts` 第 90 行），沒有處理 `trialEndsAt`。

第二條路徑確實可達，逐項確認如下：

1. `settings.manage` 的 `feature` 是 `core`（`packages/core/src/rbac/permissions.ts:101`），而 `core` 恆開（`permission.service.ts:116`）。試用租戶的 `ADMIN` 因此持有這個權限。
2. `POST /api/v1/plan-change` 只要求 `fastify.authenticate` 加 `settings.manage`。`createPlanChangeRequest()` 沒有檢查租戶是否在試用中。
3. `apps/web` 的 `/dashboard/plan` 頁面就是呼叫這個端點。

後果發生在排程。`runTrialLifecycle()` 的掃描條件是 `{ trialEndsAt: { not: null }, isActive: true }`（`trial.scheduler.ts:34`），沒有任何方案條件。因此已升級付費的租戶仍在掃描範圍內：

- 到了原本的 `trialEndsAt`，排程把 `isActive` 設為 `false`，寄出「試用已到期」信給該租戶的 `ADMIN`，並寫入 `tenant.trial.expire` 稽核。
- 再經過 `dataRetentionDays`（預設 30 天），軟刪掃描把 `purgedAt` 設為當下。

也就是說，已付費的租戶會被停用，接著被標記為已清除。

審核者沒有任何提示。`listPendingRequests()` 回傳 `currentPlan`，但不含 `trialEndsAt`，`/admin/plan-changes` 頁面也沒有顯示試用狀態。審核者在這個頁面按下核准時，不會知道這個動作不會讓租戶脫離試用。

<a id="trial-02"></a>
### TRIAL-02：試用政策存在無型別的 KV

試用政策的每個參數是 `PlatformSetting` 的一列，`value` 是任意 JSON。`PUT /settings/:key` 的驗證只有 `z.object({ value: z.unknown() })`，沒有鍵名白名單，也沒有值的型別與範圍。讀取端 `getTrialPolicy()` 只做 `typeof` 檢查，不符就改用 `DEFAULTS`。

因此寫錯的值會往兩個相反的方向出錯，兩個方向都沒有任何訊息：

| 寫入的值 | 讀取端的判斷 | 結果 |
| --- | --- | --- |
| 型別錯，例如 `trial.durationDays` 寫成 `"30"` | `typeof` 不是 `number` | 靜默失效：設定存進去了，行為仍是預設的 14 天 |
| 型別對但範圍錯，例如 `0` 或負數 | `typeof` 通過 | 靜默生效：照用錯誤的值 |
| `trial.planSlug` 寫了不存在的方案 | `typeof` 通過 | 之後每一筆試用驗證都在最後一步失敗，回 500 `TRIAL_MISCONFIGURED`（`trial.service.ts:163`） |

範圍錯的值實際造成的結果：

| 參數 | 錯誤的值 | 結果 |
| --- | --- | --- |
| `trial.durationDays` | `0` 或負數 | 新開通租戶的 `trialEndsAt` 已經過去，下一輪排程（最多一小時）就被停用 |
| `trial.dataRetentionDays` | `0` | 租戶到期停用後，下一輪排程就標記軟刪 |
| `trial.verifyTokenTtlHours` | `0` | 驗證信寄出時連結就已過期，`verifyAndProvision()` 回 410 |

**介面擋不住。** `/admin/trial` 的「設定」分頁在欄位 `onBlur` 時直接呼叫 `PUT`，沒有確認步驟，數字欄位也沒有 `min`。清空數字欄位再離開時，`parseInt('')` 得到 `NaN`，JSON 序列化成 `null`；`PlatformSetting.value` 是必填的 `Json`，這筆寫入會失敗，而 `saveSetting()` 沒有 `catch`，頁面既不顯示成功也不顯示失敗。`trial.planSlug` 不在這個分頁上，只能直接呼叫 API，而 API 不檢查方案是否存在。

**管理面也有缺口：**

- 沒有刪除端點。寫錯的鍵刪不掉，也沒有「恢復預設」，只能手動寫回預設值，而預設值只存在於原始碼的 `DEFAULTS`。
- 稽核只記鍵名，不記新舊值（見[平台設定](../modules/platform/SETTINGS.md)）。
- 每個參數各自一次 `PUT`。彼此相關的參數（例如試用天數與提醒檔位）無法一起改，中間狀態會被排程讀到。

**修正方向（2026-09-30 討論，尚未實作）**

KV 表保留為底層儲存，不承擔型別。上面加一層殼層，每個設定群有自己的 API 路徑，型別、範圍、預設值與檢查都由殼層負責：

```text
/admin/trial 設定分頁
        │  PUT /settings/trial
        ▼
殼層：trial 設定群
  schema、預設值、範圍
  跨欄位檢查（提醒檔位不大於試用天數）
  參照檢查（planSlug 對應的方案存在）
  稽核 { before, after }
        │
        ▼
PlatformSetting（KV，不知道型別）
```

要先定下來的決策：

- **拿掉通用的 `PUT /settings/:key`。** 只要這個端點還在，殼層的驗證就能被繞過。讀取可以保留給除錯用，寫入只能走各設定群的路徑。
- **底層採一群一列。** `trial` 一列，值是整份 `TrialPolicy`。整份一起驗證、一起寫入，沒有中間狀態，讀取也只查一次。部分更新用 `PATCH`，先與現值合併，再驗證合併後的整份。跨欄位檢查在這種形狀下最容易做。
- **殼層由註冊表產生。** 每個設定群註冊 `{ group, schema, defaults, validate }`，由同一個 handler 提供 `GET`／`PUT`／`PATCH /settings/:group`。新增一個設定群只要註冊一次，路由、驗證與稽核就一併具備。做法與 `/registry` 由 `FEATURES` 推導清單相同。
- **讀取端解析失敗要留下紀錄。** `getTrialPolicy()` 改成殼層的讀取函式，用同一份 schema 解析。資料庫沒有這一列時使用預設值，屬於正常情況。資料庫有值但解析失敗時，要先記 error log 再退回預設值。寫入端擋住之後，這種情況只會出現在手動改資料庫時，正好需要被看見。

其餘項目併入殼層：`trial.planSlug` 加進設定分頁，PLAN-01 修好之後一併檢查方案未停售；前端 `saveSetting()` 補上 `catch`，顯示殼層回傳的 422 欄位錯誤。

遷移：現有的 `trial.*` 各列要合併成一列 `trial`。可以讓讀取端在一段期間內相容兩種形狀，也可以寫一次性的 migration，合併之後刪除舊列。

<a id="trial-03"></a>
### TRIAL-03：「資料保留天數」到期不會刪除任何資料

`trial.dataRetentionDays` 在 `/admin/trial` 設定分頁的標籤是「到期後資料保留天數」。這個名稱承諾的是「保留期滿後刪除」，實作只有標記：

- `trial.scheduler.ts` 的第二輪掃描在保留期滿時，只把 `tenant.purgedAt` 設成當下，原始碼註解也寫明「標記，不真刪 DB，可復原」。
- `purgedAt` 的讀取端只有平台後台的狀態顯示（`trial-admin.service.ts`）與復原功能 `restorePurgedTenant()`。
- 全 repo 沒有任何程式依 `tenantId` 刪除業務資料，平台也沒有刪除租戶的路由。

因此一個試用過就離開的租戶，他的聯繫人、對話、訊息會一直留在資料庫裡。這些資料的主體是**租戶的客戶**，不是租戶本身。營運方若依這個設定對外說明保留期限，實際上做不到。

`purgedAt` 帶來的唯一行為差異是平台清單上的狀態顯示「已清除」。租戶在試用到期時已經被停用，因此標記前後，租戶端的存取沒有任何改變。入站 webhook 在停用時就已經不處理（`webhook.service.ts:58` 檢查 `tenant.isActive`），也與 `purgedAt` 無關。

`trial.enabled` 的預設值是 `false`。正式環境若從未開放試用，目前沒有受影響的資料。這一點要到線上確認。

## 方案與額度

功能說明見[方案與上限](../modules/platform/PLANS.md)與[方案異動審核](../modules/platform/PLAN-CHANGES.md)。

<a id="plan-01"></a>
### PLAN-01：`Plan.isActive` 沒有讀取端

`Plan.isActive` 的 schema 註解寫「停售軟下架」，`/admin/plans` 也能切換它。但整個 repo 沒有任何查詢以它為條件。

`grep -rn "isActive" apps/api/src apps/web/src` 的命中全部屬於 `Tenant`、`Agent` 或 `PlatformUser`，沒有一處是 `Plan`。三條指派方案的路徑都只以 `slug` 查方案，查到就用：

| 路徑 | 位置 |
| --- | --- |
| 平台改租戶方案 | `platform-tenant.service.ts` 的 `updateTenant()` |
| 核准升級申請 | `plan-change.service.ts` 的 `approveRequest()` |
| 試用開通綁定方案 | `trial.service.ts`，方案來自 `trial.planSlug` |

因此把一個方案設為停售，只會改變 `/admin/plans` 上的顯示。它仍然可以被指派給新的或既有的租戶，既有租戶也完全不受影響。

這與 SLA-03 是同一種形狀：欄位有寫入端與介面，沒有讀取端，操作者以為的效果不會發生。

<a id="plan-02"></a>
### PLAN-02：加購 token 是永久提高每月額度

`approveRequest()` 核准 `token_topup` 時，把加購量加進 `tenant.limitOverrides.monthlyTokens`。

這個欄位是每月額度的上限，不是可消耗的餘額：

- 額度的判斷在 `token-quota.service.ts` 的 `isMonthlyTokenExceeded()`，拿當月累計用量與 `getEffectiveLimit(..., 'monthlyTokens')` 比較。
- 計數器的 Redis key 是 `aiquota:{tenantId}:{YYYY-MM}`，月底過期，每個月從零開始。
- `limitOverrides` 沒有期限欄位，核准後一直留著。

所以核准一次加購，是把該租戶往後每一個月的額度都提高同樣的量，不是給他一次性的配額。

兩邊介面寫的都是「加購 Token」：租戶端 `/dashboard/plan` 的說明是「申請升級方案或加購 AI token 額度」，平台端 `/admin/plan-changes` 顯示 `+N token`。兩者都看不出是一次性還是長期，審核者也沒有「這是第幾次加購、目前累計多少」的資訊。

這一項與 PLAN-01 不同，不是「設定了卻沒有讀取端」，而是資料結構表達的事情與介面用字不同。而且系統沒有計費機制（見 PLAN-10），因此永久提高額度不會造成重複收費，結果是平台往後每個月都無償提供同樣的加購量。

寫入方式另有兩個問題。

**累加沒有交易保護。** `approveRequest()` 的流程是 `findUnique` 讀出 `limitOverrides`、在記憶體算出新值、再 `update` 覆寫整個 JSON 物件。三步之間沒有交易。同一個租戶的兩筆加購申請若同時核准，兩邊都讀到同一個起始值，後寫入的會覆蓋先寫入的，其中一筆加購量消失。覆寫的是整份 JSON，因此將來若有其他路徑寫別的 key，那些值也會一起被蓋掉。同一個模組的 `platform-user.service.ts` 停用最後一個帳號時用了 `Serializable` 交易，兩處的嚴謹程度不一致。

**有效上限的解析邏輯有第二份副本。** `plan-change.service.ts:103` 自己重寫了一次「覆寫優先」的判斷，用 `overrides.monthlyTokens !== undefined`；`plan-limits.service.ts:16` 的 `resolveEffectiveLimit()` 用 `hasOwnProperty`。JSON 欄位存不出 `undefined`，所以兩者目前行為相同，但這是兩份會分歧的邏輯。`approveRequest()` 手上已經有 `limitOverrides` 與 `plan.limits`，可以直接呼叫 `resolveEffectiveLimit()`。

<a id="plan-03"></a>
### PLAN-03：換方案不會回收既有的超額狀態

租戶換方案有三個入口：平台改租戶方案（`updateTenant()`）、核准升級申請（`approveRequest()`）、試用轉正式（`convertToPaid()`）。三者都只寫 `planId`，以下三件事不會跟著改變。

**一、既有資源不會被回收。** 方案的數量上限只在建立時檢查：

| 上限 | 檢查點 |
| --- | --- |
| `maxAgents` | `agent.service.ts` 建立成員前 `count` 比對，超過回 403 `PLAN_LIMIT_EXCEEDED` |
| `maxChannels` | `channel.service.ts` 建立渠道前比對 |
| `allowedChannelTypes` | 只擋新建的渠道類型 |

因此降級到人數較少的方案之後，超出新上限的成員照常登入與使用，渠道也照常收發訊息，只有下一次新增才會被擋。系統不會提示租戶目前超額，也沒有任何地方列得出「哪些租戶超出自己方案的上限」。

**二、`limitOverrides` 不會被清除。** 這個欄位的值優先於方案的 `limits`，而且判斷的是 key 存不存在，連 `null`（無上限）都會延續，見 `../modules/platform/PLANS.md` 的有效上限一節。

寫入端只有一個：核准 `token_topup`。沒有任何路由或頁面可以檢視、修改或清除它。因此一個曾經加購過 AI 額度的租戶，降級之後仍然維持加購後的額度，而且**沒有任何介面能改回來**，只能直接改資料庫。加購本身的語意問題見 PLAN-02。

**三、其他行程的租戶方案快取不會失效。** `invalidateTenantPlan()` 清的是行程內的 `Map`，只對處理這個請求的行程有效。`invalidatePlanPermissions()` 走 Redis，所有行程一起生效。兩者搭配的結果是：其他行程在 60 秒內仍以舊的 `planId` 查天花板，降級後的權限收回會延後，升級後的新功能也會延後開通。

生產環境目前只跑一個 `api` 容器（`docker-compose.prod.yml` 沒有 replicas 設定），因此第三點尚未顯現。水平擴充時會出現。

<a id="plan-04"></a>
### PLAN-04：功能天花板在收件匣一帶沒有咬合點

方案用三種手段限制租戶，效力不同：

| 手段 | 強制點 | 是否生效 |
| --- | --- | --- |
| `limits.maxAgents` | `agent.service.ts` 建立成員前 count | 是 |
| `limits.maxChannels` | `channel.service.ts` 建立渠道前 count | 是 |
| `limits.monthlyTokens` | `token-quota.service.ts` 的 Redis 計數器 | 是 |
| `limits.maxTags` | **沒有強制點** | 否 |
| `allowedChannelTypes` | `channel.service.ts` 建立渠道時 | 是 |
| `features`（功能天花板） | 只有 `requirePermission()` | 視路由而定 |

功能天花板的公式是「角色權限 ∩ 方案天花板」，而這個交集只在 `requirePermission()` 執行時才被計算。沒有呼叫它的路由，方案開不開都一樣。

以 feature 分組統計各模組的路由數與權限檢查數（2026-09-24 核對）：

| feature | 路由層的覆蓋情況 | 關掉這個 feature |
| --- | --- | --- |
| `automation` | `canvas` 11 條全有、`automation` 7 條中 5 條 | 擋得住 |
| `analytics` | 9 條路由、10 處檢查 | 擋得住 |
| `channels` | `channel` 19 條中 17 條 | 大致擋得住 |
| `marketing` | 36 條中 21 條 | 大部分擋得住，仍有未檢查的路由 |
| `knowledge` | 21 條中 12 條 | 同上 |
| `portal` | 17 條中 8 條 | 同上 |
| `inbox` | `case` 19 條、`conversation` 14 條、`contact` 10 條、`tag` 4 條、`shortlink` 8 條，**全部 0 處檢查** | **沒有效果** |
| `core` | 恆開，方案不會關 | 不適用 |

也就是說，把 `inbox` 從方案的 `features` 拿掉之後，該租戶的收件匣、對話、案件、聯絡人、標籤與短連結全部照常使用。前端也擋不住：`apps/web` 的 `Sidebar.tsx` 會依權限過濾選單，但「收件匣」「工單」「聯繫人」「通知」四個節點沒有 `perm` 欄位，一律顯示。

`maxTags` 是另一種形狀的失效：它在 `apps/api/src` 只出現在 `plan-limits.service.ts` 的 `LimitKey` 型別宣告，沒有任何地方拿它比對，與 PLAN-01 的 `Plan.isActive` 相同。

成因見 RBAC-01。

<a id="plan-05"></a>
### PLAN-05：加購過的租戶升級方案，額度反而變低

`resolveEffectiveLimit()` 判斷 `limitOverrides` 有沒有這個 key，有就直接回傳覆寫值，不與方案的 `limits` 比大小。加購把覆寫值寫成「加購當時的方案額度 + 加購量」（見 PLAN-02），因此覆寫值綁的是**加購當時**的那個方案。

以 `packages/database/prisma/seed.ts` 的方案額度為例：

| 步驟 | `Plan.limits.monthlyTokens` | `limitOverrides.monthlyTokens` | 有效上限 |
| --- | --- | --- | --- |
| 綁 `light` | 1,500,000 | 未設定 | 1,500,000 |
| 核准加購 50,000 | 1,500,000 | 1,550,000 | 1,550,000 |
| 升級到 `standard` | 3,000,000 | 1,550,000 | **1,550,000** |

租戶付費升級之後，AI 月額度停在升級前的數字。換方案的三個入口（`updateTenant()`、`approveRequest()` 的 `upgrade`、`convertToPaid()`）都只寫 `planId`，沒有一個會清除或重算覆寫值。

沒有任何路由或頁面讀得到 `limitOverrides`，因此平台方也看不出這個租戶的額度為什麼沒跟著升級，只能直接改資料庫。

PLAN-03 記錄的是相反方向：降級之後仍然維持加購後的較高額度，結果對租戶有利。這一項是同一個機制在升級方向上的結果，對租戶不利。

<a id="plan-06"></a>
### PLAN-06：核准加購之後，當月的額度告警全部靜默

`approveRequest()` 核准加購後呼叫 `clearTokenQuotaCache(req.tenantId)`，程式註解寫「讓硬擋重讀新額度」。這一行清掉的是用量計數器 `aiquota:{tenantId}:{YYYY-MM}`，不是告警旗標。

清計數器沒有必要，也沒有效果：

- 上限不在 Redis。`isMonthlyTokenExceeded()` 每次都呼叫 `getEffectiveLimit()` 查資料庫，本來就讀得到新額度。
- 計數器存的是已用量。清掉之後，下一次呼叫會從 `aiUsage` 重新加總回填，得到的值與清掉之前相同，只是多跑一次聚合查詢。

真正需要清的是告警旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`。`checkQuotaThresholdCrossing()` 用 `SET NX` 搶旗標做冪等，搶不到就不回報該門檻，而旗標的過期時間是月底。於是同一個月內第二次接近上限時，兩個門檻都不會再發通知：

| 事件 | 有效上限 | 累計用量 | 跨越的門檻 | 是否通知 |
| --- | --- | --- | --- | --- | --- |
| 用量累積 | 200,000 | 160,000 | warning（80%） | 是，旗標寫入 |
| 用量累積 | 200,000 | 200,000 | critical（100%） | 是，旗標寫入。之後被硬擋 |
| 核准加購 300,000 | 500,000 | 200,000 | 無 | 無 |
| 用量累積 | 500,000 | 400,000 | warning（80%） | **否**，旗標已存在 |
| 用量累積 | 500,000 | 500,000 | critical（100%） | **否**，旗標已存在。再次被硬擋 |

告警會送給該租戶的所有 ADMIN，站內通知與 email 各一份（`notification.worker.ts:230`）。因此加購過的租戶當月第二次用完額度時，是毫無預警被擋下的。

租戶也無法自己查。`getEffectiveLimit()` 的呼叫端都在伺服器端做判斷，沒有任何路由把上限或已用量回傳給租戶端；租戶側的 `/api/v1/plan-change` 只能列出自己的申請與發起新申請。這兩個門檻的告警是租戶唯一的資訊來源。

<a id="plan-07"></a>
### PLAN-07：渠道的兩個分級欄位都沒有方案填過值

`resolveEffectiveLimit()` 在方案的 `limits` 沒有某個 key 時回傳 `null`，而 `null` 代表無上限。缺少設定的結果是完全不限制。

`packages/database/prisma/seed.ts` 的 `seedPlans()` 為每個方案寫的 `limits` 只有 `maxAgents`、`maxTags`、`monthlyTokens`，沒有 `maxChannels`。因此凡是綁定 seed 方案的租戶，渠道數都是無上限。

這一項與 PLAN-04 的 `maxTags` 剛好相反，兩者各缺一半：

| 上限 | 方案有定義嗎 | 有檢查點嗎 | 結果 |
| --- | --- | --- | --- |
| `maxAgents` | 有 | `agent.service.ts:162` | 生效 |
| `monthlyTokens` | 有 | `token-quota.service.ts:118` | 生效 |
| `maxChannels` | **沒有** | `channel.service.ts:117` | 檢查點永遠跳過 |
| `maxTags` | 有 | **沒有** | 設定值沒有讀取端 |

`/admin/plans` 的欄位清單（`apps/web/src/app/admin/plans/page.tsx` 的 `LIMIT_KEYS`）列出全部四項，`maxChannels` 顯示為空白。平台後台看不出「空白」在這裡代表方案從未定義這個 key，也就是無上限。

`updatePlanSchema` 的 `limits` 是 `z.record(...)`，沒有 key 白名單，也沒有必填項。送 `{}` 會通過驗證，該方案所有租戶的四項上限同時變成無上限。平台後台的頁面每次送出都帶完整的 `limits` 物件，因此從介面操作不會漏 key；直接呼叫 API 則會。

另一半是 `allowedChannelTypes`。`seedPlans()` 的 `upsert` 沒有傳這個欄位，因此五個方案都落在 schema 的預設值 `[]`，而 `[]` 的語意是不限制。`channel.service.ts:108` 的白名單檢查只在陣列非空時才比對，所以也永遠跳過。

兩者相加的結果是渠道這個維度完全沒有分級：

| | `light` | `enterprise` |
| --- | --- | --- |
| 渠道數上限 | 無上限 | 無上限 |
| 可建立的渠道類型 | 全部 | 全部 |

兩個機制的檢查程式碼都完整，缺的是方案資料。`/admin/plans` 兩個欄位都編輯得到，補上值就會生效。

<a id="plan-08"></a>
### PLAN-08：角色權限的顯示與儲存都不套方案天花板

租戶側「角色與權限」頁的勾選狀態來自資料庫的授予紀錄，與方案天花板無關。三個端點都不套天花板：

| 端點 | 回傳或寫入 | 是否套天花板 |
| --- | --- | --- |
| `GET /roles/matrix` | `getPermissionMatrix()`，整份權限註冊表 | 否 |
| `GET /roles/:id/permissions` | `role_permissions` 的原始列 | 否 |
| `PUT /roles/:id/permissions` | `setRolePermissions()` 的四道驗證 | 否 |

`setRolePermissions()` 驗依賴前置、越權、admin 核心鎖定與防自鎖。其中的越權防護讀 `getEffectivePermissions()`（角色原始權限），不是 `getEffectiveTenantPermissions()`（套過天花板的那一個）。因此租戶可以勾選方案不含的權限，儲存會成功，資料庫也會留下該筆授予。

這不是邊界情境。`seedRolesForTenant()` 給每個新租戶的 admin 角色種入 `DEFAULT_ROLE_PERMISSIONS.admin`，其值是 `PERMISSIONS.map((p) => p.code)`，也就是註冊表的全部權限碼，過程完全不看方案。以 seed 的 `light` 方案為例，它的 `features` 只有 `inbox` 與 `core`，`FEATURES` 的其餘六項都不在天花板內。

於是同一個權限在三個地方呈現三種狀態：

| 位置 | 讀的是什麼 | 顯示結果 |
| --- | --- | --- |
| 角色與權限頁 | `role_permissions` | 已勾選 |
| 側邊欄 | `/auth/me/permissions`（套過天花板） | 該選單不出現 |
| 直接開該路由 | `requirePermission()`（套過天花板） | 403 |

三處沒有任何一處說明原因。`403` 的訊息與權限不足時相同，看不出是方案不含這個功能。管理員看到角色頁上打勾，會判斷成系統故障。

PLAN-04 記的是天花板沒有咬合點、設定了也不生效。這一項相反：天花板確實生效，但沒有任何介面反映它的存在。

<a id="plan-09"></a>
### PLAN-09：改方案立即影響全體租戶，介面不顯示影響範圍

`updatePlan()` 寫入後，`features` 或 `permissionOverrides` 有變動就呼叫 `invalidatePlanPermissions()` 清掉該方案所有租戶的天花板交集快取。下一個請求就會用新的天花板重算，沒有灰度，也沒有延遲。`/admin/plans` 的提示文字有寫「該方案所有租戶即時生效」。

缺的是操作者判斷影響範圍所需的資訊：

- **看不到租戶數。** `listPlans()` 只做 `plan.findMany()`，沒有帶 `_count`，頁面也沒有顯示這個方案目前有幾個租戶。
- **沒有預覽與二次確認。** 取消勾選一個 feature 之後直接儲存即生效。
- **稽核不記舊值。** `plan.update` 的 payload 是送出的請求主體，只有新值。事後查不出改動前是什麼，也無法據以還原。

因此把 `professional` 的 `analytics` 取消勾選，所有 professional 租戶下一次請求就失去報表相關權限，而操作者在按下儲存之前不知道這影響幾個租戶，事後也沒有紀錄可以還原。

租戶端的感受見 PLAN-08：權限消失時，角色頁上那些權限仍然顯示為已勾選。

<a id="plan-10"></a>
### PLAN-10：加購沒有金額紀錄，事後無法對帳

這個系統不接金流。`Plan.priceMonthly` 的 schema 註解寫明「顯示用，不接金流」，資料庫也沒有帳單、發票或付款的資料表，沒有任何程式把用量或方案換算成應收金額。收費在系統外進行，這是設計決策，不是落差。

落差在於：加購這個動作在系統裡留下的紀錄，不足以還原當初賣了什麼。

**一、申請不記金額。** `PlanChangeRequest` 的欄位是 `type`、`targetPlanSlug`、`topupTokens`、`note` 與審核欄位，沒有金額欄位。租戶申請加購 30 萬 token，系統記得數量，記不得價格。

**二、覆寫值拆不開。** `limitOverrides.monthlyTokens` 存的是「加購當時的方案額度 + 加購量」的合併值（見 PLAN-02），無法從現況反推加購了多少。

**三、方案額度沒有變更歷史。** 要還原加購量，只能回頭加總該租戶所有已核准的 `topupTokens`，而這個算法必須假設 `Plan.limits.monthlyTokens` 從未被編輯過。`updatePlan()` 可以隨時改 `limits`，而且稽核只記新值（見 PLAN-09），因此這個假設無法驗證。

**四、沒有任何介面看得到。** `limitOverrides` 沒有讀取端（見 PLAN-03），平台後台列不出哪些租戶加購過、加購了多少、什麼時候加的。

四者相加的結果是：加購在系統裡留下的唯一痕跡，是一個拆不開、看不到、也對不回金額的數字。

租戶端同樣查不到。`/dashboard/plan` 只有申請表與自己的申請列表，看不到目前方案的內容、價格或已用額度。`priceMonthly` 只在平台後台的 `/admin/plans` 顯示，以及 `listPlans()` 拿來排序，從不回傳給租戶端。

`model_pricings` 不是租戶售價。它是各個 LLM 模型每 1M token 的單價，`platform-usage.service.ts` 用它算出平台自己的成本，顯示在 `/admin/usage`。

<a id="plan-11"></a>
### PLAN-11：平台查不到已處理的方案異動申請

`listPendingRequests()` 的查詢條件寫死 `status: 'pending'`，而平台側只有 `GET /api/v1/platform/plan-change-requests` 這一個列表端點。已核准與已駁回的申請一旦離開待審狀態，平台後台就再也看不到。

資料本身沒有遺失，只是平台讀不到。租戶側的 `listTenantPlanChangeRequests()` 查 `where: { tenantId }`，不分狀態，回傳最近 50 筆。同一批資料，租戶看得到自己的全部歷史，平台看不到任何一筆。

租戶詳情頁也沒有。`getTenantDetail()` 的 `select` 涵蓋方案、成員與各項計數，沒有 `planChangeRequests`，也沒有 `limitOverrides`。

從稽核紀錄反查不實用。平台稽核只有一個查詢端點 `GET /platform-users/:id/audit-logs`，條件是 `platformUserId` 或 `targetType = 'platform_user'`，上限 200 筆。它不能依租戶或 `action` 查詢，所以要找某個租戶的升級紀錄，必須先知道當初是哪一位平台人員核准的，再希望那筆還在他最近 200 筆之內。

`reviewedBy` 存的是 `platformUserId`，但不是外鍵，因此即使查到紀錄，要顯示審核者姓名仍須自己查 `platform_users`。

連帶影響 PLAN-10。那一項提到加購量可以回頭加總 `plan_change_requests.topupTokens` 來還原，但平台後台沒有任何介面做得到這件事，只能直接查資料庫。

<a id="plan-12"></a>
### PLAN-12：AI 不在功能天花板的維度內

`packages/core/src/rbac/features.ts` 的 `FEATURES` 有八個 slug：`inbox`、`channels`、`automation`、`marketing`、`analytics`、`knowledge`、`portal`、`core`。**沒有 `ai`。** 因此方案的 `features` 陣列無法表達「這個方案不含 AI」，平台後台方案頁的功能勾選區也關不掉 AI。

權限碼這一層同樣擋不住。AI 的入口有三類，只有一類掛得上權限：

| 入口 | 觸發者 | 授權判斷 |
| --- | --- | --- |
| `ai.routes.ts` 的 `/suggest-reply`、`/summarize`、`/analyze-sentiment`、`/classify`、`/rewrite` | 客服操作 | 只有 `fastify.authenticate`，沒有權限碼 |
| `ai.routes.ts` 的 `/agent/run`、`/agent/runs/:id` | 客服操作 | `requirePermission('inbox.reply')`、`('inbox.view')` |
| `kb-autoreply`（`automation.worker.ts`）、自動化動作（`engine/action-executor.ts`） | 客人傳訊息、規則命中 | 不經過路由，沒有請求可以掛 guard |

後兩個入口沒有使用者按下任何按鈕，因此不存在可以檢查權限的時機。

結果是控制 AI 只剩 `limits.monthlyTokens` 一個數值欄位，而它的語意在「不給用」這個方向上與其他欄位相反：

| `monthlyTokens` | `resolveEffectiveLimit()` 回傳 | 實際效果 |
| --- | --- | --- |
| 方案沒有這個 key | `null` | 無上限 |
| `null` | `null` | 無上限 |
| `0` | `0` | `used >= 0` 恆成立，一律擋下。這是唯一能表達「不給 AI」的寫法 |
| 正整數 | 該數值 | 依數值擋 |

其他欄位「留空」代表不限制，符合直覺；AI 要停用卻必須主動填 `0`。

兩點澄清，避免把這一項讀成比實際更嚴重：

- **現況沒有踩到。** `seedPlans()` 的五個方案都定義了 `monthlyTokens`，其中 `enterprise` 是 `null`（刻意無上限）。
- **介面有標示。** `/admin/plans` 的欄位標題是「數值上限（留空 = 無上限）」，placeholder 是「無上限」，輸入非數字時 `setLimit()` 會維持原值而不是解除上限。這一點比 PLAN-07 的 `maxChannels` 好：那個欄位是方案從未定義過，畫面同樣顯示空白，但「從未設定」與「刻意設成無上限」在介面上分辨不出來。

這一項記的是方案模型缺少 AI 這個維度，不是某個值設錯。

## AI 用量與成本

功能說明見[用量統計](../modules/platform/USAGE.md)。

<a id="ai-01"></a>
### AI-01：BYOK 金鑰解密失敗會靜默退回平台金鑰

BYOK 指租戶自備 Gemini API key，說明見[用量統計](../modules/platform/USAGE.md#哪些呼叫不算)。

`ai-key.service.ts` 的 `resolveGeminiKey()` 在解密租戶金鑰失敗時，`catch` 區塊是空的，直接往下走 fallback，回傳平台的 `GEMINI_API_KEY` 與 `source: 'platform'`。原始碼註解寫「解密失敗（如換過加密 key）→ 退回平台 key」，因此退回本身是刻意的。

問題是 `keySource` 一路決定三件事，退回之後全部反轉：

| | 退回前（`byok`） | 退回後（`platform`） |
| --- | --- | --- |
| 呼叫用誰的金鑰 | 租戶自備的 | 平台的 `GEMINI_API_KEY` |
| Google 的帳單開給誰 | 租戶 | **平台** |
| `AiUsage.costUsd` | 記 0 | 依 `ModelPricing` 實算（`llm.service.ts:80` 的 `!isByok`） |
| 是否計入租戶月額度 | 否 | **是**（`incrMonthlyTokens()` 只累加 `platform`） |
| 額度用完是否被擋 | 否 | **是**（`llm.service.ts:264`） |

租戶不會因此多付錢，系統沒有計費機制（見 PLAN-10）。他付出的是額度：原本不計數的呼叫開始消耗 `monthlyTokens`，用完還會被擋下。平台則開始承擔本來由租戶負擔的 LLM 費用。

觸發條件是解密失敗，最可能的成因是 `CREDENTIAL_ENCRYPTION_KEY` 輪替。`ai-key.service.ts` 的加解密直接複用 `channel.service.ts` 的函式，與渠道憑證共用同一把金鑰，因此一次輪替會讓所有租戶的 BYOK 同時退回平台金鑰。

兩端的訊號都很弱：

- **平台端沒有訊號。** 唯一的間接跡象是 `/admin/usage` 的成本上升，但那一頁不分 `keySource`（見 USAGE-01），看不出是哪些租戶，也看不出原因。
- **租戶端要主動去看才知道。** `getTenantGeminiKeyStatus()` 解密失敗時回 `configured: true`，遮罩字串是「（無法解密）」。設定頁看得到這行字，但 AI 呼叫本身不會失敗，也沒有任何通知，租戶沒有理由去開那一頁。

<a id="usage-01"></a>
### USAGE-01：用量頁沒有標示統計的母體與筆數上限

`/admin/usage` 有標對的部分：頁首寫「僅計成功呼叫」，「AI 呼叫數」卡片的副標是「成功呼叫」，「總成本」卡片的副標是「平台承擔（不含 BYOK）」。這三句都與 `platform-usage.service.ts` 的實作相符。

缺的是另外兩件事。

**一、相鄰兩張卡的母體不同，只有其中一張標了。** 三個查詢都沒有 `keySource` 條件，也不看 `usageMissing`，因此 BYOK 與查無價目的呼叫都計入 token 總量，只是成本以 0 併入：

| 卡片 | 母體 | 卡片上的說明 |
| --- | --- | --- |
| 總 AI Token | 含 BYOK、含查無價目 | 只寫活躍租戶數 |
| 總成本 | 不含 BYOK（那些是 0） | 「平台承擔（不含 BYOK）」 |

兩張卡並排，讀者會拿成本除以 token 推算平均單價，但分母的母體大於分子。

**二、租戶排行沒有標筆數上限。** `platform-usage.service.ts:65` 是 `take: 50`，介面標題只寫「各租戶用量排行」。租戶多於 50 個時，排行的 token 加總會小於總覽的數字，畫面上沒有任何說明。

另有一處說明與實作不符，位置在原始碼裡。`platform-usage.service.ts` 開頭的註解寫「失敗成本為 0，計入次數但不計 token/cost」，但三個查詢的 `where` 都有 `success: true`，失敗的呼叫連次數都不算。介面與實作是一致的，只有這行註解是錯的，會誤導下一個改這支服務的人。

<a id="usage-02"></a>
### USAGE-02：價目表沒有維護介面，缺價期間的成本永久記 0

`ModelPricing` 以 `(model, effectiveFrom)` 版本化，結構本身支援調價。缺的是寫入途徑。

**唯一的寫入端是 seed，而 seed 不能在正式環境執行。** 全 repo 只有 `packages/database/prisma/seed.ts:168` 會寫 `modelPricing`，平台後台沒有任何路由。但 `seed.ts` 的 `main()` 會建立 Demo Tenant 與一批固定密碼的 demo 成員，`seedPlatformUser()` 種的也是開發用密碼。因此「調價要改 seed」在正式環境等於不可行，實務上只剩直接改資料庫一條路。

**缺價期間的成本無法事後修正。** 成本在寫入 `AiUsage` 的當下就算好，之後不重算。`getPricing()` 查不到價目時 `calcCostUsd()` 回 `null`，呼叫端記 `costUsd = 0` 並標 `usageMissing`。所以從新模型開始被使用、到有人手動補上價目之間的每一筆呼叫，成本永久是 0，而 repo 裡沒有任何重算路徑。

**快取讓這段期間更長。** `pricingCache` 是行程內的 `Map`，TTL 10 分鐘，而且**連查無價目的 `null` 一起快取**。補上價目之後最久還要再等 10 分鐘才會套用，多個 API 行程各自計時。`clearPricingCache()` 的註解寫「測試/改價後手動清快取用」，但全 repo 沒有任何呼叫端，也沒有對外端點。

**平台看不出帳面被低估。** `/admin/usage` 不看 `usageMissing`（見 USAGE-01），畫面上的成本只會偏低，沒有任何提示。唯一的線索是 `recordAiUsage()` 留的一則 warn log。

**修正方向（2026-09-30 提出，尚未實作）**

補一組 `ModelPricing` 的平台路由即可，不需要改 schema，版本化欄位已經齊備：

- **寫入介面**：列出各 model 的現行價目、新增一個 `effectiveFrom` 版本。寫入時一併呼叫 `writePlatformAudit()`，調價是會改變帳面的操作，應該留紀錄。
- **快取失效**：把 `clearPricingCache()` 接到寫入路由。但它清的是行程內的 `Map`，多行程時只對自己有效，應比照 `invalidatePlanPermissions()` 改走 Redis。
- **不要快取查無價目**：查不到時縮短 TTL 或直接不寫入快取，避免補完價目還要等滿 10 分鐘。
- **既有的零成本列**：要修正需要一條重算路徑（依 `model` 與 `createdAt` 回查當時應適用的價目版本）。若不打算做重算，至少讓 `/admin/usage` 顯示 `usageMissing` 的筆數，讓平台知道帳面被低估——這一點與 USAGE-01 一起修。

## SLA

功能說明見[服務水準協議](../modules/SLA.md)。

<a id="sla-01"></a>
### SLA-01：`Case.firstResponseAt` 沒有寫入端

`packages/database/prisma/schema.prisma:742` 宣告 `firstResponseAt`，對應的 migration 也建了欄位。三個地方讀這個欄位：

- `apps/workers/src/handlers/sla.handler.ts` 的第 390 與 406 行，用它判定首次回應是否已達成。
- `apps/api/src/modules/analytics/analytics.service.ts` 的第 100 與 351 行，用它計算平均首次回應時間。
- `apps/web/src/components/inbox/ContactInfoPanel.tsx:203`，顯示給客服看。

全 repo 沒有任何程式寫入這個欄位。以 `firstResponseAt` 為關鍵字搜尋 `apps/` 與 `packages/`，命中的都是 schema 宣告、型別宣告、`select` 子句或讀取端。

兩個後果：

1. 客服即使立刻回覆，工單仍會在 `createdAt + firstResponseMinutes` 到期時判定為 `first_response_breached`。系統接著通知負責人與該租戶的 `ADMIN`、`SUPERVISOR`，寫入 `CaseEvent`，並觸發租戶的自動化規則。每張套用政策的工單都會發生一次。
2. 分析報表的平均首次回應時間永遠沒有數值。SQL 的 `FILTER (WHERE "firstResponseAt" IS NOT NULL)` 濾出空集合，`AVG()` 回傳 null。

這一項會持續產生假警報，不需要特定操作觸發。

<a id="sla-02"></a>
### SLA-02：掃描每輪上限 100 張工單

`apps/workers/src/handlers/sla.handler.ts` 的 `getActiveCases()` 用 `take: 100` 取工單，沒有 `orderBy`，也沒有租戶條件。這個上限是全系統共用，不是每個租戶各 100 張。

全系統符合條件的工單超過 100 張時，超出的部分在該輪不會被檢查。沒有 `orderBy`，因此每輪取到哪 100 張由資料庫決定，不保證輪替。掃描間隔是 300 秒。

<a id="sla-03"></a>
### SLA-03：`isDefault` 沒有讀取端

`apps/api/src/modules/sla/sla.routes.ts` 的建立與修改路由各有一段邏輯，維持「同一優先級只有一條政策的 `isDefault` 是 `true`」。`apps/web/src/components/settings/SlaManagement.tsx` 也顯示這個標記。

但 `apps/api/src/modules/case/case.service.ts:279` 在呼叫端沒有指定 `slaPolicyId` 時，是這樣挑政策的：

```ts
await prisma.slaPolicy.findFirst({ where: { tenantId, priority } })
```

沒有 `isDefault: true`，也沒有 `orderBy`。同一優先級有多條政策時，挑中哪一條由資料庫決定，與 `isDefault` 無關。

<a id="sla-04"></a>
### SLA-04：工單以政策名稱連結政策

`SlaPolicy` 與 `Case` 之間沒有 relation。`Case.slaPolicy` 是 `String?`，存的是政策名稱。`case.service.ts` 建立工單時寫入 `slaPolicy: slaPolicy?.name`，`sla.handler.ts` 的 `getPolicy()` 再以 `findFirst({ where: { tenantId, name } })` 回查。

由此產生三個問題：

- 修改政策名稱之後，既有工單的 `slaPolicy` 仍是舊名稱。`getPolicy()` 回傳 null，`sla.handler.ts` 直接 `continue`，該工單從此不再受監控，而且沒有任何紀錄。
- `sla_policies` 只有 `@@index([tenantId])`，沒有 `(tenantId, name)` 的唯一約束。同一租戶建立兩條同名政策時，`findFirst` 回傳哪一條不確定。
- `DELETE /api/v1/sla-policies/:id` 是硬刪除，沒有引用檢查。`SlaPolicy` 沒有 `isActive` 欄位，因此無法套用 `AGENTS.md` 的 soft-delete 慣例。刪除後，引用該名稱的工單留下一個查不到政策的字串。

## 部署與應用程式

<a id="dep-01"></a>
### DEP-01：殘留的 Video Worker 設定

`apps/video-worker` 沒有原始碼與 `package.json`，但開發 Compose 仍保留 `nm_videoworker` volume 與掛載點。

<a id="dep-02"></a>
### DEP-02：`.env.prod.example` 的變數送不到讀取它們的行程

`docker-compose.prod.yml` 只把 `.env.prod` 掛給 nginx（:122）與 certbot（:135）。api、workers、web 各自讀 `.env.api`、`.env.workers`、`.env.web`。

`.env.prod.example` 除了 `DOMAIN` 與 `CERTBOT_EMAIL`，還放了下表這些變數。它們只有 api 或 workers 讀：

| 變數 | 讀取端 | 缺少時的行為 |
| --- | --- | --- |
| `DATABASE_URL_ADMIN` | `apps/api/src/plugins/prisma.plugin.ts:36`、`apps/workers/src/index.ts:58` | api fallback 到租戶連線，workers 拋錯不啟動。見 RLS-04 |
| `CHATBOX_SESSION_TTL_MINUTES` | `apps/api/src/modules/chatbox/chatbox.service.ts:99` | 取程式預設值，與範例檔給的值相同 |
| `WEBCHAT_LEGACY_ROUTES_ENABLED` | `apps/api/src/modules/webchat/webchat.routes.ts:84` | 取程式預設值 `false`，與範例檔給的值相同 |

nginx 的 entrypoint 只用 `DOMAIN`，certbot 的 entrypoint 只用 `DOMAIN` 與 `CERTBOT_EMAIL`。拿到 `.env.prod` 的這兩個容器都不讀上表的變數。

實際影響集中在 `DATABASE_URL_ADMIN`。api 缺少這個變數時不會報錯，`prismaAdmin` 直接指向租戶連線，因此失去 BYPASSRLS。走白名單的服務查詢受 RLS 的租戶表時，會得到空結果，而不是錯誤。這些服務包含平台後台、auth、排程、OAuth callback 與公開 webhook。唯一的訊號是啟動 log 少印 `+ admin`。另外兩個變數的程式預設值與範例檔的值相同，缺少它們沒有差別。

上表的變數在 `.env.api.example` 都已經有一份，`DATABASE_URL_ADMIN` 在 `.env.workers.example` 也有。部署時逐一複製 `.env.*.example` 就不會缺這些值。`.env.prod.example` 裡的這幾行是第二份副本，改一邊不會同步到另一邊。

`docker-compose.prod.yml` 開頭的步驟說明只要求建立 `.env.prod`，沒有提到 `.env.api`、`.env.web`、`.env.workers`。Compose 發現 `env_file` 指向的檔案不存在時，在解析階段就報錯，不會啟動任何服務。照那份步驟說明操作，`docker compose -f docker-compose.prod.yml up -d` 會直接失敗。`AGENTS.md` 的「Environment Gotchas」有寫要複製這三個檔案，prod compose 檔本身沒寫。

CI 的部署不走這條路徑。`.github/workflows/deploy.yml` 用的是 `docker-compose.yml`，而且有一步檢查 `.env.web`、`.env.api`、`.env.workers` 是否存在，缺一個就讓部署失敗。因此這個落差只影響照 `docker-compose.prod.yml` 手動部署的人。

<a id="app-01"></a>
### APP-01：兩套 SLA 機制

`packages/core/src/cases/case-service.ts` 在模組載入時建立 `sla-monitoring` consumer。任何匯入 `@open333crm/core` 的程序都會產生副作用。`apps/workers` 另有正式的 `sla` consumer，因此 Redis 同時出現 `sla` 與 `sla-monitoring`。

執行時匯入 `@open333crm/core` 會立即建立 Redis 連線，證實模組載入具有副作用。

<a id="app-02"></a>
### APP-02：Telegram 未註冊

渠道套件只匯出 `TelegramPlugin` 類別，沒有 `telegramPlugin` 實例。API 因此無法將 Telegram 傳給 `registerChannelPlugin()`。執行時檢查顯示 LINE、Facebook、WebChat、Threads 已註冊，Telegram 未註冊。

<a id="app-03"></a>
### APP-03：啟動 log 過時

API 啟動 log 寫死為 `LINE, FB, WEBCHAT`，但實際註冊表也包含 Threads。

<a id="app-04"></a>
### APP-04：Worker 檔名與內容不符

API 的 `automation.worker.ts` 與 `notification.worker.ts` 只建立 Queue producer。真正的 consumer 位於 `apps/workers`。

## 共用套件

<a id="pkg-01"></a>
### PKG-01：重複的渠道型別

`packages/types` 與 `packages/shared` 都定義 `ChannelType`、`MessageContentType`。兩份定義目前相同，但沒有同步機制。

<a id="pkg-02"></a>
### PKG-02：錯誤的 Facebook 子路徑

`channel-plugins` 的 `./fb` export 指向 `dist/fb/index.js`，實際輸出位於 `dist/facebook/index.js`。容器內執行 `import('@open333crm/channel-plugins/fb')` 會回傳 `ERR_MODULE_NOT_FOUND`。

<a id="pkg-03"></a>
<a id="pkg-04"></a>
### PKG-03、PKG-04：未接線套件仍持續建置

`brain` 沒有 app 使用者；`ui` 只有空匯出。兩者仍由開發環境的 `packages` 服務建置並啟動 watch process。

## Storage、LLM 與資料庫

<a id="sto-01"></a>
### STO-01：Workers 無法連線 MinIO

Workers 的 `MinioStorageProvider` 讀取 `MINIO_*`，但 `.env.workers` 提供 `S3_*`。`STORAGE_PROVIDER` 也沒有程式讀取。Provider 最後採用 `localhost:9000`，在 Workers 容器內會連回自己。

執行時呼叫 `listBuckets()` 已重現 `ECONNREFUSED`。

<a id="llm-01"></a>
### LLM-01：Ollama 位址錯誤

`tenant_settings.chatBaseUrl` 與 `embeddingBaseUrl` 預設為 `http://localhost:11434`。在 API 容器內，這個位址指向 API 自己，不是 `ollama` 容器。執行時連線已重現 `Connection refused`。

Chat 生成路徑已有一層補救，做法見 LLM-03。Embedding 路徑沒有這層補救，仍然直接使用 `tenant_settings.embeddingBaseUrl`。

<a id="llm-02"></a>
### LLM-02：Chat 模型預設不一致

Compose 預設下載 `qwen2.5:0.5b`；資料庫欄位預設為 `qwen2.5:3b`。開發環境沒有 Ollama，因此只確認兩邊設定值不同。

<a id="llm-03"></a>
### LLM-03：部分生效的 API 環境變數

Chat 與 Embedding 的實際設定來自 `tenant_settings`，不是環境變數。commit `ee251c8` 為其中一條路徑加上補救：`apps/api/src/modules/ai/providers/ollama.provider.ts` 的 `generate()` 與 `generateToolTurn()` 在租戶設定的 `baseUrl` 等於預設值 `http://localhost:11434` 時，改讀 `process.env.OLLAMA_BASE_URL`。

因此 `OLLAMA_BASE_URL` 目前只在兩種條件同時成立時生效：呼叫的是 Chat 生成，而且租戶沒有改過 `chatBaseUrl`。租戶把 `chatBaseUrl` 改成其他值之後，即使那個值連不通，補救也不會套用。

以下路徑仍然不讀環境變數：

- 同一個檔案的 `listModels()` 與 `health()`。
- Embedding 的所有路徑。

`OLLAMA_EMBED_MODEL` 與 `OLLAMA_CHAT_MODEL` 仍然沒有任何程式讀取。

<a id="db-01"></a>
### DB-01：向量維度不一致

Prisma schema 與程式常數使用 1024 維。執行中的 `km_articles.embedding` 與 `long_term_memories.embedding` 欄位都是 `vector(1536)`。預設的 `bge-m3` 產生 1024 維向量，直接寫入會被資料庫拒絕。

## CI 與測試

盤點時，`.github/workflows/ci.yml` 只執行 RLS 隔離測試，lint 步驟只輸出略過訊息。之後有 commit 刪除了 `ci.yml`，刪除經過見 `AGENTS.md` 的「CI gates」一節。目前唯一的 workflow 是 `deploy.yml`，它只負責部署到 UAT，不執行測試或 lint。

<a id="ci-01"></a>
### CI-01：沒有 CI 執行 API 測試

沒有任何 CI workflow 執行 API 測試。API 測試也沒有統一入口。

<a id="ci-02"></a>
### CI-02：沒有 CI 執行 lint

`eslint.config.js` 與 `pnpm lint` 已存在，但沒有任何 CI workflow 執行 lint。

<a id="ci-03"></a>
### CI-03：測試工具未整合

測試檔使用 Vitest API，卻由 `tsx` 個別執行。專案無法使用 Vitest 的統一執行、覆蓋率及 watch mode。

## 已查證後排除的項目

以下項目在盤點時看起來像落差，查證後確認是刻意的設計，記錄於此避免重複回報。

### `broadcast` 佇列不是遺留物

`apps/workers/src/index.ts` 建立了一個 `broadcast` 佇列，但沒有對應的 consumer。這段程式的用途是清除 Redis 中殘留的 repeatable job：取得所有 repeatable job、逐一移除、然後關閉佇列。清理失敗時只記錄 warning，不影響啟動。原始碼的註解已說明這個意圖。

## 已核對的資料庫基線

2026-09-02 在開發環境核對以下資料：

| 項目 | 結果 |
| --- | --- |
| Prisma model | 78 |
| enum | 24 |
| migration | 45 |
| 外鍵 | 114 |
| 啟用及強制 RLS 的資料表 | 71 |
| 未啟用 RLS 的平台表 | 7 |
| `app_tenant.rolbypassrls` | `false` |
| `app_admin.rolbypassrls` | `true` |

未啟用 RLS 的平台表是 `model_pricings`、`plans`、`platform_audit_logs`、`platform_settings`、`platform_users`、`tenants`、`trial_signups`。

