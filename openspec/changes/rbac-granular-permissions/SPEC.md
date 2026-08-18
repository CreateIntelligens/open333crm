# 角色權限升級 規格書（RBAC Granular Permissions）

> 版本：v1 草案　│　對應 OpenSpec change：`rbac-granular-permissions`
> 本文件為「可通讀的整合規格」，供人審閱與開發參照。機器可驗證的行為契約以 `specs/**/spec.md` 為準；本文件與其一致，若有衝突以 spec 檔為準。

---

## 1. 概述與目標

### 1.1 背景

現行權限是「寫死在程式碼裡的三層角色階層」（`ADMIN > SUPERVISOR > AGENT`），每條路由掛 `requireAdmin()` / `requireSupervisor()`。缺點：任何權限調整都要改程式碼重新部署、無法新增自訂角色、前端不依角色隱藏入口。

盤點現行程式碼還發現數個**權限缺口與不一致**（詳見 §8），本次升級一併收斂。

### 1.2 目標

- 權限模型由 **role-based（角色白名單）** 升級為 **permission-based（權限點 + 角色權限對應）**。
- Admin 可在後台針對角色勾選權限、新增/刪除自訂角色，**不需改碼部署**。
- 建立「新增功能 → 開權限」的固定 SOP，並用啟動/CI 斷言防漏。
- 用 `dependsOn` / `group` / `implies` 三機制清楚區分功能關聯。
- 前端側邊選單與按鈕依權限動態顯示。
- 資料遷移**零權限中斷**：三角色轉為三 system role，種入完全覆蓋現行能力的預設權限。

### 1.3 範圍界定（Non-Goals）

- 不做資料列層級 / 欄位層級權限（如「只能看自己負責的工單」）——本次僅做功能操作權限；既有租戶隔離與 assignee 邏輯不變。
- 不做權限審批流程。
- 不合併 CLI token / PartnerApiKey 的 `scopes`（那是 M2M API scope，另一套系統）。
- 不引入新 UI 元件庫；沿用既有自製元件與 Tailwind 語意 token。

### 1.4 名詞

| 名詞 | 說明 |
|---|---|
| 權限點 Permission | 一個可授予的操作能力，命名 `resource.action`，如 `channel.create` |
| 角色 Role | 一組權限的集合；分 system role（內建三個）與 custom role（自訂） |
| RolePermission | 角色擁有哪些權限點的對應（存 DB） |
| 有效權限集合 | 某 agent 實際可用的權限 = 其角色的 RolePermission ∪ implies 遞迴補齊 |

---

## 2. 資料模型

權限點清單本身**定義在程式碼 registry，不存 DB**（見 §3）。DB 只存角色與角色↔權限對應。

### 2.1 `Role`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid FK | 租戶隔離；每租戶各一套角色 |
| `slug` | string | 角色識別；system role 固定 `admin`/`supervisor`/`agent`，同租戶內唯一，system role 不可改 |
| `name` | string | 顯示名稱（可改，含 custom role） |
| `isSystem` | boolean | true = 內建角色，不可刪、slug 不可改 |
| `createdAt` / `updatedAt` | datetime | |

- 唯一約束：`(tenantId, slug)`。
- 每租戶必存在三個 `isSystem = true` 的角色。

### 2.2 `RolePermission`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `roleId` | uuid FK → Role（`onDelete: Cascade`） | 隨所屬 Role 一起刪除 |
| `permissionCode` | string | 對應 registry 的 `code`（不設 DB FK，registry 是程式碼；寫入時驗證 code 存在） |
| `createdAt` | datetime | |

- 唯一約束：`(roleId, permissionCode)`。
- 只存「明確授予」的權限點；`implies` 補齊的權限**不寫入此表**（執行期解析時才加）。

#### 租戶隔離（比照專案 join 表慣例，如 `CaseTag`）

`RolePermission` **本身不帶 `tenantId` 欄位**，租戶隔離**間接**來自它所屬的 `Role.tenantId`。這與專案既有的 `CaseTag`/`ContactTag`（靠父物件隔離）一致。**但這代表 service 層有一道不可省略的鐵律：**

