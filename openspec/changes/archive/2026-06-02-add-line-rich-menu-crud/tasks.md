## 1. DB Schema

- [ ] 1.1 在 `packages/database/prisma/schema.prisma` 新增 `RichMenu` model（欄位見 spec：id / tenantId / channelId / name / chatBarText / size / selected / areas / imageUrl / status / lineRichMenuId / publishedAt / createdAt / updatedAt）
- [ ] 1.2 加 `@@index([tenantId, channelId])` 與 `@@index([tenantId, status])`
- [ ] 1.3 加 Tenant 與 Channel 的反向關聯 `richMenus RichMenu[]`
- [ ] 1.4 產 migration：`pnpm --filter @open333crm/database exec prisma migrate dev --name add_rich_menus --create-only` 並檢視 SQL
- [ ] 1.5 套用 migration：`prisma migrate dev`
- [ ] 1.6 Prisma client 重新生成

## 2. 版型靜態定義

- [ ] 2.1 在 `apps/web/src/components/line/rich-menu/layouts.ts` 定義 10 種版型（id / size / defaultAreas）
- [ ] 2.2 每個版型補上中文 label 與 SVG 縮圖（或用 CSS Grid 線稿）
- [ ] 2.3 在 `apps/api/src/modules/line/rich-menu/layouts.ts` 同步一份（後端驗證用，型別共用）

## 3. Backend Service

- [ ] 3.1 新增檔案 `apps/api/src/modules/line/rich-menu.service.ts`
- [ ] 3.2 實作 `listRichMenus(prisma, tenantId, channelId)` — 必帶 channelId，回 record 陣列
- [ ] 3.3 實作 `getRichMenu(prisma, id, tenantId)` — 跨 tenant 回 404
- [ ] 3.4 實作 `createRichMenu(prisma, tenantId, data)` — 驗證 channelId 屬於本 tenant 且 channelType=LINE、驗證 size 在白名單、驗證 areas 結構、status 強制 `draft`
- [ ] 3.5 實作 `updateRichMenu(prisma, id, tenantId, data)` — 守衛 status=draft 才允許 update（為 Louis 接手預留）
- [ ] 3.6 實作 `deleteRichMenu(prisma, id, tenantId)` — 守衛 status=draft 才允許 delete
- [ ] 3.7 實作 `duplicateRichMenu(prisma, id, tenantId)` — 複製欄位、新 id、name 加「（副本）」、status 重設為 draft、清空 lineRichMenuId/publishedAt
- [ ] 3.8 加 action 結構驗證 helper：`validateAction(action)` 依 type 校驗必填欄位

## 4. Backend Routes

- [ ] 4.1 新增檔案 `apps/api/src/modules/line/rich-menu.routes.ts`
- [ ] 4.2 加 `requireSupervisor()` preHandler 守衛
- [ ] 4.3 用 zod 寫 `createRichMenuSchema` / `updateRichMenuSchema`（size enum、5 種 action 的 discriminated union）
- [ ] 4.4 註冊 6 個 endpoints：GET `/`、POST `/`、GET `/:id`、PATCH `/:id`、DELETE `/:id`、POST `/:id/duplicate`
- [ ] 4.5 在 `apps/api/src/index.ts` 註冊 routes：`fastify.register(richMenuRoutes, { prefix: '/api/v1/line/rich-menus' })`

## 5. Image Upload Integration

- [ ] 5.1 沿用既有 `POST /api/v1/files/upload` 端點上傳到 MinIO（不需新端點）
- [ ] 5.2 在 `rich-menu.service.ts` 加 `validateImage(buffer, expectedSize)`：用 sharp 或 image-size 取得實際尺寸做 pixel 級比對
- [ ] 5.3 在 createRichMenu / updateRichMenu 內，若 imageUrl 變更則 fetch 圖片驗證尺寸（或讓前端先驗證 + 後端再驗一次）
- [ ] 5.4 加 mime / size 驗證錯誤碼：`INVALID_IMAGE_FORMAT` / `IMAGE_SIZE_MISMATCH` / `IMAGE_TOO_LARGE`

## 6. Frontend Hooks

- [ ] 6.1 新增檔案 `apps/web/src/hooks/useRichMenus.ts`：`useRichMenus(channelId)` + `useRichMenu(id)`
- [ ] 6.2 加 `createRichMenu` / `updateRichMenu` / `deleteRichMenu` / `duplicateRichMenu` 函數
- [ ] 6.3 type 定義 `RichMenu` / `RichMenuArea` / `RichMenuAction`（與 LINE 官方結構對齊）

## 7. Frontend - 路由與導航

