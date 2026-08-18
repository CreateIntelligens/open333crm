# 平台層權限（Tenant Entitlement）設計 — RBAC 三層模型

> 本文件是 `rbac-granular-permissions` 的**上層擴充**：在既有「租戶內 RBAC」之上，加一層「平台方控管每個租戶能用哪些功能」。
> 依三項已定案決策撰寫：(1) Plan + 單租戶 override；(2) 未開功能「顯示但鎖住」引導升級；(3) 平台管理後台頁。

---

## 1. 三層權限模型總覽

```
┌─ 平台層（Platform）──────────────────────────────────────────┐
│ 誰：平台方 superuser（跨租戶身分，非任何租戶的成員）            │
│ 管什麼：每個租戶「買了/能用哪些功能」= Entitlement            │
│ 資料：Plan（Free/Pro/Enterprise）+ 單租戶 override            │
│ 產物：每租戶一組「可用功能集合」= 該租戶的權限天花板            │
└───────────────────────┬──────────────────────────────────────┘
                        │ 天花板（ceiling）——租戶再怎麼開都不能超過
                        ▼
┌─ 租戶層（Tenant）── 既有 RBAC ───────────────────────────────┐
│ 誰：租戶的 super admin（= 該租戶的 admin 角色，持 role.manage）│
│ 管什麼：站內各帳號的角色與權限（在天花板之內勾選）             │
│ 資料：Role / RolePermission（已設計）                         │
└───────────────────────┬──────────────────────────────────────┘
                        │ 指派角色
                        ▼
┌─ 帳號層（Agent）─────────────────────────────────────────────┐
│ 每個成員被指派一個角色 → 得到該角色的權限（且已被天花板夾住）  │
└──────────────────────────────────────────────────────────────┘
```

**一句話**：**有效權限 = (角色被授予的權限) ∩ (租戶 entitlement 天花板)**。兩者取交集——租戶 admin 勾了但平台沒開的功能，實際上用不了。

---

## 2. 核心概念：Entitlement（租戶可用功能）

### 2.1 用「功能模組」當單位，不用權限點

平台層的顆粒度是**功能模組（feature module）**，比權限點粗一層。理由：平台方是「賣方案」，以整塊功能為單位（賣「行銷模組」而非賣「marketing.broadcast」單一動作）；也讓平台後台好管、方案好包裝。

每個 feature module 對應到「一組權限點」。範例對照：

| Feature（平台單位） | 涵蓋的權限點（租戶單位） |
|---|---|
| `inbox`（客服收發）| inbox.* case.* contact.* tag.* |
| `channels`（渠道管理）| channel.* richmenu.* quickreply.* |
| `automation`（自動化）| automation.* canvas.* identity.* |
| `marketing`（行銷群發）| marketing.* |
| `analytics`（分析報表）| analytics.* |
| `knowledge`（知識庫）| knowledge.* |
| `portal`（粉絲活動）| portal.* |
| `sla`（SLA 管理）| sla.* |
| `webhooks`（外部整合）| webhook.* |
| `core`（帳號/角色/設定，必備）| agent.* role.* settings.* — **一律開啟，不可關** |

> `core` 是保底模組（登入、管帳號、管角色、基本設定），永遠在 entitlement 內，否則租戶連 super admin 都無法運作。此對照表與權限 registry 一樣集中在程式碼定義（`FEATURES` registry），單一事實來源。

### 2.2 Plan（方案）

| 欄位 | 說明 |
|---|---|
| `id` / `slug` | `free` / `pro` / `enterprise`（平台層全域，非租戶私有） |
| `name` | 顯示名稱 |
| `features` | 此方案預設含哪些 feature module（string[]） |

Plan 是**平台層全域資料**（不帶 tenantId）——這是本 codebase 第一個真正的全域業務表，設計時明確標示（現有全域表只有 `Tenant` 本身）。

### 2.3 租戶 Entitlement（Plan + override）

每個租戶的實際可用功能 = 所屬 Plan 的 features，再套用該租戶的 override：

```
entitlement(tenant) = (plan.features ∪ tenant.featureOverrides.grant) \ tenant.featureOverrides.revoke ∪ {core}
```

- `grant`：加購——平台額外開給此租戶、超出方案的 feature。
- `revoke`：關閉——平台對此租戶關掉方案內某 feature（如試用到期、違規）。
- `core` 一律併入，永不被 revoke。

---

## 3. 資料模型

