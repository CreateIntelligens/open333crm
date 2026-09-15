## Context

多租戶隔離目前是**純 app-layer**：CLAUDE.md 規定「every query must include `tenantId` in the where clause」，`scripts/check-tenant-scoping.mjs`（`--strict` 進 CI）靜態掃描 `apps/api/src` 抓漏帶。此設計的根本弱點：

- 漏一次即洩漏。`updateMany`/`deleteMany` 漏帶 `tenantId` = 跨租戶寫入/刪除（critical）。
- 靜態掃描只能抓**已知模式**，對 `where` 用外部變數、動態組 where、raw SQL、以及未來新增的 query 無法保證覆蓋（腳本本身把這類降級為 `NEEDS_REVIEW`）。
- 它是**偵測**，不是**強制**。

RLS 把隔離下沉到 DB：即使 app 漏帶 `tenantId`，Postgres 也只讓當前 session 綁定的租戶看到/改到自己的列。這是 SaaS 化前的根本性強化。

### 現況（讀碼確認）

- **Prisma 6.x**（`@prisma/client ^6.0.0`）——支援 Client Extensions (`$extends`) 與互動式 `$transaction(async (tx) => …)`。
- **API 連線**：`apps/api/src/plugins/prisma.plugin.ts` 建立**單一共享** `PrismaClient` 並 `fastify.decorate('prisma', prisma)`。所有請求共用同一個連線池 → **連線會跨請求/跨租戶複用**（本 change 最高風險的來源）。
- **Workers 連線**：`apps/workers/src/index.ts` `new PrismaClient()`，同樣單一共享池。
- **連線設定**：`DATABASE_URL` 直連 Postgres（`schema.prisma` datasource `url = env("DATABASE_URL")`，含 pgvector extension）。**未見 PgBouncer / DIRECT_URL / connection_limit**——即 Prisma 自帶連線池、直連 DB。
- **租戶身分來源**：JWT → `request.agent.tenantId`（`auth.plugin.ts`）。Workers 從 job payload 拿 `tenantId`（`automation-facts.ts`、`notification.handler.ts` 等）。
- **租戶表**：`check-tenant-scoping.mjs` 的 `TENANT_MODELS` 列 41 個（Prisma camelCase）。schema 內有 130 處 `tenantId`。
- **合法跨租戶（白名單，`WHITELIST_FILES`）**：`modules/platform/*`、`auth.service`（email 全域查 agent）、`partner-api-key`（by keyPrefix）、`auth.plugin`、`*.scheduler.*`、`platform-tenant.service`（建租戶時還沒 tenantId）、`chatbox.service`（by publicKey）、`modules/trial/*`（gmail 去重）、`inbound-router`。這些在 RLS 下 MUST 走 bypass 連線。

## Goals / Non-Goals

**Goals:**
- 41 張租戶表 + 同期 `add-tenant-audit-gdpr` 新增租戶表，全部 DB 層強制隔離（`ENABLE` + `FORCE ROW LEVEL SECURITY`）。
- 一個**絕對安全**的 session 變數注入機制，杜絕連線池殘留 → 間歇性跨租戶洩漏。
- 合法跨租戶查詢（白名單）不被誤擋，走明確的 bypass 路徑。
- 分階段、可觀察、可秒級回滾的上線流程。
- 對真實 DB 的隔離驗證（正向：讀不到別租戶；負向：合法查詢不被擋）。
- app-layer 既有防線（每 query 帶 tenantId + `check-tenant-scoping.mjs --strict`）**保留**——縱深防禦。

**Non-Goals:**
- 不移除 app-layer 的 tenantId 帶入或靜態檢查（RLS 是後盾，非替代）。
- 不引入 PgBouncer（現況直連 Prisma 池；若日後改用 PgBouncer，session 變數策略需重新評估，見「風險」）。
- 不改任何業務欄位、不改 Prisma model 結構（只加 RLS SQL）。
- 不做 column-level security、不做加密。
- 不重寫既有 service 的 query（RLS 是透明層；service 仍照常帶 tenantId，兩層並存）。

## Decisions

### 1. RLS policy 機制：FORCE RLS + session 變數 `app.current_tenant`

每張租戶表：

```sql
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE  ROW LEVEL SECURITY;   -- 連表 owner 也受約束（app-tenant role 若剛好是 owner 才需要；保險起見一律 FORCE）

CREATE POLICY tenant_isolation ON "Contact"
  USING      ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);
```

