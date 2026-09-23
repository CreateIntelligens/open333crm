# 實作落差與驗證紀錄

本文件集中記錄系統盤點時發現的實作落差。其他系統文件只描述主要結構，不重複問題細節。

- **驗證環境**：`docker compose -f docker-compose.dev.yml`
- **執行時驗證日期**：2026-09-02
- **最近複查日期**：2026-09-23。歷次複查的範圍、方法與結果見[實作落差複查紀錄](./AUDIT-REVIEWS.md)。
- **限制**：開發環境沒有 Ollama，因此部分模型問題只能用設定與資料庫狀態驗證。

## 摘要

| ID | 範圍 | 問題 | 驗證狀態 |
| --- | --- | --- | --- |
| DEP-01 | 部署 | `video-worker` 只剩殘留 volume 設定 | 靜態確認 |
| APP-01 | Apps | `core` 載入時啟動另一套 SLA consumer | 執行時確認 |
| APP-02 | Apps | Telegram 外掛未註冊 | 執行時確認 |
| APP-03 | Apps | 啟動 log 少列 Threads | 執行時確認 |
| APP-04 | Apps | API 的 `*.worker.ts` 實際是 Queue producer | 靜態確認 |
| PKG-01 | Packages | `types` 與 `shared` 重複定義渠道型別 | 靜態確認 |
| PKG-02 | Packages | `channel-plugins/fb` 子路徑指向錯誤 | 執行時重現 |
| PKG-03 | Packages | `brain` 尚未接線，仍持續建置與監看 | 執行時確認 |
| PKG-04 | Packages | `ui` 是空殼，仍持續建置與監看 | 執行時確認 |
| STO-01 | Storage | Workers 的 MinIO 設定名稱不一致 | 執行時重現 |
| LLM-01 | LLM | Ollama base URL 預設指向容器自己 | 執行時重現 |
| LLM-02 | LLM | Compose 與資料庫的 Chat 模型預設不同 | 部分驗證 |
| LLM-03 | LLM | API 宣告的 `OLLAMA_*` 只對 Chat 生成路徑生效 | 部分修正 |
| DB-01 | Database | Prisma 與資料庫的向量維度不一致 | 執行時重現 |
| RLS-01 | 租戶隔離 | Canvas 引擎不走租戶連線 | 靜態確認 |
| RLS-02 | 租戶隔離 | 身分合併審核端點沒有租戶檢查 | 靜態確認 |
| RLS-03 | 租戶隔離 | 隔離檢查腳本掃不到 `packages/*` | 靜態確認 |
| RLS-04 | 租戶隔離 | `.env.api.example` 沒有 `DATABASE_URL_TENANT` | 靜態確認 |
| SLA-01 | SLA | `Case.firstResponseAt` 沒有寫入端，首次回應 SLA 必定判定逾時 | 靜態確認 |
| SLA-02 | SLA | SLA 掃描每輪上限 100 張工單，且不分租戶 | 靜態確認 |
| SLA-03 | SLA | `isDefault` 沒有讀取端，預設政策記帳不影響挑選結果 | 靜態確認 |
| SLA-04 | SLA | 工單以政策名稱連結，改名或刪除即脫鉤 | 靜態確認 |
| TRIAL-01 | 試用與方案 | 走 plan-change 升級的試用租戶不會脫離試用，到期仍被停用 | 靜態確認 |
| LIC-01 | License | API 使用寫死的授權資料 | 間接確認 |
| LIC-02 | License | 可連線的 Core LicenseService 沒有使用者 | 靜態確認 |
| SEC-01 | Security | Workers 的渠道加密金鑰仍有硬編碼備援值（API 已修正） | 靜態確認 |
| SEC-02 | Security | 平台帳號的登入與密碼重設沒有寫入稽核紀錄 | 靜態確認 |
| SEC-03 | Security | rate-limit 只註冊在 platform 路由的 scope 內 | 靜態確認 |
| CI-01 | CI | 沒有 CI workflow 執行 API 測試 | 靜態確認 |
| CI-02 | CI | 沒有 CI workflow 執行 lint | 靜態確認 |
| CI-03 | Test | Vitest API 與 `tsx` 執行方式不一致 | 靜態確認 |

## 部署與應用程式

### DEP-01：殘留的 Video Worker 設定

`apps/video-worker` 沒有原始碼與 `package.json`，但開發 Compose 仍保留 `nm_videoworker` volume 與掛載點。

### APP-01：兩套 SLA 機制

