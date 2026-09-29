# 實作落差複查紀錄

本文件按日期記錄[實作落差與驗證紀錄](./AUDIT.md)的複查結果。`AUDIT.md` 只描述各項目的現況；每次複查的範圍、方法與結果記錄在本文件。

新的複查紀錄加在最上方。

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
- `features` 雖然不驗 slug（見[方案與功能](../modules/platform/PLANS.md)），但 `/admin/plans` 的功能清單是從 `GET /registry` 產生的勾選項，介面操作打不出不存在的 slug。風險只存在於直接呼叫 API。
- `limits` 沒有任何快取，`getEffectiveLimit()` 每次都查資料庫，因此改上限不會有陳舊資料問題。
- `permissionOverrides.deny` 在路由層驗過權限碼。資料庫裡若留著已下架的碼，`ceiling.delete()` 對不存在的碼是空操作，沒有後果。

## 2026-09-29：AI 月額度的寫入與判定路徑，新增三個方案項目

起因是質疑加購直接改寫 `limitOverrides.monthlyTokens` 的做法。做法是靜態追完整條路徑：`plan-change.service.ts` 的核准、`plan-limits.service.ts` 的上限解析、`token-quota.service.ts` 的計數與告警、`llm.service.ts` 的硬擋點，以及 `limitOverrides` 的所有讀寫端。沒有啟動容器。

| 新項目 | 判定依據 |
| --- | --- |
| PLAN-05 | `resolveEffectiveLimit()` 只判斷 key 是否存在，不與方案的 `limits` 比大小；三個換方案入口都只寫 `planId` |
| PLAN-06 | `clearTokenQuotaCache()` 只 `del` 計數器 key；告警旗標另有 key，`checkQuotaThresholdCrossing()` 以 `SET NX` 搶旗標，過期時間是月底 |
| PLAN-07 | 比對 `seedPlans()` 每個方案的 `limits` 鍵與 `LimitKey` 的四個值，`maxChannels` 在每個方案都缺 |

PLAN-07 是另一條線索：整理[方案與功能](../modules/platform/PLANS.md)的「無上限」一節時，發現該節把「刻意設成無上限」與「缺少設定」列成同一組情況，於是逐一驗證每種情況在現有資料上是否成立，查出 `maxChannels` 從來沒有任何方案定義過。該節已改寫成依性質分列，並標出哪幾種是 fail-open。

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

不加對照表的理由值得留存：`apps/api/src/modules` 下的模組只有 18 個使用 `requirePermission`，模組到 feature 的推導對其餘模組沒有依據；而且就算推導得出，寫下「`case` 屬於 `inbox`」會讓讀者以為方案關掉 `inbox` 就停用案件功能，實際上不會。該欄位會把一個不成立的因果關係固化進文件。改為在[平台後台](../modules/platform/README.md)的天花板一節補一句結構性事實：這個交集只在路由呼叫 `requirePermission()` 時計算。

盤點時另外確認三件事，都不另開項目：

- `guards/license.guard.ts` 的 `requireFeature()` 沒有任何呼叫端，而且讀的是 LIC-01 那份寫死的授權資料。feature 層級的閘門從未接上。
- `requireRole()`、`requireAdmin()`、`requireSupervisor()` 也沒有呼叫端。`case.routes.ts` 的 git 歷史查不到曾經使用，因此缺少授權判斷不是切換 guard 時漏掉的。
- 前端 `Sidebar.tsx` 會用 `/auth/me/permissions` 過濾選單，但「收件匣」「工單」「聯繫人」「通知」四個節點沒有 `perm` 欄位。前端隱藏本來就不等於後端擋住，這四項連隱藏都沒有。

## 2026-09-23：平台後台各領域逐檔細查，新增兩個方案項目

起因是把[平台後台](../modules/platform/README.md)的領域文件從一兩句話補成完整說明。過程中逐支服務、逐條路由對照原始碼，發現兩項與方案有關的問題，也修正了三處我自己寫錯的描述。做法是靜態閱讀原始碼與前端頁面，沒有啟動容器。

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