> **任何對 `RolePermission` 的讀寫，都必須先經過「帶 `tenantId` 的 `Role` 擁有權檢查」。**
> 絕不可直接用外部傳入的 `roleId` 去 `rolePermission.findMany/createMany/deleteMany`，否則 A 租戶可改到 B 租戶的角色權限（跨租戶越權）。

正確樣式（兩步式，比照 `channel.service.ts` 的 `updateChannel`）：

```ts
// 1) 先用 tenantId 驗證這個 role 屬於當前租戶，找不到就 404
const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
if (!role) throw new AppError('Role not found', 'NOT_FOUND', 404);

// 2) 通過後才對 RolePermission 用 roleId 操作（此時 roleId 已確認屬本租戶）
await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
await prisma.rolePermission.createMany({ data: codes.map(c => ({ roleId: role.id, permissionCode: c })) });
```

- `tenantId` 一律取自 `request.agent.tenantId`（JWT），**絕不從 body/query 讀**。
- `onDelete: Cascade`：刪除 Role 時其 RolePermission 自動清除，不留孤兒列。
- Redis 快取 key 用**全域唯一的 `roleId`**（`perms:role:{roleId}`），不以 `tenantId+slug` 組 key——roleId 是 uuid、天然跨租戶不撞，避免日後有人改成含 slug 的 key 反而製造隔離風險。

### 2.3 `Agent`（既有，本次變更）

| 欄位 | 變更 | 說明 |
|---|---|---|
| `roleId` | **新增** uuid FK → Role | 取代 enum；過渡期 nullable |
| `role`（enum）| **保留一版後移除** | 過渡期雙寫，最終刪除 |

### 2.4 遷移對映

`Agent.role` enum → 對應 system role 的 `roleId`：`ADMIN→admin`、`SUPERVISOR→supervisor`、`AGENT→agent`。

---

## 3. 權限點 Registry

### 3.1 定義位置與結構

集中在單一 in-code registry（如 `packages/core` 或 `apps/api/src/rbac/permissions.registry.ts`），是全系統唯一事實來源。每筆：

```ts
{
  code: 'channel.create',          // resource.action，全域唯一
  group: 'channel-management',      // 功能分群
  label: '新增渠道',                // 使用者語言
  description: '建立新的訊息渠道',
  dependsOn?: ['channel.view'],     // 同功能前置（進 DB、UI 顯示、勾選連動）
  implies?: ['agent.view'],         // 跨模組隱含（不進 DB、解析時補、UI 唯讀說明）
}
```

### 3.2 命名規範

- 格式 `resource.action`，resource 用 lowercase kebab-case。
- action 用 CRUD 動詞（`view` / `create` / `update` / `delete`）或明確能力動詞（`assign` / `export` / `send` / `manage` / `publish` 等）。
- code 全域唯一。

### 3.3 完整性驗證（啟動 + CI）

以下任一情況**啟動即失敗**：

1. 重複 `code`。
2. `dependsOn` / `implies` 指向不存在的 code。
3. `implies` 圖有環。
4. 同一對同時出現在某權限的 `dependsOn` 與 `implies`。
5. **路由一致性**：任何 `requirePermission('x')` 的 `x` 不在 registry。← 防「加功能漏開權限」的守門。

### 3.4 三種關聯機制的區分

| 機制 | 欄位 | 解決 | 是否進 DB / UI | 生效時機 |
|---|---|---|---|---|
| 相依 | `dependsOn` | 同功能前後序（不看就不能改） | ✅ 進 DB、UI 顯示、勾選連動 | 勾選當下 + 寫入驗證 |
| 分群 | `group` | UI 分區、整組開關 | 純標籤，不影響授權 | 顯示 / 批次 |
| 隱含 | `implies` | 跨模組實作耦合（用到別模組唯讀資料） | ❌ 不進 DB、UI 唯讀說明 | 權限解析時自動補 |

**dependsOn vs implies 判準**：使用者需要理解並自行管理的前後序 → `dependsOn`；純實作耦合、使用者不該操心的 → `implies`。

---

## 4. 權限點完整清單