### 3.1 `Plan`（平台層全域，**不帶 tenantId**）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `slug` | string @unique | `free`/`pro`/`enterprise`，全域唯一 |
| `name` | string | |
| `features` | string[]（或 Json）| 方案預設 feature module slug 清單 |
| `isActive` | boolean | 停售方案軟下架 |

> 這是全域表，無先例；schema 需在檔案明確註解「平台層全域資料，刻意不帶 tenantId」。

### 3.2 `Tenant`（既有，本次新增欄位）

| 欄位 | 變更 | 說明 |
|---|---|---|
| `planId` | **新增** uuid FK → Plan（nullable，過渡）| 租戶所屬方案 |
| `featureOverrides` | **新增** Json | `{ grant: string[], revoke: string[] }`，單租戶微調 |

> 用 Tenant 上的 `planId` + `featureOverrides` Json，而非另開 `TenantEntitlement` 表——因為「每租戶恰好一組 entitlement」是 1:1，掛在 Tenant 最單純，也符合專案把 license 資訊掛在既有表的既有取向（`Agent.licenseTeamId`）。

### 3.3 平台 superuser 身分

平台管理員是**跨租戶**身分，與租戶內的 ADMIN 是不同層級。兩種實作路徑（見 §7 待定），先定行為：

- 平台 superuser 能進 `/admin/*` 平台後台、可跨租戶讀寫 Plan 與 Tenant entitlement。
- 平台 superuser **不自動擁有任何租戶的站內權限**（除非另循正常登入）——避免平台方誤操作客戶資料。
- 一般租戶成員（含租戶 admin）**絕不可**存取平台後台或改自己的 entitlement。

---

## 4. 兩層如何交互：天花板夾擠（ceiling）

這是整個設計的關鍵。**entitlement 是天花板，RBAC 在天花板之內生效。**

### 4.1 有效權限解析（更新既有 permission-check）

原本（單層）：`有效權限 = RolePermission(role) ∪ implies 閉包`

**新（兩層）**：
```
tenantFeatures = entitlement(tenant)              // 該租戶可用 feature module
tenantPermCeiling = ⋃ featureToPerms(f) for f in tenantFeatures   // 展開成權限點天花板
有效權限 = (RolePermission(role) ∪ implies 閉包) ∩ tenantPermCeiling
```

- 交集在**權限判斷當下**做（guard 內），或在解析有效集合時做。
- 即使 RolePermission 裡有 `marketing.broadcast`，若該租戶 entitlement 沒有 `marketing` feature，交集後就沒有——**API guard 直接 403**。
- 這道交集是**後端強制**，不靠前端隱藏。租戶 admin 手動塞、或舊資料殘留，都被夾掉。

### 4.2 快取

- 既有 `perms:role:{roleId}` 快取「角色權限」不變。
- 新增 `entitlement:tenant:{tenantId}` 快取「租戶天花板權限集合」，TTL ≤10min，租戶 plan/override 變更時主動失效。
- 有效權限 = 兩者交集，可在 guard 內即時算（兩個 Set 交集 O(n)），或快取交集結果 `eff:agent:{roleId}:{tenantId}`。

### 4.3 降級語意（plan 掉級 / revoke）

租戶從 Pro 降 Free、或平台 revoke 某 feature 時：

- **不刪 RolePermission**（角色設定保留）——只是被天花板夾掉，實際用不了。
- 好處：日後租戶再升回來，原本的角色權限設定**自動恢復生效**，不用重設。
- UI 上這些權限變成「🔒 方案未含」狀態（見 §5）。

---

## 5. UI：兩個介面

### 5.1 平台後台 `/admin/tenants`（僅平台 superuser）

```
┌─ 租戶 ─────────────┬─ 設定 ───────────────────────────────┐
│ ● Acme（A）Pro     │ Acme Corp                            │
│ ○ Beta（B）Free    │ 方案  [ Pro ▾ ]                       │
│ ○ Gamma  Enterprise│ ─────────────────────────────────────│
│                    │ 功能模組（方案預設 + 微調）           │
│                    │  ☑ 客服收發   （方案內）              │
│                    │  ☑ 渠道管理   （方案內）              │
│                    │  ☑ 行銷群發   （方案內）              │
│                    │  ☑ 自動化     ＋加購                  │
│                    │  ☐ 粉絲活動   （方案內，已關閉）      │
│                    │  ☑ 分析報表 · ☑ 知識庫               │
│                    │  🔒 帳號/角色/設定（核心，恆開）       │
│                    │ [ 儲存 ]                             │
└────────────────────┴──────────────────────────────────────┘
```

