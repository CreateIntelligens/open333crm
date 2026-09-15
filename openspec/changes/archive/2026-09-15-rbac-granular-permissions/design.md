## Context

現況（見 proposal）：權限是寫死的三層角色階層，guard 只做角色白名單比對，前端不依角色隱藏。本設計把它升級為 permission-based RBAC，並特別回答兩個維護面問題：

1. **後續加新功能時，怎麼開權限？** —— 需要一條低摩擦、不易漏掉的固定流程。
2. **功能之間有關聯時，怎麼區分？** —— 需要明確的關聯機制，讓「相依 / 分群 / 隱含」三種情況各有處理方式，不會互相混淆。

約束：Prisma + PostgreSQL；guard 為 Fastify preHandler；不可 import Prisma `AgentRole` enum（用字串字面量）；多租戶，每個 `Role` 屬於某 tenant（system role 為每租戶各一份或全域共用，見 Decisions）；權限判斷在 hot path（每個請求），必須快取。

## Goals / Non-Goals

**Goals:**
- 權限點以 `resource.action` 命名、CRUD 細分，集中在單一 registry（唯一事實來源）。
- Admin 可在後台針對角色勾選權限、新增/刪除自訂角色，不需改程式碼部署。
- 建立「新增功能 → 登錄權限點 → 掛 guard → 出現在設定頁」的固定 SOP，並用測試防止漏登錄。
- 用 `dependsOn` / `group` / `implies` 三機制清楚區分功能關聯。
- 前端側邊選單與按鈕依權限動態顯示。
- 資料遷移零權限中斷：既有三角色轉為三個 system role，種入完全覆蓋現行能力的預設權限。

**Non-Goals:**
- 不做 per-record / 資料列層級權限（如「只能看自己負責的工單」）——那屬於資料範圍（data scoping），本次僅做功能操作權限（feature/action）。既有的租戶隔離與 assignee 邏輯不變。
- 不做欄位層級權限。
- 不做權限的時效/審批流程（approval workflow）。
- 不改動 CLI token / PartnerApiKey 的 `scopes`（那是 M2M API scope，與使用者角色權限是兩套系統，本次不合併）。
- 不引入新的 UI 元件庫或設計語言：權限設定頁一律用既有自製 shadcn 風格元件（`@/components/ui/*`）、Tailwind 語意 token（自動支援深淺色）、以及既有頁面慣例（grid 假表格、`{open && ...}` 折疊、就地成功/錯誤訊息、無全域 toast）。缺的原子元件（共用 Switch、Tooltip）以抽既有 `OfficeHoursSettings` 開關或原生 `title=` 補足，不裝新套件。

## Decisions

### D1. 權限點 registry：程式碼定義為主，DB 只存「角色↔權限」對應

**決定**：權限點清單（code、group、dependsOn、implies、label、description）定義在程式碼中的 `PERMISSIONS` registry（`packages/core` 或 `apps/api/src/rbac/permissions.registry.ts`），**不存 DB**。DB 只存 `Role`、`RolePermission`（角色擁有哪些權限 code）。

**理由**：
- 權限點是「系統能力的宣告」，隨程式碼版本走，天生應與程式碼同生命週期——用 code 定義可被 type-check、被測試覆蓋、code review 時一眼看到。
- 若權限點存 DB，新增功能得跑 migration/seed 才會出現，容易與部署脫節；且會出現「DB 有這個 code 但程式碼沒對應 guard」的孤兒。
- `RolePermission` 存的是使用者設定（可變、需持久化、需審計），才進 DB。

**替代方案**：權限點也存 DB（拒絕，理由如上）。以此換得的好處是「不改碼加權限」，但權限點對應的 guard 本來就要寫在程式碼裡，純 DB 權限點沒有意義。

**驗證機制**：啟動時（或 CI 測試）掃描所有路由的 `requirePermission('x')`，斷言每個 `x` 都存在於 registry；反向也可選配（registry 有但沒人用 → 警告）。這就是「防止加功能漏開權限」的守門。

### D2. 權限判斷解析與快取

**決定**：agent 的有效權限集合 = `RolePermission(agent.roleId)` 展開後，再加上 `implies` 遞迴補齊（見 D5）。結果 `Set<string>` 快取在 Redis，key `perms:role:{roleId}`，TTL 10 分鐘，並在該角色的 RolePermission 變更時主動失效（del key）。

