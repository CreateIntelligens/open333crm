## Why

目前的權限控管是「寫死在程式碼裡的三層角色階層」（`ADMIN` > `SUPERVISOR` > `AGENT`）：每條路由掛 `requireAdmin()` / `requireSupervisor()`，角色能做什麼完全由程式碼決定。這造成三個問題——(1) 任何權限調整都要改程式碼重新部署；(2) 無法新增像「行銷專員」「客服組長」這種只該碰特定功能的角色；(3) 前端側邊選單完全不依角色隱藏，所有角色都看得到所有入口，只靠後端 403 把關，體驗差且易誤導。隨著功能持續增加，這套模型維護成本只會越來越高。

本次升級把權限模型從 **role-based（角色白名單）** 改為 **permission-based（權限點 + 角色權限對應）**，讓 Admin 能在後台針對每個角色細調可用功能，並為後續新增功能建立一套「怎麼開權限」的固定流程與「功能之間怎麼區分關聯」的明確規範。

## What Changes

- **新增權限點（Permission）模型**：以 `resource.action` 命名（如 `channel.create`、`case.assign`、`analytics.view`），採 CRUD 細分粒度。權限點集中定義在單一登錄表（registry），是全系統唯一事實來源。
- **新增角色權限對應**：`Role` 與 `RolePermission` 資料表，取代寫死的 enum。內建三個 system role（不可刪、不可改 slug），並支援 Admin **自訂新角色**並勾選權限（自訂角色可刪）。
- **新增權限判斷 guard**：`requirePermission('channel.create')` 取代 `requireAdmin()` / `requireSupervisor()`，改讀當前 agent 角色所擁有的權限集合（含快取），非比對固定角色白名單。
- **權限關聯三機制**：
  - **權限相依 `dependsOn`**：如 `inbox.reply` 相依 `inbox.view`；勾選/取消時 UI 與後端都連動、不允許矛盾組合。
  - **功能分群 `group`**：權限點依功能領域分群（客服作業 / 渠道管理 / 行銷 / 分析 / 系統設定），供 UI 分區與「一次開一整組」。
  - **跨模組隱含權限 `implies`**：如 `case.assign` 隱含需要 `agent.view`（讀人員清單）；授予某權限時自動補齊其隱含依賴，避免開了功能卻因缺相鄰權限而壞掉。
- **新增角色權限設定頁 UI**：Admin 可在後台看到權限矩陣（角色 × 權限點，依 group 分區），勾選調整、新增/刪除自訂角色。
- **前端依權限動態隱藏**：側邊選單與關鍵按鈕改用 `usePermission('...')` 判斷顯示，登入時載入當前使用者權限集合。
- **BREAKING**：`AgentRole` enum（固定三值）改為 `Agent.roleId` 外鍵指向 `Role` 表；既有 guard `requireAdmin()` / `requireSupervisor()` 語意由「角色比對」改為「權限比對」，需資料遷移把現有三角色轉為三個 system role 並種入預設權限對應。

## Capabilities

### New Capabilities
- `permission-model`: 權限點（Permission）的定義、命名規範、集中登錄表（registry）、關聯機制（dependsOn / group / implies），以及「新增功能時如何登錄新權限點」的流程契約。
- `permission-check`: 執行期權限判斷 —— `requirePermission()` guard、agent 有效權限集合的解析與快取、403 回應形狀、前端 `usePermission` 判斷契約。
- `role-management`: 角色（含 system / custom）的 CRUD、內建角色保護、角色權限對應（RolePermission）的設定 API，以及權限設定頁的資料契約。

### Modified Capabilities
- `rbac`: 既有「角色白名單 guard（requireAdmin / requireSupervisor）」的行為契約改為以權限點為基礎；per-module 的「需要 ADMIN / 需要 SUPERVISOR」requirement 重新表述為「需要對應權限點」，並保留向後相容的預設權限對應。

## Impact

- **資料庫（packages/database）**：新增 `Role`、`Permission`（若採 DB 儲存）、`RolePermission` 三表；`Agent` 新增 `roleId`；產出正式 migration（`AgentRole` enum → Role FK 的資料遷移）。
- **後端（apps/api）**：`guards/rbac.guard.ts` 重寫為 `requirePermission()`；全部既掛 `requireAdmin/requireSupervisor` 的路由改掛對應權限點；新增 `roles` / `permissions` 路由與 service；JWT / session 需帶或可解析角色→權限。
- **前端（apps/web）**：新增「角色與權限」設定頁（權限矩陣 UI）；`Sidebar` 與各頁按鈕改依權限顯示；新增 `usePermission` hook 與登入時的權限載入。
- **快取（Redis）**：角色→權限集合快取（角色權限變更時失效）。
- **既有 spec**：`rbac` spec 大幅改寫；`agent-management` 可能受角色欄位變更影響。
- **部署**：需資料遷移，且遷移期間要確保現有登入者權限不中斷（預設權限對應必須完全覆蓋現行三角色能力）。