> 依據現行路由 guard 盤點（§8 附盤點缺口）。`group` 用使用者語言。預設歸屬見 §5。
> 標 ⚠ 者為「現行登入即可、本次建議收緊」的權限點，預設歸屬會給到 AGENT 以維持零中斷，但已具備日後收緊的開關。

### 4.1 群組：客服作業（`inbox`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `inbox.view` | 檢視對話 | — | — | 對話列表與訊息 |
| `inbox.reply` | 回覆對話 | `inbox.view` | — | 送訊息、圖片、影片、typing |
| `inbox.manage` | 管理對話 | `inbox.view` | `tag.view` | 改對話狀態、close、handoff、加移標籤 |

### 4.2 群組：案件（`case`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `case.view` | 檢視案件 | — | — | 列表、詳情、事件、統計 |
| `case.create` | 建立案件 | `case.view` | — | 由對話開案或直接建案 |
| `case.update` | 編輯案件 | `case.view` | — | 改欄位、加註記、標籤、resolve/close/reopen |
| `case.assign` | 指派案件 | `case.view` | `agent.view` | 派工／改派（需讀人員清單） |
| `case.escalate` | 升級案件 | `case.view` | — | 升級 |
| `case.delete` ⚠ | 刪除案件 | `case.view` | — | 現行登入即可，建議收緊 |

### 4.3 群組：聯絡人（`contact`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `contact.view` | 檢視聯絡人 | — | — | 列表、詳情、timeline |
| `contact.update` | 編輯聯絡人 | `contact.view` | `tag.view` | 改欄位、加移標籤 |
| `contact.merge` ⚠ | 合併聯絡人 | `contact.view` | — | 現行登入即可，建議收緊 |

### 4.4 群組：標籤（`tag`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `tag.view` | 檢視標籤 | — | — | |
| `tag.manage` ⚠ | 管理標籤 | `tag.view` | — | 建/改/刪標籤；現行登入即可 |

### 4.5 群組：知識庫（`knowledge`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `knowledge.view` | 檢視知識庫 | — | — | 列表、來源、分類、搜尋、feedback |
| `knowledge.manage` ⚠ | 管理知識庫 | `knowledge.view` | — | 建/改/刪文章、publish/archive、import/upload/embed；現行登入即可 |
| `knowledge.admin` | 知識庫進階 | `knowledge.view` | — | partner-ingest、models/refresh、feedback resolve（現行 SUPERVISOR） |

### 4.6 群組：自動化（`automation`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `automation.view` | 檢視自動化 | — | — | 規則列表、詳情、logs、test |
| `automation.manage` | 管理自動化 | `automation.view` | `channel.view` | 建/改/刪規則（設定時常需選觸發渠道） |
| `canvas.use` | 使用自動化畫布 | — | — | canvas CRUD/activate/trigger（現行登入即可） |
| `identity.review` | 審核識別建議 | `contact.view` | — | identity suggestions approve/reject（現行登入即可） |

### 4.7 群組：渠道管理（`channel-management`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `channel.view` | 檢視渠道 | — | — | 列表、詳情、status、embed-code |
| `channel.create` | 新增渠道 | `channel.view` | — | |
| `channel.update` | 編輯渠道 | `channel.view` | — | 改設定、setup-webhook、verify |
| `channel.delete` | 刪除渠道 | `channel.view` | — | |
| `richmenu.manage` | 管理圖文選單 | `channel.view` | — | LINE rich-menu CRUD/publish（現行 SUPERVISOR） |
| `quickreply.manage` | 管理快速回覆 | — | — | quick-reply-preset 寫入（現行 SUPERVISOR） |

### 4.8 群組：行銷（`marketing`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `marketing.view` | 檢視行銷 | — | — | 名單、活動、群發、素材、模板 |
| `marketing.manage` | 管理行銷 | `marketing.view` | `contact.view` | 建/改/刪 名單/活動/素材（名單條件需讀聯絡人欄位） |
| `marketing.broadcast` | 執行群發 | `marketing.view` | `channel.view` | broadcast send/cancel（實際發送） |

