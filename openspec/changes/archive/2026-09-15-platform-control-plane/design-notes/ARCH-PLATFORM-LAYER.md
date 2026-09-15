# 平台層控制平面 — 架構規劃

> 承接 `SPEC-PLATFORM-LAYER.md`（做什麼），本文件講**架構怎麼搭**：認證邊界、應用落點、資料流、稽核、與既有基礎的接法。
> 依 codebase 實查撰寫——關鍵發現：專案已有 `licenseService`（`apps/api/src/services/license.ts`）的 feature/credits 雛型與 `requireFeature` guard，只是現為「進程級 mock 單例、單一 license」。平台層本質上是把它 **per-tenant 化 + 落 DB + 加控制介面**，而非從零造。

---

## 0. 兩條總綱（先於一切）

### 0.1 定義順序：平台 feature 先定，租戶權限點才對應得上

三層的**定義依賴**是由上而下的，實作與設計都應照此順序，否則會出現「租戶有個權限點卻不屬於任何平台 feature、平台管不到」的破口：

```
(1) 平台層先定義「可控功能單位」= FEATURE registry（inbox/channels/automation/marketing/…）
        │  每個 feature 宣告它涵蓋哪些權限點
        ▼
(2) 租戶層的每個「權限點」都必須歸屬到某一個 feature（無歸屬 = 設定錯誤，啟動驗證擋下）
        ▼
(3) 租戶 RBAC（角色 × 權限點）才在「該租戶 entitlement 開了的 feature」天花板內生效
```

**強制對應（啟動驗證，擴充自 permission-model 的 registry 驗證）**：
- 每個權限點 `code` 必須恰好屬於一個 feature 的 `perms`。
- 反向：feature 宣告涵蓋的 code 必須都存在於權限 registry。
- 任一不符 → 啟動失敗。這保證「平台能控的功能」與「租戶能授的權限」永遠一一對得上，沒有管不到的角落。

→ **落實到 tasks 的順序**：先建 `FEATURE` registry 與「feature↔權限點」對照（並跑此驗證），**再**做租戶 RBAC 的權限指派 UI。RBAC 的 `tasks.md` 第 1.2 條（定義權限點清單）應同時標註每個權限點的所屬 feature。

### 0.2 租戶「不登入」平台層；平台後台是純內部介面

- **平台後台（control plane）只有平台方 superuser 能進**，租戶成員（含租戶 admin）**永遠不會登入到平台層**——沒有給租戶的平台登入入口。這與 §2 的「兩把不同簽發流程」一致：租戶 JWT 永遠簽不出 `PLATFORM_SUPERUSER`。
- 租戶要看的「方案 / 功能 / 用量 / AI key 來源」，一律呈現在**租戶自己的 333 站台內**的一個唯讀自助頁（「方案與用量」），資料由租戶側 API（帶租戶 token）提供，**不觸及平台後台**。
- 也就是：平台方「設定」在 control plane，租戶「檢視 + 有限自助（選 AI key 來源）」在 data plane。兩者物理上不同介面、不同認證，租戶看得到結果、改不到平台設定。

詳見 `SPEC-PLATFORM-TENANT-VIEW.md`（租戶端方案與用量頁）。

---

## 1. 架構分層：控制平面 vs 資料平面

平台層是 **control plane**（管「租戶能用什麼」），租戶層是 **data plane**（跑客服業務）。兩者**同一套 API 進程、同一個 DB，但邏輯與認證嚴格隔離**。

```
                    ┌───────────────────────────────────┐
                    │          apps/api (單一進程)         │
   平台 superuser ──┤  /api/v1/platform/*                │  ← control plane
   (psk_ token)     │    authenticatePlatformSuperuser   │    跨租戶、可破 tenantId 例外
                    │    ─────────────────────────────   │
   租戶 agent ──────┤  /api/v1/*（既有所有模組）           │  ← data plane
   (JWT token)      │    authenticate / requirePermission│    嚴守 tenantId 隔離
                    └───────────────┬───────────────────┘
                                    │
                              ┌─────┴─────┐
                              │ PostgreSQL │  Plan(全域) + Tenant.planId + 各租戶資料
                              └───────────┘
```

