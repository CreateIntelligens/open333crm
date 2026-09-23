# 實作落差複查紀錄

本文件按日期記錄[實作落差與驗證紀錄](./AUDIT.md)的複查結果。`AUDIT.md` 只描述各項目的現況；每次複查的範圍、方法與結果記錄在本文件。

新的複查紀錄加在最上方。

## 2026-09-23：試用生命週期追查，新增 TRIAL-01

起因是閱讀[平台後台](../modules/platform/README.md)的試用管理一節時，發現該節只列函式行為、沒有說明誰能觸發，讀者無法判斷延長試用是逐筆操作還是批次。釐清的過程中比對了升級的兩條路徑，發現結果不一致。做法是靜態閱讀原始碼，沒有啟動容器。

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