### 4.9 群組：分析報表（`analytics`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `analytics.view` | 檢視報表 | — | — | overview、各維度報表 |
| `analytics.view.self` | 檢視個人數據 | — | — | 只看自己的數據（`/analytics/my`）；收斂 §8-3 缺口 |
| `analytics.export` | 匯出報表 | `analytics.view` | — | POST /export |

### 4.10 群組：短連結（`shortlink`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `shortlink.view` | 檢視短連結 | — | — | 列表、stats、clicks、qrcode |
| `shortlink.manage` ⚠ | 管理短連結 | `shortlink.view` | — | 建/改/刪；現行登入即可 |

### 4.11 群組：粉絲活動（`portal`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `portal.view` | 檢視粉絲活動 | — | — | 活動、submissions、點數（現行 ADMIN） |
| `portal.manage` | 管理粉絲活動 | `portal.view` | — | 建/改/刪、publish/end、抽獎、點數調整 |

### 4.12 群組：系統設定（`system-settings`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `settings.manage` | 系統設定 | — | — | office-hours、tracking、embedding、chat、api-keys、cli-sessions（現行 SUPERVISOR） |
| `sla.manage` | SLA 政策 | — | — | SLA CRUD（現行 SUPERVISOR） |
| `webhook.view` | 檢視 Webhook 訂閱 | — | — | outbound webhook 列表/deliveries |
| `webhook.manage` | 管理 Webhook 訂閱 | `webhook.view` | — | 建/改/刪、test（收斂 §8-2 不一致） |

### 4.13 群組：人員與權限（`admin`）

| code | 名稱 | dependsOn | implies | 說明 |
|---|---|---|---|---|
| `agent.view` | 檢視成員 | — | — | 成員列表 |
| `agent.manage` | 管理成員 🔒 | `agent.view` | — | 建立/編輯成員（admin 角色鎖定核心） |
| `agent.role.assign` | 指派角色 | `agent.view` | `role.view` | 指派角色給成員（受越權防護，取代舊 inline 規則） |
| `agent.password.reset` | 重設他人密碼 | `agent.view` | — | 現行 ADMIN |
| `agent.delete` | 刪除成員 | `agent.view` | — | 現行 ADMIN |
| `role.view` | 檢視角色權限 | — | — | 開啟角色權限設定頁 |
| `role.manage` | 管理角色權限 🔒 | `role.view` | — | 角色 CRUD、RolePermission 指派（admin 角色鎖定核心，防自鎖） |

🔒 = `admin` system role 鎖定核心權限，不可移除（至少 `agent.manage`、`role.manage`）。

> **個人 vs 全域資料的說明**：本清單為「功能操作權限」。「只能操作自己負責的對話/案件」屬資料範圍（data scoping），本次不納入；`analytics.view.self` 是唯一以權限點區分「個人/全域」的特例，因現行 `/analytics/my` 被誤擋。

---

## 5. 角色預設權限對照表

> 遷移零中斷原則：三 system role 種入的預設權限 = 現行三角色實際能做的事。標 ⚠ 的高風險權限雖現行 AGENT 可用，仍**預設給 AGENT** 以維持零中斷，上線後由 Admin 決定是否收緊。

