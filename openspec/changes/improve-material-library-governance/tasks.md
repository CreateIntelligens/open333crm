## 1. 資料模型與 migration

- [x] 1.1 `schema.prisma`：新增 `MaterialCategory`（id/tenantId/name/parentId 自我關聯/sortOrder/createdAt）+ 索引 `@@index([tenantId, parentId])`
- [x] 1.2 `schema.prisma`：新增 `MaterialVersion`（id/tenantId/materialId/versionNo/name/body Json/editedById/createdAt）+ 索引 `@@index([materialId, versionNo])`
- [x] 1.3 `schema.prisma`：`Material` 新增 `categoryId String?`（關聯 MaterialCategory）、`tags String[] @default([])`、`status String @default("draft")`；保留舊 `category String?`
- [x] 1.4 產正式 migration（`prisma migrate dev`，不可只 db push）並確認 SQL 檔生成
- [x] 1.5 為 `MaterialCategory`、`MaterialVersion` 加 RLS policy（`NULLIF(current_setting('app.current_tenant'),'')::uuid`），比照核心表；migration 內含 ENABLE + FORCE + policy

## 2. 分類 API

- [x] 2.1 `GET /materials/categories`：回傳租戶分類樹（含每分類素材數）
- [x] 2.2 `POST /materials/categories`：建立分類（可帶 parentId），`marketing.manage`
- [x] 2.3 `PATCH /materials/categories/:id`：改名 / 搬移（改 parentId），搬移時擋自我循環（不可移到自己子孫下）
- [x] 2.4 `DELETE /materials/categories/:id`：刪分類，其下素材 `categoryId` 設 null（不連帶刪素材）
- [x] 2.5 全部走 `request.tenantPrisma`，驗跨租戶隔離 fail-closed

## 3. 標籤 API

- [x] 3.1 `GET /materials/tags`：聚合租戶素材的 distinct tags
- [x] 3.2 建立/更新素材時支援寫入 `tags`（route zod 驗證陣列）

## 4. 列表篩選與排序

- [x] 4.1 `GET /materials` 擴充參數：`categoryId`、`tags`（hasSome）、`status`、`sort`（most_used/recent_used/updated/name）
- [x] 4.2 `listMaterials` service：組合 where（category/tags/channelType/status/keyword）+ 依 sort 決定 orderBy（never-used 排最後）
- [x] 4.3 回傳每筆帶 `lastUsedAt`、`usageCount`、`status`、`categoryId`、`tags`

## 5. 版本控制

- [x] 5.1 `createMaterial` / `updateMaterial` 成功後寫入 `MaterialVersion` 快照（versionNo 遞增，首建為 v1）
- [x] 5.2 `GET /materials/:id/versions`：列版本歷史（新到舊，含 editor/時間）
- [x] 5.3 `POST /materials/:id/versions/:versionNo/restore`：把該版 name/body 寫回 Material 並產生新版（還原＝一次新編輯）
- [x] 5.4 版本查詢/還原走 tenantPrisma，驗租戶隔離

## 6. 素材級成效

- [x] 6.1 素材彙總：`GET /materials/:id`（或 `/stats`）回傳 usageCount / lastUsedAt / 回覆數（join BroadcastRecipient.replied）/ 開案數（caseId not null）
- [x] 6.2 無點擊歸因資料時回傳明確「暫無資料」標記（非 0）
- [x] 6.3 列表使用率長條：以租戶內最大 usageCount 正規化

## 7. 前端：列表頁

- [x] 7.1 左側分類樹元件（巢狀、可點篩選、顯示每分類數量）
- [x] 7.2 標籤篩選 chips（來自 `/materials/tags`，可多選）
- [x] 7.3 排序切換下拉（最近使用/使用次數/更新時間/名稱）
- [x] 7.4 表格新增欄：狀態徽章（草稿/已核准）、版本號、使用率＋長條、最後使用時間（null 顯示「—」）
- [x] 7.5 `useMaterials` hook 接上新篩選/排序參數

## 8. 前端：分類/標籤管理與版本

- [x] 8.1 分類 CRUD UI（新增/改名/搬移/刪除，搬移循環擋在前端也給提示）
- [x] 8.2 素材編輯頁：categoryId 選擇器 + tags 輸入 + status 手動切換（marketing.manage）
- [x] 8.3 素材詳情/編輯頁：版本歷史面板 + 還原按鈕（還原前確認）

## 9. 驗證與收尾

- [x] 9.1 跨租戶隔離測試：新表（category/version）綁 A 看不到 B（比照 rls-isolation.test）
- [x] 9.2 分類搬移循環擋測試、刪分類不刪素材測試
- [x] 9.3 版本快照/還原端到端測試（編輯→產版→還原→產新版）
- [x] 9.4 `openspec validate --strict` 通過
- [x] 9.5 更新 `CHANGELOG.md`（Added：素材庫治理——分類/標籤/版本/成效）