**為何不拆成獨立 app / 獨立 DB**：codebase 是集中式 monorepo，`apps/api/src/index.ts` 一行 `app.register` 即掛新模組；獨立 app 會多一份建置/部署/認證成本，收益低。隔離靠「不同認證路徑 + 不同路由前綴 + 不同 guard」達成，已足夠。DB 同庫但 `Plan` 為全域表、平台操作全部經稽核，邊界清楚。

**唯一的跨租戶授權例外**：平台層是 CLAUDE.md「every query must include tenantId」規則的**唯一授權破例處**。比照既有合法跨租戶樣式（`apps/workers/src/handlers/sla.handler.ts` 的全域查詢），但每筆寫入明確帶 `targetTenantId` 且寫稽核；程式碼與 guard 需明確標示「platform-scope, intentionally cross-tenant」避免被誤用成隔離漏洞。

---

## 2. 認證：平台 superuser 是第四條認證路徑

現有 `auth.plugin.ts` 已用 **token 前綴分派** 三條路徑：JWT（一般）、`pk_`（Partner API key）、`cli_`（CLI session）。平台 superuser **照抄此樣式**成第四條：

| 路徑 | token | decorator | 掛到 request.agent |
|---|---|---|---|
| 一般 | JWT | `authenticate` | `{ id, tenantId, role }` |
| Partner | `pk_…` | `authenticateJwtOrPartnerKey` | `{ …, role:'SUPERVISOR', isPartnerKey }` |
| CLI | `cli_…` | `authenticateCliSession` | `{ …, isCliSession, scopes }` |
| **平台（新）** | `psk_…` | **`authenticatePlatformSuperuser`** | `{ platformUserId, role:'PLATFORM_SUPERUSER', tenantId:null }` |

### 為何 superuser 不塞進 Agent 表

`AgentRole` 只有 `ADMIN/SUPERVISOR/AGENT`，全是**租戶內**角色、每個 Agent 綁一個 tenantId。平台 superuser 是**跨租戶、無所屬租戶**的身分，塞進 Agent 表會破壞「Agent 必屬某租戶」的模型，也有讓租戶 admin 誤取得 superuser 的風險。→ **獨立身分表 `PlatformUser`**（見 §3.3）。

### guard

```ts
// 只認 PLATFORM_SUPERUSER，且該路徑的 token 必須是 psk_ 驗證來的
export const requirePlatformSuperuser = () => requireRole(['PLATFORM_SUPERUSER']);
```

沿用既有 `requireRole` factory 模式，但 `PLATFORM_SUPERUSER` 這個 role **只可能由 `psk_` 認證路徑產生**，租戶 JWT 永遠簽不出這個 role（JWT payload 由登入流程固定產 `{agentId,tenantId,role∈租戶三角色}`）。這是隔離的根：**兩種身分來自兩把不同的簽發流程**。

### 安全要求
- `psk_` 金鑰雜湊儲存（比照 Partner key 的 `verifyPartnerApiKey`），不可明碼。
- 平台後台建議額外要求（二階段驗證 / IP allowlist），列為 §7 待定。
- 平台 superuser **不自動獲得任何租戶的 data-plane 權限**——要操作某租戶客服資料須另循正常登入，避免平台方誤動客戶資料。

---

## 3. 資料模型

### 3.1 `Plan`（平台層全域表，**無 tenantId**）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `slug` | string @unique | `free`/`pro`/`enterprise` |
| `name` | string | |
| `features` | Json（string[]）| feature module slug 清單 |
| `limits` | Json | 額度上限（channels 數、maxAgents…），沿用 `licenseService` 現有結構 |
| `isActive` | boolean | 停售軟下架 |

> **本 codebase 首個全域業務表**（現況僅 `Tenant` 全域），schema 需明確註解「platform-global, intentionally no tenantId」。
> `features` + `limits` 的結構**直接搬 `licenseService.initialize()` 現有的 mock 物件**，把「進程級單例」改成「DB 每 plan 一列」。

### 3.2 `Tenant`（既有，新增欄位）

| 欄位 | 變更 | 說明 |
|---|---|---|
| `planId` | 新增 uuid FK → Plan（nullable 過渡）| 所屬方案 |
| `featureOverrides` | 新增 Json | `{ grant:[], revoke:[] }` 單租戶加購/關閉 |

### 3.3 `PlatformUser`（平台方帳號，全域表）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `email` | string @unique | |
| `passwordHash` | string | |
| `name` | string | |
| `isActive` | boolean | |