`packages/core/src/cases/case-service.ts` 在模組載入時建立 `sla-monitoring` consumer。任何匯入 `@open333crm/core` 的程序都會產生副作用。`apps/workers` 另有正式的 `sla` consumer，因此 Redis 同時出現 `sla` 與 `sla-monitoring`。

執行時匯入 `@open333crm/core` 會立即建立 Redis 連線，證實模組載入具有副作用。

### APP-02：Telegram 未註冊

渠道套件只匯出 `TelegramPlugin` 類別，沒有 `telegramPlugin` 實例。API 因此無法將 Telegram 傳給 `registerChannelPlugin()`。執行時檢查顯示 LINE、Facebook、WebChat、Threads 已註冊，Telegram 未註冊。

### APP-03：啟動 log 過時

API 啟動 log 寫死為 `LINE, FB, WEBCHAT`，但實際註冊表也包含 Threads。

### APP-04：Worker 檔名與內容不符

API 的 `automation.worker.ts` 與 `notification.worker.ts` 只建立 Queue producer。真正的 consumer 位於 `apps/workers`。

## 共用套件

### PKG-01：重複的渠道型別

`packages/types` 與 `packages/shared` 都定義 `ChannelType`、`MessageContentType`。兩份定義目前相同，但沒有同步機制。

### PKG-02：錯誤的 Facebook 子路徑

`channel-plugins` 的 `./fb` export 指向 `dist/fb/index.js`，實際輸出位於 `dist/facebook/index.js`。容器內執行 `import('@open333crm/channel-plugins/fb')` 會回傳 `ERR_MODULE_NOT_FOUND`。

### PKG-03、PKG-04：未接線套件仍持續建置

`brain` 沒有 app 使用者；`ui` 只有空匯出。兩者仍由開發環境的 `packages` 服務建置並啟動 watch process。

## Storage、LLM 與資料庫

### STO-01：Workers 無法連線 MinIO

Workers 的 `MinioStorageProvider` 讀取 `MINIO_*`，但 `.env.workers` 提供 `S3_*`。`STORAGE_PROVIDER` 也沒有程式讀取。Provider 最後採用 `localhost:9000`，在 Workers 容器內會連回自己。

執行時呼叫 `listBuckets()` 已重現 `ECONNREFUSED`。

### LLM-01：Ollama 位址錯誤

`tenant_settings.chatBaseUrl` 與 `embeddingBaseUrl` 預設為 `http://localhost:11434`。在 API 容器內，這個位址指向 API 自己，不是 `ollama` 容器。執行時連線已重現 `Connection refused`。

Chat 生成路徑已有一層補救，做法見 LLM-03。Embedding 路徑沒有這層補救，仍然直接使用 `tenant_settings.embeddingBaseUrl`。

### LLM-02：Chat 模型預設不一致

Compose 預設下載 `qwen2.5:0.5b`；資料庫欄位預設為 `qwen2.5:3b`。開發環境沒有 Ollama，因此只確認兩邊設定值不同。

### LLM-03：部分生效的 API 環境變數

Chat 與 Embedding 的實際設定來自 `tenant_settings`，不是環境變數。commit `ee251c8` 為其中一條路徑加上補救：`apps/api/src/modules/ai/providers/ollama.provider.ts` 的 `generate()` 與 `generateToolTurn()` 在租戶設定的 `baseUrl` 等於預設值 `http://localhost:11434` 時，改讀 `process.env.OLLAMA_BASE_URL`。

因此 `OLLAMA_BASE_URL` 目前只在兩種條件同時成立時生效：呼叫的是 Chat 生成，而且租戶沒有改過 `chatBaseUrl`。租戶把 `chatBaseUrl` 改成其他值之後，即使那個值連不通，補救也不會套用。

以下路徑仍然不讀環境變數：

- 同一個檔案的 `listModels()` 與 `health()`。
- Embedding 的所有路徑。

`OLLAMA_EMBED_MODEL` 與 `OLLAMA_CHAT_MODEL` 仍然沒有任何程式讀取。

### DB-01：向量維度不一致

Prisma schema 與程式常數使用 1024 維。執行中的 `km_articles.embedding` 與 `long_term_memories.embedding` 欄位都是 `vector(1536)`。預設的 `bge-m3` 產生 1024 維向量，直接寫入會被資料庫拒絕。

## 租戶隔離

以下四項在 2026-09-23 盤點 Canvas 模組時發現，都是靜態確認。

