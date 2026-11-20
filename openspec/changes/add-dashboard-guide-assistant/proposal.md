## Why

Demo 租戶的知識庫有 206 篇 Open333 操作說明。客人在 WebChat 或 LINE 問「怎麼做」時，AI 回覆步驟與連結。後台的員工沒有同樣的工具：員工要自己找到功能頁，再自己找到要填的欄位。

這個 change 在後台加一個助理。員工問「怎麼設定關鍵字自動回覆」時，助理做三件事：

1. 依本租戶的知識庫回答步驟。
2. 提供「帶我去」按鈕。
3. 員工按下按鈕後，畫面切到功能頁，點開入口（例如「新增」），再用聚光框標示要填的欄位。

助理不替員工送出或儲存資料。員工自己填寫、自己儲存。

## What Changes

- 新增共用的導覽目錄 `packages/shared/src/guide/guide-catalog.ts`。每條導覽有功能頁路徑、需要的權限碼與步驟。步驟只有兩種動作：「點開」與「標示」。最後一步一定是「標示」。
- 在導覽用到的按鈕與欄位上加 `data-guide` 屬性。只加屬性，不改元件的行為。
- 新增 `POST /api/v1/ai/guide-assistant/ask`：檢索本租戶的知識庫，呼叫 LLM，回傳答案、來源文章與導覽。導覽只從操作者有權限的導覽中選。
- 新增權限碼 `assistant.use`（feature `knowledge`）。三個系統角色預設都有。
- 後台每一頁的右下角新增助理按鈕與側邊面板。面板顯示答案與「帶我去」按鈕。員工按下按鈕後，前端才執行導覽。
- `AiFeature` 新增 `guide-assistant`。

## Capabilities

### New Capabilities

- `dashboard-guide-assistant`：後台助理的問答、導覽的選擇規則、導覽目錄的安全規則、前端執行導覽的行為。

### Modified Capabilities

- `ai-usage-recording`：呼叫來源標記新增 `guide-assistant`。

## Platform layer

- **新增權限碼**：`assistant.use` 的 feature 是 `knowledge`，路由以 `requirePermission('assistant.use')` 保護。方案沒有 `knowledge` 時，方案天花板擋下這個權限。部署後執行 `scripts/grant-new-role-permissions.mjs assistant.use`，再清除 Redis 的 `perms:*` 快取。
- **呼叫 AI 模型**：助理以 `generateReply()` 呼叫 LLM。`generateReply()` 檢查月額度、套用租戶的 AI 隱私政策，並以 `recordLlmUsage()` 記錄 `feature: 'guide-assistant'`。知識庫檢索沿用 `searchArticlesByTextFlow()`，Gemini 向量化的用量記為 `embedding`。模型沿用租戶的 Chat 設定，所以不需要新的價格列。
- 其他列不適用：這個 change 不新增功能區、方案上限、渠道類型、租戶設定、平台稽核動作、佇列，也不新增租戶與平台之間的申請。

## Impact

- API：`apps/api/src/modules/ai/guide-assistant.{routes,flow,service}.ts`、`apps/api/src/modules/ai/llm.service.ts`（`AiFeature`）、`apps/api/src/guards/rbac.guard.ts`（讀取請求者的有效權限）、`apps/api/src/index.ts`（註冊路由）。
- 共用：`packages/shared/src/guide/`、`packages/shared/src/rbac/permissions.ts`、`packages/shared/src/rbac/default-roles.ts`。
- 前端：`apps/web/src/components/ai/`（面板、導覽執行、聚光框）、`apps/web/src/app/dashboard/layout.tsx`，以及導覽用到的頁面（只加 `data-guide` 屬性）。
- 不在範圍內：助理替員工寫入資料（建立規則、貼標籤等）。之後另開 change。
