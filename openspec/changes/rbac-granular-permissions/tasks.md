## 1. 盤點與前置

- [x] 1.1 盤點現行所有掛 `requireAdmin` / `requireSupervisor` 的路由，產出「路由 → 現行最低角色」對照表（作為預設權限歸屬與遷移零中斷的依據）— 見 SPEC.md §4/§8
- [x] 1.2 依對照表定義完整權限點清單（`resource.action`），標註 group、dependsOn、implies、label、description、所屬平台 feature — 落成 packages/core/src/rbac/permissions.ts（49 個權限點）
- [ ] 1.3 為三個 system role（admin/supervisor/agent）定義預設 RolePermission 對照表，確保能力 = 現行三角色能力（逐條核對 1.1）— SPEC.md §5 已列，待落成 seed

## 2. 權限 Registry（permission-model）

- [x] 2.1 建立 `PERMISSIONS` registry 模組（code/group/label/description/dependsOn?/implies?/feature）— packages/core/src/rbac/permissions.ts
- [x] 2.2 實作 registry 啟動驗證：重複 code、dependsOn/implies 懸空參照、implies 成環、同一對不可同時出現在 dependsOn 與 implies — registry.ts validatePermissionRegistry()
- [x] 2.3 實作 route-to-registry 一致性檢查（validateRouteCodes）— registry.ts；接進啟動待階段 4 隨 guard 一起
- [x] 2.3b 【平台對應】建立 `FEATURE` registry + feature↔權限點對應驗證 — features.ts + registry.ts
- [x] 2.4 為 registry 驗證與一致性檢查補測試 — apps/api/src/__tests__/rbac-registry.test.ts（11 項驗證全過）

## 3. 資料庫（packages/database）

- [ ] 3.1 新增 `Role` 表（tenantId + `tenant` relation + `@@index([tenantId])` + `@@unique([tenantId, slug])`，比照 Agent/Channel/Tag 三件套）與 `RolePermission` 表（roleId + `@@unique([roleId, permissionCode])`，FK `onDelete: Cascade`，本身不帶 tenantId 靠 Role 間接隔離）；`Agent` 新增 `roleId`（過渡期 nullable，保留 `role` enum）；`Tenant` model 補 Role 反向 relation
- [ ] 3.2 產出正式 Prisma migration SQL（勿只 db push；正式部署 entrypoint 跑 migrate deploy）
- [ ] 3.3 撰寫 seed / 遷移腳本：每租戶建三 system role、種入 1.3 預設權限、回填每個 agent 的 roleId
- [ ] 3.4 執行 `prisma generate`，確認 API 端型別可用（用字串字面量，勿 import 生成 enum）

## 4. 權限判斷與快取（permission-check）

- [ ] 4.1 實作有效權限集合解析：RolePermission 展開 + implies 遞迴閉包
- [ ] 4.2 實作 Redis 快取 `perms:role:{roleId}`（TTL ≤10min）與 RolePermission 變更時主動失效
- [ ] 4.3 重寫 `requirePermission(code)` guard（讀取有效集合 → has(code) → 403 `Insufficient permission`）；保留 `requireRole` shim 供過渡
- [ ] 4.4 新增 `GET /me/permissions` 回傳當前使用者有效權限 code 清單
- [ ] 4.5 補 guard、解析、快取失效的整合測試

## 5. 角色管理 API（role-management）

- [ ] 5.1 【租戶隔離—必做】所有 Role/RolePermission 操作 tenantId 一律取自 `request.agent.tenantId`（絕不從 body/query）；改/刪/讀 RolePermission 前一律先 `role.findFirst({ where:{ id, tenantId } })` 驗擁有權，找不到丟 404，通過後才用 roleId 操作 RolePermission（封裝成共用 `loadTenantRole()` helper，杜絕漏檢）
- [ ] 5.2 實作角色 CRUD service/route（`role.view` / `role.manage` 把關；system role 不可刪、slug 不可改）
- [ ] 5.3 實作 RolePermission 指派 API，含 dependsOn 驗證（矛盾 422）、admin 核心權限鎖定、自鎖防護（不可移除自身角色的 role.manage）
- [ ] 5.4 實作指派角色時的越權防護（不可指派超出自身有效權限的角色）
- [ ] 5.5 實作刪除自訂角色前的「仍被指派」阻擋（回傳需改派的 agent 數）
- [ ] 5.6 實作權限矩陣資料端點（roles + 依 group 的權限點，不含 implies 為可勾選格）
- [ ] 5.7 補角色管理各情境測試（含 system role 保護、越權、dependsOn、自鎖，**以及跨租戶存取一律 404、body 帶 tenantId 被忽略**）