> 與 Agent 完全分離。登入走獨立的 `/api/v1/platform/auth/login`，簽發 `psk_` 前綴 token（或平台專屬 JWT，payload `{ platformUserId, role:'PLATFORM_SUPERUSER' }`）。

### 3.4 `PlatformAuditLog`（稽核，全域表）

照專案既有「事件記錄」範式 `CaseEvent`（`schema.prisma:673`）的欄位模式，scope 提升到 tenant 級：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `actorId` | uuid | 哪個 PlatformUser |
| `action` | string | `tenant.plan.change` / `tenant.override.set` / `tenant.create` / `tenant.deactivate` |
| `targetTenantId` | uuid? | 被操作的租戶 |
| `payload` | Json | before/after 值 |
| `createdAt` | datetime | |

> 專案無通用稽核表，但 `CaseEvent` 已是「誰對什麼做了什麼」的既定範式。平台操作是最高敏感度，**每筆寫入操作都必記一列**（structured logger 不可查詢，不夠）。

---

## 4. 核心資料流：entitlement 如何夾住租戶權限

這是控制平面「影響」資料平面的唯一管道，也是設計重點。

```
平台改 plan/override
      │
      ├─(1) 寫 Tenant.planId / featureOverrides + PlatformAuditLog
      │
      └─(2) 失效快取 entitlement:tenant:{tenantId}
                │
   租戶下次請求 ─┤
                ▼
   requirePermission(code) guard 內：
     effRole  = RolePermission(roleId) ∪ implies         // 既有
     ceiling  = features→perms( entitlement(tenant) )     // 新：讀 Tenant.plan+override，快取
     有效權限 = effRole ∩ ceiling                          // 交集 → has(code)?
```

- **交集是後端強制**：租戶 admin 勾了但 plan 沒開 → 交集後沒有 → 403。前端隱藏只是體驗。
- **降級不刪資料**：plan 掉級只是 ceiling 縮小，RolePermission 不動，升回來自動恢復。
- **快取兩層**：`perms:role:{roleId}`（既有）+ `entitlement:tenant:{tenantId}`（新）。也可快取交集結果 `eff:{roleId}:{tenantId}`；平台改 plan 時失效 tenant 層即可。
- **接既有 licenseService**：現有 `requireFeature(path)` guard（回 402）改成「依 `request.agent.tenantId` 查該租戶 plan 的 features/limits」，呼叫端不用動——等於把 mock 單例換成 DB per-tenant，順帶讓既有 feature-gate 立即 per-tenant 生效。

---

## 5. 應用落點（最小侵入）

| 層 | 位置 | 做法 |
|---|---|---|
| API routes | `apps/api/src/modules/platform/` | 新模組，比照既有 `modules/*/*.routes.ts` |
| API 註冊 | `apps/api/src/index.ts` | 加一行 `app.register(platformRoutes, { prefix:'/api/v1/platform' })` |
| API 認證 | `apps/api/src/plugins/auth.plugin.ts` | 加 `authenticatePlatformSuperuser` decorator |
| 前端 | `apps/web/src/app/admin/` | **平行於 `dashboard/`** 的新 route group，獨立 layout/AuthProvider |
| license 改造 | `apps/api/src/services/license.ts` | 單例 mock → 依 tenant 查 DB plan |

> 前端**不放進 `dashboard/`**：dashboard layout 綁死租戶 `AuthProvider`/`Sidebar`/`SocketProvider`；平台後台需獨立認證 context 與側欄，開新 route group 各自 gating。

### 5.1 部署與網路層：架在哪（定案 2026-08-18）

**平台層不需要新機器、不需要新 container、不需要新 DB。** 它疊在既有單台部署上（現況：UAT 單台 EC2 + `docker-compose.prod.yml`，8 個 container：postgres/redis/ollama/minio/api/workers/web/nginx）。對照：

| 平台元件 | 跑在哪 | 新基礎設施？ |
|---|---|---|
| 平台 API（`/api/v1/platform/*`）| 併入既有 `api` container（同 Fastify 進程加路由）| ❌ 無 |
| 平台後台前端（`/admin`）| 併入既有 `web` container（Next.js 同 app 加 route group）| ❌ 無 |
| Plan / PlatformUser / PlatformAuditLog / AiUsage / Pricing 等表 | 既有 `postgres`（全域表 + 租戶表同庫）| ❌ 無 |
| entitlement 快取 / token 即時計數器 | 既有 `redis` | ❌ 無 |