- 左選租戶、右設方案 + 勾功能模組。方案外的勾/取消即形成 override（grant/revoke），UI 標「＋加購」「已關閉」。
- `core` 模組顯示 🔒 恆開、不可取消。
- 顯示每個 feature「涵蓋哪些權限點」的展開說明（次要）。

### 5.2 租戶權限設定頁（既有，本次擴充「顯示但鎖住」）

租戶 super admin 的角色權限頁，在既有基礎上，把**平台未開給本租戶的權限**呈現為鎖定升級態：

- 整個 feature 未開 → 該 group 顯示 🔒 標題 + 「升級 Pro 解鎖」，組內權限點全部 disabled、不可勾。
- hover/說明：「此功能未包含在你目前的方案中，聯絡平台升級以啟用。」
- 已開的 feature → 照既有 RBAC 正常勾選。
- 差異對照：

| 狀態 | 來源 | 呈現 |
|---|---|---|
| 可勾 / 已勾 | entitlement 有 + 你有 role.manage | 正常 checkbox |
| 🔒 方案未含 | entitlement 沒有此 feature | disabled + 升級提示（新增） |
| 🔒 內建鎖定 | admin 核心權限 | disabled + 鎖（既有） |
| 越權 | 超出編輯者自身權限 | disabled（既有） |

> 關鍵：租戶 admin **看得到有這功能存在**（引導升級 upsell），但**點不動**；後端即使被繞過也因天花板交集而 403。

---

## 6. API

### 6.1 平台後台（僅 superuser guard）

| method | path | 說明 |
|---|---|---|
| GET | `/admin/plans` | 方案列表 |
| GET | `/admin/tenants` | 租戶列表（含 plan、override 摘要） |
| GET | `/admin/tenants/:id/entitlement` | 某租戶目前可用 feature + 展開權限天花板 |
| PUT | `/admin/tenants/:id/plan` | 設定租戶方案 |
| PUT | `/admin/tenants/:id/overrides` | 設定加購/關閉（grant/revoke） |

- 全部掛 `requirePlatformSuperuser()` guard（新）——與租戶 RBAC 完全隔離。
- 變更後失效 `entitlement:tenant:{id}` 快取。

### 6.2 租戶側

- `GET /me/permissions` 回傳的已是**交集後**的有效權限（前端無需自己算天花板）。
- 新增 `GET /me/entitlement`：回傳本租戶可用 feature module + 哪些被鎖（供權限頁畫 🔒 升級態）。

---

## 7. 待拍板（平台層 Open Questions）

- **平台 superuser 怎麼實作**：(a) `Agent.isPlatformSuperuser` 布林 + 特殊租戶；(b) 獨立 `PlatformUser` 表（與 Agent 分離，最乾淨但工較多）；(c) 特殊保留 tenantId 的平台租戶。傾向 (b) 長遠最清楚，(a) 最快上線。
- **Plan 是否需要計費整合**（金流/訂閱週期）——本設計只做「功能開關」，計費另議；`Plan` 可預留 `priceMonthly` 等欄位但先不接金流。
- **feature → 權限點對照表**由誰維護、放哪：建議與權限 registry 併存於 `packages/core`，一起被啟動驗證（每個 feature 涵蓋的 code 必須都存在於權限 registry）。
- **override Json vs 正規表**：先用 Tenant.featureOverrides Json（簡單）；若日後要查詢「哪些租戶加購了 automation」很頻繁，再正規化為 `TenantFeatureOverride` 表。
- **降級通知**：plan 掉級 / revoke 時是否通知租戶 admin「某功能已停用」——建議做，避免客戶困惑。

---

## 8. 與既有多租戶架構的一致性

- `Plan` 是**刻意的全域表**（無 tenantId），schema 需明確註解——這是本 codebase 首個全域業務表（現況僅 `Tenant` 全域）。
- `Tenant.planId` / `featureOverrides` 掛在既有 Tenant 表，符合專案把 license 掛既有表的取向。
- entitlement 快取 key 用 `tenantId`（`entitlement:tenant:{tenantId}`），租戶隔離天然乾淨。
- 平台後台所有寫入仍以「路徑 param 的 tenantId」操作，但**授權靠 superuser guard**（而非 request.agent.tenantId）——這是唯一「合法跨租戶」的介面，需嚴格 guard 且審計記錄（platform audit log 建議一併做）。
- 租戶側一切照既有鐵律：tenantId 來自 token、RolePermission 靠 Role 間接隔離、停用租戶登入時已擋。
