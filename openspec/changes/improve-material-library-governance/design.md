## Context

素材庫現況（程式碼實測）：
- `Material` model 有 `category String?`、`usageCount Int`、`lastUsedAt DateTime?`，但**列表頁 UI 只用 `channelType` 與名稱搜尋**；後端 `listMaterials` 已支援 `category` 篩選與 `GET /materials/categories`，前端沒接。
- **無標籤、無版本、無素材級成效**。`usageCount` 僅在廣播發送成功後累加（`marketing.service.ts`），`lastUsedAt` 有欄位無 UI。
- `TemplateView` 有審核狀態 enum（`DRAFT/PENDING_REVIEW/APPROVED/REJECTED`），但只被 canvas 模組使用，與素材庫無關。
- Postgres RLS 已上線：所有租戶表需 RLS policy，新表若漏接會 fail-closed 回空（見 postgres-rls-tenant-isolation skill）。

## Goals / Non-Goals

**Goals:**
- 分類從單一字串升級為租戶自訂巢狀分類樹，可篩選、可自由搬移素材與分類。
- 素材多標籤，列表可依標籤篩選。
- 列表複合篩選（分類＋標籤＋渠道＋關鍵字）＋排序切換（最近使用/使用次數/更新時間/名稱）。
- 素材版本歷史：每次編輯存快照，可檢視與還原。
- 素材級成效歸因：使用次數＋（可得時）互動成效，歸因到單則素材。
- 列表顯示既有 `lastUsedAt` 與素材 `status`。

**Non-Goals:**
- **送審核准工作流**（審核者指派、送審通知、核准/退回動作）——本 change 只做 `status` 的顯示與手動設定，狀態機另開 change。
- LINE Flex 視覺化編輯器、AI 輔助（各自獨立機會）。
- 啟用或移除 `targetChannels` / `variables` 死欄位。
- 跨租戶共享分類/標籤（皆 tenant-scoped）。

## Decisions

### D1. 分類：新增 `MaterialCategory` 表，`Material.category` 字串保留過渡
- 新增 `MaterialCategory`：`id / tenantId / name / parentId(自我關聯，nullable) / sortOrder / createdAt`。巢狀用鄰接表（parentId），單層 parent→child 為主（UI 樹狀），不做無限深度（避免搬移環路複雜度）。
- `Material` 新增 `categoryId String?` 指向 `MaterialCategory`；**保留舊 `category String?`** 一段時間相容既有資料，migration 不強制轉換（避免破壞現有素材）。新建/編輯走 `categoryId`。
- **搬移**：素材改 `categoryId`、分類改 `parentId` 即可自由搬移（正面回應 Intercom「不可搬移」痛點）。搬移分類時擋自我循環（不可把分類移到自己的子孫下）。

### D2. 標籤：`Material.tags String[]`，租戶標籤由既有素材聚合
- 標籤存為 `Material.tags String[]`（Postgres text[]），不另建標籤表——標籤集合由 `SELECT DISTINCT unnest(tags)` 聚合，租戶自訂免管理表。
- 列表篩選 `tags` 用陣列包含（`hasSome` / `hasEvery` 視需求，預設 hasSome）。
- 與 D1 分類正交：分類是單一歸屬（樹），標籤是多重標記。

### D3. 版本：新增 `MaterialVersion` 快照表，編輯時寫入
- `MaterialVersion`：`id / materialId / tenantId / versionNo(遞增) / name / body(Json) / editedById / createdAt`。
- **寫入時機**：`updateMaterial` 成功後，把**更新前**的 name/body 存為一版（即「還原點」語意——歷史保存的是被覆蓋的舊值）；或採「更新後存新版」——**採更新後存新版**，versionNo 單調遞增，`Material` 當前值即最新版，歷史表存每次提交的快照。首次建立也寫 v1。
- **還原**：`POST /materials/:id/versions/:versionNo/restore` 把該版 name/body 寫回 Material（並自身也產生一個新版，還原＝一次新編輯，不破壞線性歷史）。
- 保留策略：預設全保留；如需上限（如最近 50 版）留待成效觀察後再加，避免過早最佳化。

### D4. 成效歸因：擴充既有 usageCount，新增互動計數
- 沿用 `Material.usageCount`（送出次數）＋ `lastUsedAt`。
- 新增素材級互動歸因：廣播/發送已有 `BroadcastRecipient`（含 `replied`、`caseId`），可 join 回 material 聚合「回覆數/開案數」。點擊率若無短連結歸因資料則標「暫無資料」，不假造。
- 列表以「使用次數＋長條（相對租戶內最大值正規化）」呈現；詳情頁可看 usageCount / lastUsedAt / 回覆數 等彙總。**MVP 不做時間趨勢圖**（列 Non-Goal 的延伸，先給彙總數字）。

### D5. status 欄位：顯示用，手動設定
- `Material` 新增 `status String @default("draft")`（`draft` / `approved` 兩值起步，字串非 enum 以利未來擴充送審狀態）。
- 本 change：列表顯示徽章＋允許 `marketing.manage` 手動切 draft/approved。**不做**送審通知/審核者流程——那是後續 change 把 status 接上狀態機。

### D6. RLS：新表納入租戶隔離
- `MaterialCategory`、`MaterialVersion` 皆有 `tenantId`，比照核心表加 RLS policy（`NULLIF(current_setting('app.current_tenant'),'')::uuid`），route 走 `request.tenantPrisma`。務必驗 fail-closed 不漏接（見 skill 陷阱 #5/#8）。

### D7. API 端點增修
- `GET /materials`：加 `categoryId`、`tags`、`sort`（enum）、`status` 篩選參數。
- 分類：`GET/POST/PATCH/DELETE /materials/categories`（樹狀回傳、建/改名/搬移/刪除；刪除分類時其下素材 categoryId 設 null 不連帶刪素材）。
- 標籤：`GET /materials/tags`（聚合去重）。
- 版本：`GET /materials/:id/versions`、`POST /materials/:id/versions/:versionNo/restore`。
- 成效：併入 `GET /materials/:id`（回傳彙總）或 `GET /materials/:id/stats`。

## Risks / Trade-offs

- **版本表成長**：每次編輯一列，熱門素材可能累積多版。MVP 全保留，觀察後再加保留上限；`MaterialVersion` 加 `@@index([materialId, versionNo])`。
- **category 雙軌（字串 + categoryId）**：過渡期兩欄並存有認知成本。決策是不強制遷移既有資料以策安全；後續可出一支資料遷移把舊字串對應到新分類再移除舊欄。
- **成效歸因準確度**：點擊率依賴短連結歸因，若素材未用短連結則無點擊資料——UI 明確標「暫無資料」而非 0，避免誤導（呼應研究中 Intercom 可稽核精神）。
- **RLS 漏接風險**：新表若忘記 policy 或 route 用錯 client 會 fail-closed 回空（好的吵，會立刻暴露），或 fail-open 洩漏（壞）。上線前必跑跨租戶隔離驗證。
- **搬移循環**：分類 parentId 自我關聯需在搬移時擋環（把 A 移到 A 的子孫下）。以路徑檢查或限制單層深度規避。