隔離不靠「分機器」，靠**認證 + 路由前綴 + guard**（見 §1-2）。部署方式與 IG 那版完全相同（同一套 compose、同一條 deploy workflow）。

**網路入口隔離（定案）：同一域名 + IP allowlist。**
- 租戶站台與平台後台共用同一域名：`app.<host>/` → 租戶站台、`app.<host>/admin` → 平台後台。
- nginx 對 `location /admin` 與 `location /api/v1/platform` 加 **IP allowlist**（`allow <辦公室/VPN IP>; deny all;`），只有平台方網段能連到平台介面；租戶端網段連 `/admin` 直接被 nginx 擋（404/403），連應用層都到不了。
- 這是**縱深防禦**：網路層 IP allowlist（nginx）+ 應用層 `requirePlatformSuperuser` guard（即使 IP 過了仍要平台 JWT）。兩層都要過。
- 現有 `nginx` container 的 conf 加一個 `location` 區塊即可，不新增 server/域名/憑證。

> 若日後平台方 IP 不固定（遠端辦公），可改用平台專屬 VPN 或在 IP allowlist 外加一層平台登入頁的額外驗證（2FA，列第二階段）。

---

## 6. 租戶開通流程（全新，順帶建立）

現況：**沒有 runtime 建立 tenant 的路徑**，唯一來源是 `seed.ts` 的 upsert。所以「開通租戶」本身就是平台層要新建的能力：

```
POST /api/v1/platform/tenants   (superuser)
  → prisma.tenant.create({ name, planId })         // 指派 plan 的時機點
  → 建該租戶的三個 system role + 預設 RolePermission（呼叫 RBAC seed 邏輯）
  → 建租戶第一個 admin agent（或發開通邀請）
  → 寫 PlatformAuditLog: tenant.create
```

- plan 指派自然掛在開通當下；未指定則預設 `free`。
- 這也讓 RBAC 的「每租戶三 system role」有了正式產生時機（不只靠 seed/遷移腳本）。

---

## 7. 待拍板（架構層 Open Questions）

1. **平台 token 用 `psk_` 金鑰 vs 平台專屬 JWT**：金鑰更貼合現有 `pk_`/`cli_` 樣式、可雜湊儲存、易撤銷；JWT 則有到期/refresh 機制。傾向**平台專屬 JWT + 短 TTL**（superuser 是人、要登入 session），但簽發流程與租戶 JWT 完全分離（不同 secret 或不同 issuer claim）。
2. **平台後台是否需 2FA / IP allowlist**：最高敏感度介面，建議至少 IP allowlist，2FA 可第二階段。
3. **feature→權限點對照表放哪**：建議與權限 registry 併存於 `packages/core`，一起啟動驗證（每個 feature 涵蓋的 code 必須存在於權限 registry）。
4. **`limits`（額度）本次做不做**：entitlement 先只做「功能開關」（feature on/off）即可滿足需求；`limits`（channels 數上限、maxAgents）沿用 licenseService 已有結構，可同步或延後。
5. **計費整合**：本設計只做「功能開關」，金流/訂閱另議；`Plan` 可預留 `priceMonthly` 欄位先不接。
6. **降級通知租戶**：plan 掉級/revoke 時通知租戶 admin「某功能已停用」，建議做，避免客戶困惑。

---

## 8. 為何這個架構貼合現有 codebase（逐項依據）

- **認證**：照抄 `auth.plugin.ts` 已有的 token 前綴分派（`pk_`/`cli_`）樣式加第四條，非發明新機制。
- **plan 存 DB + 複用 guard**：`licenseService` 的 features/credits 已是 plan 雛型、`requireFeature` guard 已存在，per-tenant 化即可，呼叫端不動。
- **稽核**：照 `CaseEvent` 既有「事件記錄」範式，scope 升到 tenant。
- **跨租戶操作**：`sla.handler.ts` 已證明「全域查詢 + 逐 row 用自身 tenantId」是專案接受的合法跨租戶樣式，平台層明確標示例外。
- **應用落點**：`index.ts` 集中式一行註冊 + Next.js App Router 開資料夾，皆為既有慣例。
- **全新的部分**：`Plan`/`PlatformUser`/`PlatformAuditLog` 三張全域表、平台認證路徑、`/admin` 前端、tenant 開通流程——這些 codebase 目前完全沒有，是明確的新增項。
