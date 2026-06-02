## Why

LINE 官方帳號的「Rich Menu」是聊天視窗底部的固定選單，是 OA 與用戶最高曝光的 UI 觸點。客戶（行銷／營運）目前需要進 LINE 官方後台手動建立、上傳、設定區域 action，操作分散且無法在 CRM 內統一管理多個 OA。

本次先建立 **CRM 內的 Rich Menu 草稿管理介面（CRUD）**，讓使用者用 10 種官方版型快速建立、預覽、編輯 Rich Menu。實際與 LINE Messaging API 的對接（publish / set default / delete）由 Louis 後續迭代補上，本次只負責「資料模型 + 編輯介面 + 草稿狀態」這層。

## What Changes

- 新增頂層導航群組「LINE 管理」，預留 quick-replies / welcome-messages 等未來子功能空間
- 新增 `/dashboard/line/rich-menus` 列表頁 + Tab 列上方的多 LINE OA 切換器
- 新增「建立 Rich Menu」流程：先選版型（10 種固定）→ 上傳背景圖（MinIO）→ 編輯各區域 action
- 支援 5 種區域 action：`postback` / `message` / `uri` / `datetimepicker` / `richmenuswitch`
- 預覽元件：背景圖 + 區域熱區疊層，與 LINE 實際渲染對齊
- 列表頁顯示縮圖（背景圖）、名稱、狀態（本期僅 `draft`）、最後更新時間
- 編輯／刪除／複製 Rich Menu 草稿
- **預留欄位** `lineRichMenuId`、`publishedAt`、`status` enum（`draft` / `published` / `error`）給 Louis 後續實作 publish 流程
- **不做**：與 LINE API 的互動（建立 richmenu、上傳圖檔、set default、unpublish）— Louis 負責
- **不做**：自訂拖拉版型、分群投放、排程切換、user-specific richmenu
- 後續若要砍：Rich Menu 草稿模型不影響任何現有功能（純新增）

## Capabilities

### New Capabilities
- `line-rich-menu`: LINE Rich Menu 的草稿管理 — 列表 / CRUD / 版型選擇 / 區域 action 編輯 / 預覽。不含與 LINE API 的 publish 互動（後續迭代由 Louis 接手）。

### Modified Capabilities
（無 — 純新增功能，不修改既有 capability requirements）

## Impact

**新增**
- 前端模組 `apps/web/src/app/dashboard/line/`、`apps/web/src/components/line/rich-menu/`
- 左側導航新增「LINE 管理」群組（`Sidebar` 元件）
- 後端模組 `apps/api/src/modules/line/rich-menu.*.ts`
- Prisma model `RichMenu`
- DB migration（新表 `rich_menus`）
- 6 個 REST endpoints：`GET / POST / GET:id / PATCH:id / DELETE:id /:id/duplicate`（前綴 `/api/v1/line/rich-menus`）
- 前端 hook `useRichMenus`、`useRichMenu`

**依賴**
- 沿用既有 MinIO storage layer（不需新依賴）
- 沿用既有 `requireSupervisor()` 權限守衛
- 沿用 Channel 模型（`channelType = LINE` 過濾）

**不影響**
- Material 系統、Broadcast、Inbox、自動化規則皆不受影響
- 不影響任何既有 LINE 渠道連線設定（仍在「設定 > 渠道」管理）