- [ ] 7.1 新增頁面 `apps/web/src/app/dashboard/line/layout.tsx`（含 Topbar + OA 切換器 + Tab 列）
- [ ] 7.2 新增頁面 `apps/web/src/app/dashboard/line/rich-menus/page.tsx`（列表）
- [ ] 7.3 新增頁面 `apps/web/src/app/dashboard/line/rich-menus/new/page.tsx`（建立 — 先選版型）
- [ ] 7.4 新增頁面 `apps/web/src/app/dashboard/line/rich-menus/[id]/page.tsx`（編輯）
- [ ] 7.5 修改 `apps/web/src/components/layout/Sidebar.tsx`：新增「LINE 管理」群組與「Rich Menu」子項，AGENT 角色不顯示

## 8. Frontend - OA 切換器與 Tabs

- [ ] 8.1 新增元件 `components/line/OaSwitcher.tsx`：下拉，列 active LINE channels；URL 同步 ?channelId=xxx
- [ ] 8.2 新增元件 `components/line/LineModuleTabs.tsx`：Rich Menu (active) / Quick Reply / 歡迎訊息 / 加好友自動回應（後三者 disabled）
- [ ] 8.3 OA 切換時呼叫 router.replace 帶上新 channelId，並觸發 SWR mutate

## 9. Frontend - 列表頁

- [ ] 9.1 元件 `components/line/rich-menu/RichMenuCard.tsx`：縮圖 + 名稱 + 狀態 badge + 操作選單
- [ ] 9.2 元件 `components/line/rich-menu/RichMenuList.tsx`：網格佈局、空狀態
- [ ] 9.3 列表頁整合：useRichMenus(channelId) + 「+ 建立 Rich Menu」按鈕

## 10. Frontend - 版型選擇器

- [ ] 10.1 元件 `components/line/rich-menu/LayoutPicker.tsx`：10 種版型卡片（按大選單 / 小選單分組）
- [ ] 10.2 每張卡顯示縮圖 + label，hover 顯示尺寸提示
- [ ] 10.3 點選後 router.push 到 `/dashboard/line/rich-menus/new?layoutId=xxx&channelId=xxx`

## 11. Frontend - 編輯頁主體

- [ ] 11.1 元件 `components/line/rich-menu/RichMenuEditor.tsx`：左右雙欄佈局
- [ ] 11.2 左欄上：name / chatBarText / selected 表單
- [ ] 11.3 左欄中：背景圖上傳（沿用 CompactImageField 模式，呼叫 /files/upload）
- [ ] 11.4 左欄下：區域列表，每個區域可展開設定 action
- [ ] 11.5 底部固定 footer：[取消] [儲存草稿]
- [ ] 11.6 取消時若 isDirty 顯示 confirm dialog

## 12. Frontend - 區域 Action 編輯器

- [ ] 12.1 元件 `components/line/rich-menu/AreaActionEditor.tsx`
- [ ] 12.2 Type 下拉：postback / message / uri / datetimepicker / richmenuswitch
- [ ] 12.3 依 type 動態渲染欄位（用 discriminated union 確保型別安全）
- [ ] 12.4 richmenuswitch 顯示警告提示「目標 Rich Menu 需先 publish」
- [ ] 12.5 即時驗證欄位長度（postback data ≤300、label ≤20 等）

## 13. Frontend - 預覽元件

- [ ] 13.1 元件 `components/line/rich-menu/RichMenuPreview.tsx`：背景圖 + 區域熱區疊層（半透明邊框）
- [ ] 13.2 hover 區域時高亮（背景半透明 emerald）
- [ ] 13.3 顯示每個區域編號（中央 badge）
- [ ] 13.4 縮放適應容器（保持 size 寬高比）

## 14. 串接與驗證

- [ ] 14.1 端到端測試：建立 → 列表看見 → 編輯 → 儲存 → 複製 → 刪除
- [ ] 14.2 多 OA 切換測試：切換時 URL 同步、清單刷新
- [ ] 14.3 AGENT 權限測試：登入後不應看到 LINE 管理群組、API 直接打回 403
- [ ] 14.4 圖片驗證測試：上傳尺寸不符 / 格式不符 / 超大檔
- [ ] 14.5 zod schema 邊界測試：5 種 action 各自的必填／長度限制

## 15. 文件與交接

- [ ] 15.1 在 README 或內部 wiki 註記：本期 Rich Menu 僅做 CRUD，publish 流程由 Louis 接手
- [ ] 15.2 留 inline 註解標出 service 層 `status=draft` 守衛與 Louis 介接點
- [ ] 15.3 OpenAPI / Postman collection（若有）補上 6 個新 endpoint