**理由**：權限判斷在每個請求都會跑，不能每次查 DB。以 roleId 為快取單位（非 agentId），因為同角色共用同權限集合，快取命中率高、失效面小。

`requirePermission(code)` guard 流程：取 `request.agent.roleId` → 讀快取（miss 則查 DB + 展開 implies + 回填）→ `has(code)` ? 通過 : 403。回應形狀沿用現有 `{ code: 'FORBIDDEN', message }`。

### D3. 角色模型：system role vs custom role

**決定**：`Role` 表含 `isSystem: boolean`、`slug`（system role 為 `admin`/`supervisor`/`agent`，唯一且不可改）、`tenantId`。
- **system role**：三個內建角色，不可刪、slug 不可改、**權限可調**（Admin 仍可增減其權限，唯 `admin` 角色保底鎖住核心管理權限如 `role.manage`，避免自我鎖死）。
- **custom role**：Admin 可新增（如「行銷專員」），可刪、可改名與權限。刪除前若有 agent 使用該角色，需先改派或阻擋。

**理由**：兼顧向後相容（三 system role 承接現有 enum 語意）與擴充（custom role）。`admin` 角色的核心權限鎖定是「防自鎖」安全底線。

**替代方案**：system role 權限完全不可改（拒絕，太僵；使用者常想讓 Supervisor 少一點權限）。

### D4. `AgentRole` enum → `Agent.roleId` FK 的遷移（BREAKING）

**決定**：保留 `Agent.role` enum 欄位一版作為過渡（雙寫），新增 `Agent.roleId`。遷移步驟見 Migration Plan。最終 guard 全部走 `roleId`。

### D5. 三種功能關聯的區分機制 —— 本設計核心

三者解決不同問題，資料上是權限 registry 每個項目的三個獨立欄位：

| 機制 | 欄位 | 解決的問題 | 生效時機 | 範例 |
|---|---|---|---|---|
| **相依** | `dependsOn: string[]` | 同一功能的操作前後序：不看就不能改 | **勾選當下（UI + 寫入驗證）** | `inbox.reply` dependsOn `inbox.view`；`case.close` dependsOn `case.view` |
| **分群** | `group: string` | UI 呈現與「一次開一整組」 | **顯示 / 批次操作** | `channel.*` 都屬 `channel-management` 群組 |
| **隱含** | `implies: string[]` | 跨模組的執行期副作用：這功能會用到別模組資料 | **權限解析當下（自動補齊，不進 DB）** | `case.assign` implies `agent.view`（要讀人員清單才能派工） |

**關鍵區分——`dependsOn` vs `implies`（最容易混淆）**：

- `dependsOn` 是**設定約束**：勾 `inbox.reply` 前必須也勾 `inbox.view`，這是「同一資源、view 是 reply 的前提」。它會**實際寫進 RolePermission**（角色真的擁有這兩個 code），並在 UI 連動（勾 reply 自動勾 view；取消 view 自動取消 reply）與 API 寫入時驗證（矛盾組合 422）。使用者看得到、可理解。

- `implies` 是**執行期補齊**：授予 `case.assign` 的角色，在權限解析時**自動獲得** `agent.view` 的判斷結果，但**不寫進 RolePermission**、設定頁**不顯示**這個補齊。它處理的是「A 功能實作上會呼叫 B 模組的唯讀資料」這種隱藏耦合，避免「開了派工卻因為沒開人員檢視而壞掉」。使用者不需知道這層。

- 判準：**使用者需要理解並自行管理的前後序 → `dependsOn`**（進 DB、UI 顯示）；**純粹是實作耦合、使用者不該操心的 → `implies`**（不進 DB、解析時補）。

`group` 與前兩者正交，純粹是分類標籤，不影響授權判斷。

### D6. 「新增功能時怎麼開權限」的固定 SOP

每次加新功能，開發者依序做四步（design 附此 SOP，tasks 會落成 checklist、CLAUDE.md 會補一段）：

1. **在 registry 登錄權限點**：加一筆 `{ code: 'newfeature.action', group, label, description, dependsOn?, implies? }`。
2. **路由掛 guard**：`{ preHandler: [fastify.authenticate, requirePermission('newfeature.action')] }`。
3. **決定預設歸屬**：在 seed 的預設 RolePermission 中，決定哪些 system role 預設擁有此權限（避免上線後沒人有權限）。
4. **前端（若有入口）**：選單/按鈕用 `usePermission('newfeature.action')` 包一層。