### RLS-01：Canvas 引擎不走租戶連線

`packages/core/src/canvas/flow-runner.ts:6` 匯入 `@open333crm/database` 的 module-level `prisma` singleton。`packages/core/src/canvas/scheduler.ts:68` 與 `apps/api/src/modules/canvas/canvas.webhook.ts:6` 也用同一個 singleton。

這個 client 由 `packages/database/src/client.ts` 以 `new PrismaClient()` 建立，沒有指定 datasource，因此連線字串是 `DATABASE_URL`。這個 singleton 與 `apps/api/src/plugins/prisma.plugin.ts` 建立的租戶連線不是同一條連線，連線上也不會有 `app.current_tenant`。`AGENTS.md` 明文禁止 `packages/*` 使用這個 singleton。

`FlowRunner` 的查詢全部以主鍵 `executionId` 定位（`flow-runner.ts` 的第 27、70、83、104、278 行），`where` 沒有 `tenantId`。`canvas.service.ts` 的 `triggerFlow()` 建立 execution 時用的是受約束的 `TenantDb`，但建立後把 `execution.id` 交給 `FlowRunner.run()`，之後的讀寫就離開租戶連線。

後果依 `DATABASE_URL` 指向哪個 role 而不同：

- 指向 superuser 或帶 BYPASSRLS 的 role（`.env.api.example` 的 `crm` 屬於這類）：Canvas 的所有讀寫跳過 RLS。
- 指向 `app_tenant`：singleton 的連線沒有 `app.current_tenant`，policy fail-closed，`FlowRunner.run()` 在第一個 `findUniqueOrThrow` 就查不到列，Canvas 會靜默停止運作。

### RLS-02：身分合併審核端點沒有租戶檢查

`apps/api/src/modules/canvas/canvas.routes.ts` 的第 177 與 183 行把路徑參數直接交給 `approveMerge(suggestionId, agentId)` 與 `rejectMerge(suggestionId, agentId)`，沒有傳入 `request.agent.tenantId`。

`packages/core/src/identity/merge-suggestion-service.ts` 的第 74 與 150 行用 singleton 以主鍵查 `mergeSuggestion`，`where` 也沒有 `tenantId`。`approveMerge` 接著依該筆建議自己的 `tenantId` 合併聯繫人。

兩層租戶隔離在這條路徑上都不生效：應用層沒有比對 `request.agent.tenantId`，資料層走的是不綁租戶的 singleton。持有 `identity.review` 權限的 agent 若取得其他租戶的建議 id，就能核准或駁回該筆建議。同一個檔案的 `listSuggestions()` 有收 `tenantId` 並寫進 `where`，不受這項影響。

### RLS-03：隔離檢查腳本掃不到 `packages/*`

`scripts/check-tenant-scoping.mjs:24` 與 `scripts/check-prisma-admin-usage.mjs:18` 的 `SCAN_DIR` 都是 `apps/api/src`。`packages/*` 不在掃描範圍，因此這兩道檢查攔不到 RLS-01 與 RLS-02 位於 `packages/core` 的程式碼。

兩支腳本檢查的項目是「query 有沒有 `tenantId`」與「有沒有使用 `prismaAdmin`」，沒有檢查「有沒有匯入 module-level singleton」。即使把 `packages/*` 納入掃描範圍，現有規則仍然抓不到這個寫法。

`packages/core` 另有三個檔案匯入同一個 singleton：`inbox/inbox-service.ts`、`contacts/contact-service.ts` 與 `identity/merge-suggestion-service.ts`。前兩個目前沒有任何 app 使用，情況與 PKG-03 相同。

### RLS-04：`.env.api.example` 沒有 `DATABASE_URL_TENANT`

`apps/api/src/plugins/prisma.plugin.ts:31` 在 `DATABASE_URL_TENANT` 未設定時 fallback 到 `DATABASE_URL`。`.env.api.example` 只提供 `DATABASE_URL`（`crm`）與 `DATABASE_URL_ADMIN`，沒有 `DATABASE_URL_TENANT`。

照著範例檔部署時，`fastify.prisma`、`request.tenantPrisma` 與 `withTenant()` 都會連到 `crm`。RLS 這一層不會生效，而且啟動時沒有任何警告。

`apps/workers/src/index.ts:59` 對 `DATABASE_URL_ADMIN` 的處理方式相反：變數缺少就拋錯，Workers 不啟動。API 的租戶連線沒有對應的檢查。

## SLA