| 權限點 | admin | supervisor | agent | 現行對應 |
|---|:---:|:---:|:---:|---|
| inbox.view / inbox.reply / inbox.manage | ✔ | ✔ | ✔ | 登入即可 |
| case.view / create / update / assign / escalate | ✔ | ✔ | ✔ | 登入即可 |
| case.delete ⚠ | ✔ | ✔ | ✔ | 登入即可（建議日後收緊） |
| contact.view / update | ✔ | ✔ | ✔ | 登入即可 |
| contact.merge ⚠ | ✔ | ✔ | ✔ | 登入即可 |
| tag.view | ✔ | ✔ | ✔ | 登入即可 |
| tag.manage ⚠ | ✔ | ✔ | ✔ | 登入即可 |
| knowledge.view / manage ⚠ | ✔ | ✔ | ✔ | 登入即可 |
| knowledge.admin | ✔ | ✔ | ✘ | SUPERVISOR |
| automation.view | ✔ | ✔ | ✘ | SUPERVISOR |
| automation.manage | ✔ | ✘ | ✘ | ADMIN |
| canvas.use ⚠ | ✔ | ✔ | ✔ | 登入即可 |
| identity.review ⚠ | ✔ | ✔ | ✔ | 登入即可 |
| channel.view | ✔ | ✔ | ✘ | SUPERVISOR |
| channel.create / update / delete | ✔ | ✘ | ✘ | ADMIN |
| richmenu.manage | ✔ | ✔ | ✘ | SUPERVISOR |
| quickreply.manage | ✔ | ✔ | ✘ | SUPERVISOR |
| marketing.view / manage / broadcast | ✔ | ✔ | ✘ | SUPERVISOR |
| analytics.view / export | ✔ | ✔ | ✘ | SUPERVISOR |
| analytics.view.self | ✔ | ✔ | ✔ | 收斂缺口，AGENT 可看自己 |
| shortlink.view | ✔ | ✔ | ✔ | 登入即可 |
| shortlink.manage ⚠ | ✔ | ✔ | ✔ | 登入即可 |
| portal.view / manage | ✔ | ✘ | ✘ | ADMIN |
| settings.manage / sla.manage | ✔ | ✔ | ✘ | SUPERVISOR |
| webhook.view | ✔ | ✔ | ✘ | SUPERVISOR |
| webhook.manage | ✔ | ✘ | ✘ | ADMIN（收斂：更新也需此權限） |
| agent.view | ✔ | ✔ | ✔ | 登入即可（列表） |
| agent.manage 🔒 | ✔ | ✔ | ✘ | SUPERVISOR（建立/編輯） |
| agent.role.assign | ✔ | ✔ | ✘ | SUPERVISOR（受越權防護） |
| agent.password.reset / agent.delete | ✔ | ✘ | ✘ | ADMIN |
| role.view 🔒 / role.manage 🔒 | ✔ | ✘ | ✘ | 新功能，僅 admin |

**越權防護**（取代舊「SUPERVISOR 不可建 ADMIN」inline 規則）：持 `agent.role.assign` 者，只能指派「權限集合不超出自己有效權限」的角色。因此 supervisor 預設無 `automation.manage` / `channel.create` 等，就無法把這些權限透過指派 admin 角色而外洩。

---

## 6. API 端點規格

### 6.1 現有路由的 guard 替換

所有現行 `requireAdmin()` / `requireSupervisor()` 換成對應 `requirePermission(code)`。對照見 §4 各表「說明」欄與 §8 收斂項。範例：

| 路由 | 舊 guard | 新 guard |
|---|---|---|
| `POST /channels` | requireAdmin | `requirePermission('channel.create')` |
| `GET /channels` | requireSupervisor | `requirePermission('channel.view')` |
| `POST /automation/rules` | requireAdmin | `requirePermission('automation.manage')` |
| `GET /analytics/my` | requireSupervisor | `requirePermission('analytics.view.self')` |
| `POST /contacts/merge` | （無） | `requirePermission('contact.merge')` |
| `PATCH /webhook-subscriptions/:id` | （無，漏掛） | `requirePermission('webhook.manage')` |
| `PATCH /agents/:id/role` | requireSupervisor + inline | `requirePermission('agent.role.assign')` + 越權防護 |

### 6.2 新增端點