- **`USING`** 管讀取與 UPDATE/DELETE 的**可見列**；**`WITH CHECK`** 管 INSERT/UPDATE 寫入的列**新值**必須屬於當前租戶（防止把資料寫成別租戶的 tenantId）。兩者都要。
- **`current_setting('app.current_tenant', true)`**：第二參數 `true` = missing_ok，session 變數未設時回 `NULL` 而非報錯。`NULL::uuid` 與任何 tenantId 比較為 `NULL`（非 true）→ **未設租戶時看不到任何列**（fail-closed，安全預設）。這正是我們要的：忘了設 session 變數 → 查不到資料（很吵、會被立刻發現），而不是看到全部。
- **`FORCE ROW LEVEL SECURITY`**：預設 RLS 對「表 owner」不生效。app-tenant role 不該是 owner，但為避免誤用一律加 FORCE。
- 欄位名：Prisma 預設把 `tenantId` 對到 DB 欄位 `tenantId`（除非 `@map`）——migration SQL MUST 用**實際 DB 欄位名**（讀 migration/schema 確認是 `"tenantId"` 還是 `tenant_id`，本 change 任務要先核對，勿假設）。

### 2. 連線池核心風險與注入機制（本 change 的心臟）

**風險陳述**：Prisma 單一共享池跨請求複用連線。若用 `SET app.current_tenant = 'A'`（session 級、非交易級），該值會**殘留在該連線上**；連線歸還池、下一個請求（可能是租戶 B）拿到同一條連線 → 若忘了重設就**讀到 A 租戶的資料**。這是最危險的失敗模式：**間歇性、與併發/池狀態相關、幾乎無法在單元測試重現**。

**方案比較：**

| 方案 | 機制 | 殘留風險 | 併發安全 | 取捨 |
|---|---|---|---|---|
| **A. 交易內 `SET LOCAL`（採用）** | 每個租戶操作包在 `$transaction`，內部第一句 `SET LOCAL app.current_tenant = $1`，之後所有 query 在同交易內執行 | **零**——`SET LOCAL` 只在該交易有效，`COMMIT`/`ROLLBACK` 自動失效，不可能殘留到下個請求 | 安全——交易獨佔連線期間值固定 | 所有租戶 query MUST 在交易內；跨多 query 的請求自然形成一個交易（多數本就該如此） |
| B. `SET`（session 級）+ 歸還時 `RESET` | query 前 `SET`，用完 `RESET` | 高——只要有一條 `RESET` 漏了/例外中斷/連線被別的 await 搶用，就殘留 | 危險——同一連線被 async 交錯使用時值會串 | 依賴「一定會 RESET」的紀律，正是我們要消滅的失敗模式 → 不採用 |
| C. Prisma Extension 每 query 前設 tenant | `$extends` 攔截每個操作，前面塞 SET | 若用 session 級 SET 等同 B；若每 query 都開交易則效能差且巢狀交易複雜 | 視實作 | 單一 query 也被迫開交易；且 Prisma extension 對同一邏輯操作的多個底層 query 不保證同連線 → 不採用為主機制 |

**決策：採用 A（交易內 `SET LOCAL`）。** 這是唯一「連線歸還時不可能殘留」的方案——安全性來自 Postgres `SET LOCAL` 的交易語意，不依賴應用程式紀律。

**Prisma 6 具體實作**（設計層，實作細節留 tasks）：

- 提供一個 helper，例如 `withTenant(prisma, tenantId, fn)`：
  ```ts
  function withTenant<T>(prisma: PrismaClient, tenantId: string, fn: (tx) => Promise<T>) {
    return prisma.$transaction(async (tx) => {
      // 用參數化 setter 防注入；SET LOCAL 不吃 $1 佔位，改用 set_config
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;  // true = is_local
      return fn(tx);
    });
  }
  ```
  - **`set_config(name, value, is_local=true)`** 等同 `SET LOCAL`，但**能參數化**（`SET LOCAL` 的值不能用佔位符）→ 用 `$executeRaw` 的 tagged template 傳 `${tenantId}` 走參數化，杜絕 SQL 注入。tenantId 進 helper 前 MUST 驗證是合法 UUID（雙保險）。
  - `fn` 內的所有 query MUST 用傳入的 `tx`（同一交易 = 同一連線 = session 變數有效）。用外層 `prisma` 而非 `tx` 會落到別的連線、session 變數為 NULL → fail-closed 讀不到資料（會立刻被測出來，這是好事）。