以下四項在 2026-09-23 盤點 SLA 功能時發現，都是靜態確認。功能說明見[服務水準協議](../modules/SLA.md)。

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

### SLA-02：掃描每輪上限 100 張工單

`apps/workers/src/handlers/sla.handler.ts` 的 `getActiveCases()` 用 `take: 100` 取工單，沒有 `orderBy`，也沒有租戶條件。這個上限是全系統共用，不是每個租戶各 100 張。

全系統符合條件的工單超過 100 張時，超出的部分在該輪不會被檢查。沒有 `orderBy`，因此每輪取到哪 100 張由資料庫決定，不保證輪替。掃描間隔是 300 秒。

### SLA-03：`isDefault` 沒有讀取端

`apps/api/src/modules/sla/sla.routes.ts` 的建立與修改路由各有一段邏輯，維持「同一優先級只有一條政策的 `isDefault` 為真」。`apps/web/src/components/settings/SlaManagement.tsx` 也顯示這個標記。

但 `apps/api/src/modules/case/case.service.ts:279` 在呼叫端沒有指定 `slaPolicyId` 時，是這樣挑政策的：

```ts
await prisma.slaPolicy.findFirst({ where: { tenantId, priority } })
```

沒有 `isDefault: true`，也沒有 `orderBy`。同一優先級有多條政策時，挑中哪一條由資料庫決定，與 `isDefault` 無關。

### SLA-04：工單以政策名稱連結政策

`SlaPolicy` 與 `Case` 之間沒有 relation。`Case.slaPolicy` 是 `String?`，存的是政策名稱。`case.service.ts` 建立工單時寫入 `slaPolicy: slaPolicy?.name`，`sla.handler.ts` 的 `getPolicy()` 再以 `findFirst({ where: { tenantId, name } })` 回查。

由此產生三個問題：

- 修改政策名稱之後，既有工單的 `slaPolicy` 仍是舊名稱。`getPolicy()` 回傳 null，`sla.handler.ts` 直接 `continue`，該工單從此不再受監控，而且沒有任何紀錄。
- `sla_policies` 只有 `@@index([tenantId])`，沒有 `(tenantId, name)` 的唯一約束。同一租戶建立兩條同名政策時，`findFirst` 回傳哪一條不確定。
- `DELETE /api/v1/sla-policies/:id` 是硬刪除，沒有引用檢查。`SlaPolicy` 沒有 `isActive` 欄位，因此無法套用 `AGENTS.md` 的 soft-delete 慣例。刪除後，引用該名稱的工單留下一個查不到政策的字串。

## 試用與方案

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

## 授權與安全

### LIC-01、LIC-02：兩份 LicenseService

`license.guard.ts` 使用 `apps/api/src/services/license.ts`。該實作直接建立寫死的授權資料，不會連線到授權伺服器。

`packages/core/src/license/license-service.ts` 會呼叫 `LICENSE_FETCH_URL`，但沒有實際使用者。

### SEC-01：渠道加密金鑰備援值

盤點時，API 的 `channel.service.ts` 與 Workers 的 `apps/workers/src/lib/credentials.ts` 都有同一個備援字串。缺少 `CREDENTIAL_ENCRYPTION_KEY` 時，兩個檔案都改用這個公開在原始碼中的字串。

Commit `f507fe1` 修正了 API 端：

- `channel.service.ts` 在金鑰缺少或長度不足時拋出錯誤。
- API 啟動時的環境變數驗證要求這個變數，設定缺失會讓 API 啟動失敗。

Workers 端尚未修正。`credentials.ts` 仍保留備援字串，設定缺失不會讓 Workers 啟動失敗。Workers 只用這把金鑰解密，因此不會用備援值加密新資料。Workers 缺少金鑰時，這項設定錯誤要到 Workers 解密渠道憑證時才會出現。

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

## CI 與測試

盤點時，`.github/workflows/ci.yml` 只執行 RLS 隔離測試，lint 步驟只輸出略過訊息。之後有 commit 刪除了 `ci.yml`，刪除經過見 `AGENTS.md` 的「CI gates」一節。目前唯一的 workflow 是 `deploy.yml`，它只負責部署到 UAT，不執行測試或 lint。

### CI-01：沒有 CI 執行 API 測試

沒有任何 CI workflow 執行 API 測試。API 測試也沒有統一入口。

### CI-02：沒有 CI 執行 lint

`eslint.config.js` 與 `pnpm lint` 已存在，但沒有任何 CI workflow 執行 lint。

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