守門：D1 的啟動/CI 斷言確保「路由用了但沒登錄」會炸；code review checklist 確保「登錄了但忘了給任何角色」有人看。命名規範（`resource.action`、動詞用 view/create/update/delete/管理性動詞如 assign/export/send）寫進 permission-model spec。

### D7. 權限設定頁佈局：逐角色編輯，不用大矩陣

**決定**：設定頁不採「角色 × 權限點」二維大表，而採「**左選角色 → 右編該角色權限**」：
- **左欄**：角色清單（沿用 `settings/page.tsx` 的 sidebar 垂直導覽模式），每個角色一列，system role 標「內建」徽章、custom role 可改名/刪除。底部「＋ 新增角色」。
- **右欄**：選中角色的權限清單，依 `group` 分區折疊（沿用專案既有 `{open && ...}` 條件渲染 Collapsible 慣例，非引入新元件），每個權限點一列含 checkbox（用既有 `ui/checkbox`）、label、description 小字。group 標題列有「整組全開/全關」的 toggle（抽 `OfficeHoursSettings` 的 `role="switch"` 開關成共用元件）。

**理由**：
- 80–150 權限點 × N 角色的二維矩陣在窄螢幕與深色主題下極難閱讀、必然出現橫向卷軸（違反「頁面 body 不得橫向卷動」）。逐角色編輯一次只呈現一維，可掃描、可折疊、對齊既有設定頁資訊架構。
- 心智模型單純：使用者的實際任務是「設定某個角色能做什麼」，逐角色正是這個動線。
- 頂部提供「權限搜尋框」與「只看已開/未開」過濾，解決權限點多的翻找問題。

**替代方案**：完整二維矩陣（拒絕：窄螢幕爆版、資訊過載）；純 JSON 編輯（拒絕：非技術 Admin 不可用）。

**唯讀綜覽補充**：另提供一個唯讀的「角色比較表」小卡（可選、延後），橫向對照三 system role 的重點權限，滿足「一眼比較」需求，但不作為編輯介面。

### D8. 關聯機制在 UI 上怎麼呈現（對應 D5 的三機制）

三種關聯在畫面上有各自的表現，讓使用者「看得懂為什麼」：

- **`dependsOn`（前後序，需使用者理解）**：
  - 勾選連動——勾 `inbox.reply` 時自動勾上 `inbox.view`，並在被自動勾的項目旁顯示灰字提示「因『回覆對話』需要而自動開啟」。
  - 取消連動——取消 `inbox.view` 時，跳出就地確認：「這會一併關閉『回覆對話』等 2 項相依權限」，確認後連動關閉。
  - 相依項目在同一 group 內以縮排/連接線視覺群組，暗示從屬關係。

- **`group`（分群，純分類）**：
  - 權限清單依 group 分區塊、可折疊；group 標題顯示「已開 N / 全部 M」計數與整組開關。
  - group 命名用使用者語言（「客服作業」「渠道管理」「行銷」「分析報表」「系統設定」），非技術模組名。

- **`implies`（隱含耦合，使用者不需管理）**：
  - **不作為可勾選格**出現在矩陣。
  - 在會觸發隱含的權限點（如 `case.assign`）旁，放一個 info 圖示，hover（暫用原生 `title=`）顯示唯讀說明「啟用時會一併需要『檢視人員』，系統已自動處理」。
  - 目的：使用者若疑惑「為什麼開了派工的人能看到人員清單」時有解答，但不需、也不能手動管理它。

### D9. 狀態在 UI 上用「形式」表達（可掃描）

權限格子有多種狀態，各用不同視覺，不只靠有無勾：

| 狀態 | 視覺 | 互動 |
|---|---|---|
| 可勾選、未開 | 空 checkbox | 可點 |
| 可勾選、已開 | 勾選 checkbox | 可點取消 |
| 因 dependsOn 自動開啟 | 勾選 + 灰字「自動開啟」 | 可點但會提示連動 |
| 超出自己權限（越權防護） | disabled checkbox + 鎖淡化 | 不可點，`title` 說明「你本身沒有此權限，無法授予」 |
| system role 鎖定核心權限（如 admin 的 role.manage） | disabled 勾選 + 🔒 圖示 | 不可取消，`title` 說明「內建管理權限，不可移除」 |
| 自身角色的 role.manage（防自鎖） | disabled 勾選 + ⚠ | 不可取消，說明「移除後你將無法再管理權限」 |