- **API 接線**：`prisma.plugin.ts` 額外提供 request-scoped 的 tenant-bound client。首選以 `$extends` 包一層，讓 request handler 拿到的 `prisma` 自動在交易內綁定 `request.agent.tenantId`；或提供 `request.tenantPrisma`。實作方式在 tasks 決定，但**契約固定**：帶租戶身分的請求，其所有租戶表操作都經過「交易內 set_config」。
- **Workers 接線**：每個 job handler 依 `payload.tenantId` 呼叫 `withTenant`。

### 3. Bypass 路徑：合法跨租戶用獨立 role/連線

RLS 對「login 用 email 全域查 agent」「平台層跨租戶統計」「scheduler 掃全租戶」「trial gmail 去重」「chatbox by publicKey」「inbound-router」「RLS migration 本身」等**必須跨租戶**的操作是誤擋——這些正是 `check-tenant-scoping.mjs` 的 `WHITELIST_FILES`。

**決策：新增一個 `BYPASSRLS` 的 DB role + 對應的第二條連線（`DATABASE_URL_ADMIN`）。**

```sql
CREATE ROLE app_tenant   LOGIN PASSWORD '...';   -- 一般請求，受 RLS 約束（NOBYPASSRLS 為預設）
CREATE ROLE app_admin     LOGIN PASSWORD '...' BYPASSRLS;  -- 白名單/migration/scheduler
GRANT app_tenant, app_admin ...;  -- 對 41 表的 SELECT/INSERT/UPDATE/DELETE
```

- `DATABASE_URL`（app_tenant）：`prisma.plugin.ts` 主 client 用它——**受 RLS 約束**。
- `DATABASE_URL_ADMIN`（app_admin，`BYPASSRLS`）：第二個 `PrismaClient` 實例，只給白名單服務用（`fastify.decorate('prismaAdmin', ...)` 或明確 import）。
- **為何用兩個連線/role 而非「app 端旗標」**：`BYPASSRLS` 是 DB 強制的——bypass 能力綁在 DB role 上，app 無法「不小心」繞過 RLS（要繞必須明確拿 admin client）。這比「傳個 `skipRls: true` 參數」安全得多。
- **收斂 bypass 範圍**：admin client 只在白名單檔案 import。可加 CI 檢查「非白名單檔案不得 import prismaAdmin」（比照現有 `check-tenant-scoping.mjs` 的思路），避免 bypass 擴散。
- **scheduler 的細節**：scheduler 掃全租戶後，若要對**單一租戶**做寫入，仍應在該租戶的 `withTenant` 交易內做（先用 admin 找出租戶清單，再逐租戶用 app_tenant 綁定操作），而非全程 bypass——縮小 bypass 面積。
- **`current_setting` 缺省的一致性**：admin role bypass RLS，即使沒設 `app.current_tenant` 也能跨租戶；app_tenant role 沒設就 fail-closed。兩者行為明確分離。

### 4. Migration 策略：分階段、可觀察、非破壞、可回滾

41 表一次 FORCE 是「行為變更」的大 migration。若 app 端注入機制有任何一表沒接好，該表所有租戶 query 會突然回空 → 生產事故。策略：

**階段 0（前置，不動 DB 行為）**：先完成 app 端注入機制（`withTenant` + API/worker 接線），部署並確認一切照舊（此時 RLS 還沒開，session 變數設了也無作用，不影響現況）。

**階段 1（ENABLE，permissive 觀察）**：
- 對 41 表 `ENABLE ROW LEVEL SECURITY` 但**先建 permissive policy**（例如 policy `USING (true)`，或先只 ENABLE 不 FORCE 且 owner 連線）——讓 RLS 機制就位但暫不真正限制。
- 更穩妥的觀察法：加一條 log/監控，統計「session 變數為 NULL 時觸及租戶表」的情況（代表某條路徑沒接上注入），在**不阻擋**的前提下先抓漏。
- 觀察數日確認：app_tenant 連線的所有正常流量都有正確設 `app.current_tenant`、白名單流量都走 admin。

**階段 2（FORCE，真正 enforce）**：
- 換上真正的 `USING (tenantId = current_setting(...))` policy + `FORCE ROW LEVEL SECURITY`。
- **可分批**：先對「讀多寫少、洩漏影響大」的核心表（contact/conversation/case/message 相關）enforce，驗證後再擴到其餘。分批降低單次 blast radius。