## 6. 路由切換（rbac 修改）

- [ ] 6.1 把 channel / automation / settings / analytics / marketing / agent 等模組的 `requireAdmin/requireSupervisor` 逐條換成對應 `requirePermission(...)`
- [ ] 6.2 為 agent 管理補越權指派檢查（取代舊「SUPERVISOR 不能建 ADMIN」inline 邏輯）
- [ ] 6.3 全域回歸：確認每條原本受保護路由在新權限下對三 system role 的可達性與舊行為一致
- [ ] 6.4 analytics `/my` 放寬為 `analytics.view.self`（讓 agent 看自己數據）——需把 analytics 整模組 addHook 改逐路由，本階段先維持整模組 analytics.view(零中斷)，此為後續優化

## 7. 前端資料層與權限閘門（apps/web）

- [ ] 7.1 登入後載入 `/me/permissions`，實作 `usePermission(code)` hook 與權限 context（沿用 `AuthProvider` 慣例）
- [ ] 7.2 Sidebar 選單項目依權限動態顯示（取代靜態全顯示）
- [ ] 7.3 各頁關鍵按鈕（建立/刪除/派工/匯出/發送等）依權限顯示
- [ ] 7.4 在 `SETTINGS_TABS` 新增「角色與權限」分頁，內容區掛 `<RolePermissionMatrix />`（沿用 `settings/page.tsx` sidebar 佈局）

## 8. 角色權限設定頁 UI（apps/web）

- [ ] 8.1 抽共用元件：把 `OfficeHoursSettings` 的 `role="switch"` 開關抽成 `ui/switch.tsx`（整組開關用）；權限說明暫用原生 `title=`
- [ ] 8.2 左欄角色清單：system role 標「內建」徽章、custom role 可改名/刪除、底部「＋ 新增角色」；選中態沿用 `bg-primary text-primary-foreground`
- [ ] 8.3 右欄權限清單：依 `group` 折疊分區（`{open && ...}` 慣例），每 group 標題顯示「已開 N / 全部 M」+ 整組開關；每列 `ui/checkbox` + label + description 小字
- [ ] 8.4 頂部權限搜尋框 + 「只看已開/未開」過濾；無結果空狀態
- [ ] 8.5 dependsOn 連動：勾選自動補勾前置並顯示「自動開啟」提示；取消前置時就地確認會連帶關閉的相依項
- [ ] 8.6 implies 唯讀說明：在觸發隱含的權限旁放 info 圖示 + `title` 說明「啟用時一併需要 X，系統自動處理」，不作可勾選格
- [ ] 8.7 狀態視覺化（見 design D9 表）：越權 disabled + 說明、system role 鎖定核心權限 🔒 disabled、自身角色 role.manage 防自鎖 ⚠ disabled
- [ ] 8.8 編輯緩衝 + sticky footer「未儲存變更／儲存／放棄」；儲存成功 `text-success`、失敗 `text-destructive` 並保留變更
- [ ] 8.9 新增/編輯/刪除自訂角色 Dialog（沿用 `TagManagement` CRUD 樣板）：新增只問名稱→建立空白角色（0 權限）→直接進編輯自行勾選；刪除仍被指派角色時彈窗列出「N 位成員使用中，請先改派」
- [ ] 8.10 無 `role.manage` 時整頁 render 為唯讀（checkbox 與編輯控制 disabled）
- [ ] 8.11 確認深淺色主題：全頁只用語意 Tailwind token，於 light/dark 皆檢查對比與可讀性

## 9. 遷移、驗證與收尾

- [ ] 9.1 撰寫部署前 pre-flight 腳本：每租戶三 system role 齊全、預設權限對照無缺漏、無孤兒 roleId
- [ ] 9.2 分批灰度切換路由 guard（新舊並存），監控 403 異常
- [ ] 9.3 更新 `.claude/CLAUDE.md` 的 RBAC 段落與「新增功能開權限 SOP」四步驟 checklist
- [ ] 9.4 穩定後移除 `Agent.role` enum 與 `requireAdmin/requireSupervisor` shim（下一版清理，獨立小改動）
- [ ] 9.5 更新 `settings_agents_spec.csv` 與相關手冊/文件，反映角色權限設定頁