**儲存模式**：採「編輯緩衝 + 明確儲存」——勾選先進本地 state，底部出現「未儲存變更」列與「儲存/放棄」按鈕（sticky footer），避免每勾一格打一次 API。儲存後就地顯示 `text-success` 成功訊息（沿用專案無全域 toast 的慣例），失敗顯示 `text-destructive` 並保留變更。

**空狀態/邊界**：無自訂角色時左欄僅三 system role；權限搜尋無結果顯示「找不到符合的權限」；刪除仍被指派的角色時，彈窗列出「N 位成員使用中，請先改派」並提供跳轉。

## Risks / Trade-offs

- [遷移期權限中斷] 若預設 RolePermission 未完整覆蓋現行三角色能力，上線後有人突然沒權限 → 遷移前用腳本盤點「現行每條路由的 guard」對照「新權限點預設歸屬」，逐條核對；提供 rollback（保留 `Agent.role` enum 一版，可切回舊 guard）。
- [權限快取不一致] 角色權限改了但快取沒失效 → 統一在 RolePermission 寫入路徑主動 `del` 快取 key + 短 TTL 兜底；跨進程（workers）目前不判斷使用者權限，暫無跨進程失效需求。
- [自我鎖死] Admin 把自己角色的 `role.manage` 取消 → `admin` system role 的核心權限鎖定不可移除；且 API 拒絕「移除自己當前角色的 role.manage」。
- [權限爆炸難維護] CRUD 細分後權限點多（80–150 個）→ 用 `group` 分區 + 「整組開關」+ registry 集中定義 + 命名規範緩解；設定頁預設收合、依 group 呈現。
- [implies 遞迴成環] `A implies B`、`B implies A` → 解析時偵測環並在啟動斷言時報錯；registry 測試涵蓋。
- [效能] 每請求查權限 → Redis 快取 + roleId 為單位，實測應可忽略；guard 本身 O(1) Set 查詢。

## Migration Plan

1. **Schema**：新增 `Role` / `RolePermission` 表、`Agent.roleId`（nullable 過渡）；`Agent.role` enum 暫留。產出正式 Prisma migration。
2. **Seed system roles**：每租戶（或全域）建 `admin`/`supervisor`/`agent` 三 system role，並依「現行 guard 盤點表」種入預設 RolePermission，使其能力 = 現行三角色能力。
3. **回填**：把每個 agent 的 `role` enum 映射到對應 system role 的 `roleId`。
4. **切 guard**：路由由 `requireAdmin/requireSupervisor` 換成 `requirePermission(...)`（可分批，兩套並存過渡）。
5. **前端**：上權限矩陣設定頁 + 選單/按鈕依權限顯示。
6. **清理**：確認穩定後移除 `Agent.role` enum 與舊 guard（下一版）。
7. **Rollback**：步驟 4 之前，enum 與舊 guard 都在，可直接切回；步驟 4 之後 rollback 需還原路由 guard（保留舊 guard 函式一版以利快速切回）。
8. **部署前檢查**：跑重複 email／每租戶三 system role 齊全／預設權限對照表無缺漏 的 pre-flight 腳本。

## Open Questions（已定案 2026-08-18）

- **system role 每租戶各一份**（✅ 定案）：每租戶各建三個 Role，`tenantId` 必填，RolePermission 才能 per-tenant 調整。符合專案多租戶慣例。
- **`admin` 核心鎖定權限 = `role.manage` + `agent.manage`**（✅ 定案）：僅鎖這兩項「管角色 / 管成員」，確保 admin 永遠能登入後繼續管理權限與人員；其餘（含 `settings.manage`）皆可被取消，保留彈性。
- **前端權限走 `GET /me/permissions`，不放 JWT claim**（✅ 定案）：登入後另打端點載入 + 前端快取，避免 JWT 過大且權限變更即時反映。
- **複製既有角色 = 延後**（✅ 定案）：custom role 一律空白建立、自行勾選；複製為日後選用捷徑，非首版。