| method | path | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/v1/me/permissions` | 登入即可 | 回傳當前 agent 有效權限 code 陣列（前端 gating 用） |
| GET | `/api/v1/roles` | `role.view` | 角色列表（含 isSystem） |
| POST | `/api/v1/roles` | `role.manage` | 建立 custom role |
| PATCH | `/api/v1/roles/:id` | `role.manage` | 改名（system role 不可改 slug） |
| DELETE | `/api/v1/roles/:id` | `role.manage` | 刪 custom role（仍被指派則阻擋，回需改派人數） |
| GET | `/api/v1/roles/:id/permissions` | `role.view` | 該角色的權限 code |
| PUT | `/api/v1/roles/:id/permissions` | `role.manage` | 設定該角色權限（dependsOn 驗證、admin 核心鎖定、防自鎖、越權防護） |
| GET | `/api/v1/permissions` | `role.view` | 權限矩陣資料：所有權限點依 group（含 label/description/dependsOn，不含 implies 為可勾格） |

### 6.3 錯誤回應

- 權限不足：HTTP `403`，body `{ code: 'FORBIDDEN', message: 'Insufficient permission' }`。
- dependsOn 矛盾：HTTP `422`，訊息指出缺少的前置權限。
- 刪除仍被指派角色：HTTP `409`（或 422），body 含 `blockingAgentCount`。

### 6.4 有效權限解析與快取

- 有效集合 = `RolePermission(roleId)` ∪ `implies` 遞迴閉包。
- 快取 Redis key `perms:role:{roleId}`，TTL ≤ 10 分鐘；該角色 RolePermission 變更時主動 `del`。

---

## 7. UI 版面與互動

### 7.1 進入點

`設定 → SETTINGS_TABS` 新增「角色與權限」分頁（需 `role.view`），沿用 `settings/page.tsx` 的左 sidebar + 右內容佈局。

### 7.2 版面：逐角色編輯（非二維大矩陣）

```
┌─ 角色 ────────┐┌─ 權限（選中角色）───────────────────────────┐
│ ● Admin  內建 ││ [搜尋權限…]        [只看已開 ▾]              │
│ ○ Supervisor  ││                                              │
│   內建        ││ ▼ 客服作業        已開 3/3   [整組開關]      │
│ ○ Agent  內建 ││   ☑ 檢視對話                                  │
│ ○ 行銷專員 ✎🗑 ││   ☑ 回覆對話    （自動開啟：需檢視對話）      │
│ ────────────  ││   ☑ 管理對話                                  │
│ ＋ 新增角色    ││ ▶ 案件            已開 2/6                    │
│               ││ ▶ 渠道管理        已開 0/6                    │
│               ││ …                                            │
└───────────────┘└──────────────────────────────────────────────┘
        [ 未儲存 2 項變更   （儲存）（放棄） ]  ← sticky footer