**非破壞性**：RLS SQL 不改欄位、不改資料；rollback 只需 `DISABLE ROW LEVEL SECURITY` 或 drop policy。migration MUST 是正式 Prisma migration 檔（CLAUDE.md 規則；`prisma migrate deploy` 在 entrypoint 跑）。因 Prisma 不管理 RLS，用 `prisma migrate dev --create-only` 產空 migration 再手寫 SQL。

### 5. 回滾預案

- **秒級軟回滾**：把 app_tenant 連線暫時指到 `app_admin`（BYPASSRLS）→ RLS 立即失效、恢復純 app-layer 隔離（app-layer 仍在，不裸奔）。這是**不需改 DB、不需重部署 migration** 的第一手段（改 env 重啟）。
- **DB 層回滾**：`ALTER TABLE ... DISABLE ROW LEVEL SECURITY;`（逐表）或 `DROP POLICY tenant_isolation ON ...;`。準備好 down migration。
- **判斷訊號**：出現「某租戶大量查詢突然回空」「合法跨租戶功能報錯（登入/平台/scheduler）」即回滾。
- 因 app-layer 隔離全程保留，回滾到「無 RLS」不會造成裸奔的跨租戶洩漏（回到 change 前的狀態）。

### 6. 與 `add-tenant-audit-gdpr` 的協調

同期 `add-tenant-audit-gdpr` 會新增租戶表（稽核/GDPR 相關）。這些新表 MUST 一併納入 RLS 覆蓋清單。協調方式：本 change 的 RLS 覆蓋清單以「所有含 `tenantId` 的表」為準（不是寫死 41），並在 tasks 明列「檢查 audit-gdpr 新表是否已加 RLS」。若 audit-gdpr 先落地，其 migration 應直接帶 RLS SQL（或本 change 補上）。避免新表漏開 RLS = 新的洩漏面。

## Risks / Trade-offs

- **[最高] 連線池殘留**：已用「交易內 `SET LOCAL`/`set_config(is_local=true)`」從機制上消除（安全性來自 Postgres 交易語意，非應用紀律）。殘留剩餘風險 = 有人繞過 `withTenant` 直接用外層 `prisma` 跑租戶 query——此時 session 變數為 NULL → **fail-closed 讀不到資料**，會被整合測試/QA 立刻發現，不會靜默洩漏。
- **fail-closed 造成「查不到資料」類 bug**：漏接注入的路徑會回空而非報錯，可能被誤判為業務 bug。緩解：階段 1 的 NULL-tenant 觸及監控；整合測試覆蓋主要讀寫路徑；上線初期加告警。
- **效能**：所有租戶操作強制包交易，多一次 `set_config` round-trip。多數請求本就有多個 query、包交易影響小；純單 query 的熱路徑需量測。policy 的 `current_setting` 比較極輕量。
- **未來引入 PgBouncer 的相容性**：`SET LOCAL` 在 PgBouncer **transaction 模式**下安全（交易獨佔連線）；但 **session 模式**或誤用 statement 模式會破壞假設。現況無 PgBouncer；若日後加，MUST 用 transaction pooling 且重新驗證。此限制寫進 spec 與部署文件。
- **raw SQL 繞過**：`$queryRaw`/`$executeRaw` 若不在 `withTenant` 交易內，同樣 fail-closed（app_tenant role）或 bypass（admin role）。需檢查既有 raw 用法（目前 apps 內幾無真實 raw query，多在測試）。
- **admin 連線擴散**：bypass 能力若被非白名單濫用 = RLS 形同虛設。緩解：admin client 集中、CI 檢查限制 import 範圍、code review 盯。
- **migration 覆蓋遺漏**：漏一張租戶表沒開 RLS = 該表仍純靠 app-layer。緩解：以「掃 schema 找所有帶 tenantId 的表」動態比對覆蓋清單，CI 檢查「有 tenantId 的表都有 RLS policy」。
- **測試環境成本**：RLS 行為只能對真實 Postgres 測（mock 測不出）。CI 需起帶 RLS role 的 Postgres 容器跑整合測試。

## Open Questions

- DB 欄位實際名稱是 `"tenantId"` 還是 `tenant_id`？（Prisma 預設不 snake_case，但需讀 migration 確認再寫 policy SQL。）
- API 注入首選 `$extends` 包成 request-scoped client，還是顯式 `request.tenantPrisma` helper？兩者都滿足契約，取實作簡潔者（tasks 階段決定並驗證 Prisma 6 extension 對交易的行為）。
- 是否要為 admin client 加「非白名單 import 就 CI fail」的檢查（強烈建議，避免 bypass 擴散），或先靠 code review？