```

- **左欄**：角色清單。system role 標「內建」徽章（沿用 `Badge` + `ROLE_CONFIG` 色）、不可刪；custom role 有改名/刪除。底部「＋ 新增角色」。選中態 `bg-primary text-primary-foreground`。
- **右欄**：權限依 `group` 折疊分區（`{open && ...}` 慣例）。group 標題顯示「已開 N/全部 M」+ 整組開關（抽 `OfficeHoursSettings` 的 `role="switch"` 成 `ui/switch`）。每列 `ui/checkbox` + label + description 小字。
- **頂部**：權限搜尋框 + 「只看已開/未開」過濾；無結果空狀態「找不到符合的權限」。

### 7.3 關聯機制的呈現

- **dependsOn**：勾 `inbox.reply` 自動勾 `inbox.view`，被自動勾者顯示灰字「因『回覆對話』需要而自動開啟」；取消 `inbox.view` 時就地確認「將一併關閉『回覆對話』等 N 項」。
- **group**：分區折疊 + 整組開關 + 已開計數。
- **implies**：不做可勾選格；在觸發隱含的權限（如 `case.assign`）旁放 info 圖示（暫用原生 `title=`）「啟用時一併需要『檢視人員』，系統自動處理」。

### 7.4 狀態視覺（用形式表達，可掃描）

| 狀態 | 視覺 | 互動 |
|---|---|---|
| 可勾、未開 | 空 checkbox | 可點 |
| 可勾、已開 | 勾選 | 可點取消 |
| dependsOn 自動開啟 | 勾選 + 灰字「自動開啟」 | 可點，提示連動 |
| 越權（超出自己權限） | disabled + 淡化 | 不可點，`title`「你本身沒有此權限，無法授予」 |
| admin 鎖定核心 | 勾選 disabled + 🔒 | 不可取消，`title`「內建管理權限，不可移除」 |
| 自身角色 role.manage | 勾選 disabled + ⚠ | 不可取消，`title`「移除後你將無法再管理權限」 |

### 7.5 儲存與邊界

- **編輯緩衝 + 明確儲存**：勾選先進本地 state，底部 sticky footer 顯示「未儲存 N 項變更／儲存／放棄」，不逐格打 API。
- 儲存成功就地 `text-success`；失敗 `text-destructive` 並保留變更（沿用專案無全域 toast 慣例）。
- **新增角色**：Dialog 只問角色名稱（不需選來源角色）；建立後即為**空白角色（0 權限）**，畫面直接進入該角色的權限編輯，由使用者自行逐項勾選。每個自訂角色彼此獨立、不繼承。
- 刪除仍被指派角色：Dialog 列出「N 位成員使用中，請先改派」並提供跳轉。
- 無 `role.manage`：整頁 render 為唯讀（checkbox 與編輯控制 disabled）。

### 7.6 前端全域 gating

- 登入後打 `GET /me/permissions` 載入有效權限，`usePermission(code)` hook 判斷。
- Sidebar 選單項目依對應權限顯示（取代現行全顯示）。
- 各頁關鍵按鈕（建立/刪除/派工/匯出/發送等）依權限顯示。
- **前端 gating 僅為 UX，後端 guard 為權威**：繞過前端仍會被後端 403。

### 7.7 主題

全頁只用語意 Tailwind token（自動深淺色），light/dark 皆須檢查對比與可讀性。

---

## 8. 現行缺口收斂（盤點發現）

本次一併處理現行程式碼的權限缺口與不一致：

1. **登入即可的高風險操作** → 給獨立權限點（預設仍給 AGENT 維持零中斷，可日後收緊）：
   - `contact.merge`（合併聯絡人）、`case.delete`（刪案）、`tag.manage`、`shortlink.manage`、`knowledge.manage`、`canvas.use`、`identity.review`。
2. **同模組 guard 覆蓋不一致（疑似漏掛）** → 統一到對應權限點：
   - channel 的 `verify`/`setup-webhook`/`status`/`embed-code` → 併入 `channel.view` 或 `channel.update`。
   - automation 的 `test`/`logs` → 併入 `automation.view`。
   - webhook-subscription 的 `PATCH`/`deliveries`/`test`（原比建立寬鬆）→ 收斂為 `webhook.manage`/`webhook.view`。
3. **`/analytics/my` 被整模組擋** → 新增 `analytics.view.self`，AGENT 可看自己數據。
4. **agent inline 規則** → 由 `agent.role.assign` + 越權防護取代，語意更一致。

---

## 9. 遷移與部署

1. **Schema**：新增 `Role`/`RolePermission`、`Agent.roleId`（nullable 過渡），產正式 Prisma migration。
2. **Seed system roles**：每租戶建三 system role，依 §5 種入預設 RolePermission。
3. **回填**：每個 agent 依 §2.4 對映填 `roleId`。
4. **切 guard**：路由分批由舊 guard 換 `requirePermission`（新舊並存過渡）。
5. **前端**：上設定頁 + 選單/按鈕依權限顯示。
6. **清理**：穩定後移除 `Agent.role` enum 與舊 guard（下一版）。
7. **Rollback**：步驟 4 前 enum 與舊 guard 都在可直接切回；步驟 4 後保留舊 guard 函式一版以快速切回。
8. **部署前 pre-flight**：每租戶三 system role 齊全、§5 預設對照無缺漏、無孤兒 roleId、無重複 email。

---

## 10. 待拍板事項（Open Questions）

- system role 每租戶各一份（傾向）vs 全域共用。
- `admin` 鎖定核心權限最小集合（至少 `agent.manage`、`role.manage`，是否再加 `settings.manage`？）。
- 前端權限放 JWT claim vs 登入後 `/me/permissions`（傾向後者，即時反映權限變更）。
- 標 ⚠ 的高風險權限，首版是否就把預設從 AGENT 收緊（傾向維持零中斷、上線後由客戶自行收緊）。
- custom role 一律以**空白角色**建立、自行勾選權限（已定案）。是否**額外**提供「複製既有角色」作為選用捷徑可延後——但它只能是選項，不得成為建立的必要步驟。
