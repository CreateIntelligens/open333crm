## Why

#337 階段 4 的第一批：把 `line` 模組的圖文選單（`rich-menu`）與 LINE 個人資料（`line-profile`）改成入口開交易（AGENTS.md 結構規則 2）。這兩個 service 只被自己的路由 import，所以可以先搬。

圖文選單的發布要呼叫 LINE API，現在的寫法是先呼叫 LINE、最後才寫資料庫，沒有並行控制。這造成下列問題：

- LINE 上建好選單之後，寫資料庫失敗時，LINE 上的選單成為孤兒，資料庫也沒有記錄它的 id。
- 同一個選單同時發布兩次時，兩個請求都通過狀態檢查，LINE 上建出兩個選單。
- 同一個渠道的兩個選單同時設為預設時，「取消全體預設」與「設預設」交錯執行，最後的預設選單不確定。
- 設預設失敗時只記 warn。資料庫記成預設，LINE 上卻沒有預設選單。
- 分眾綁定的背景工作不看資料庫。工作晚到時，可能把客人綁到已經下架的選單。
- 發布預設選單前，先取消全體預設，再設新的預設。設預設失敗時，所有好友都失去選單。取消發布時也直接取消全體預設，不確認 LINE 目前的預設是不是這個選單。
- `selected` 一個欄位有兩個意思：LINE 的 `selected` 是「聊天室打開時展開選單」，open333 又拿它當「所有好友的預設選單」。勾了預設的選單一定展開，沒勾的一定收合，管理員不能分開設定。line-oa-laravel 踩過同樣的坑，之後拆成 `is_default` 與 `is_select` 兩個欄位。

line-oa-laravel 的圖文選單以「交易外建立、交易失敗就刪除、commit 之後依序執行 LINE 動作」處理同樣的問題。這個 change 採用它的核心做法，改用 repo 現有的認領與 advisory lock。

## What Changes

- 發布改成三段：交易 1 認領選單（狀態改成 `publishing`），交易外呼叫 LINE，交易 2 寫入結果。
  - 認領失敗時回 HTTP 409。同一個渠道已有其他選單在發布中時，也回 409。
  - LINE 建好選單之後，任何一步失敗，系統刪除剛建立的 LINE 選單，並把狀態改成 `error`。
  - 停在 `publishing` 超過 5 分鐘的選單（例如處理程序中途結束），可以重新發布。
  - 設預設時不先取消全體預設，由 LINE 以新選單取代舊的預設。設預設失敗時，舊的預設選單不受影響；新選單仍發布，但不記成預設，回應帶警告。
- 取消發布改成：交易外呼叫 LINE，交易內以條件更新寫回 `draft`。取消預設前先查 LINE 目前的預設，是這個選單才取消。
- **BREAKING（API 欄位）** 新增 `isDefault`（所有好友的預設選單），`selected` 改回 LINE 的原意（聊天室打開時展開選單）。migration 以現有的 `selected` 填入 `isDefault`。編輯頁拆成兩個選項。
- 分眾綁定與解除綁定改由 flow 寫進 outbox，至少送出一次。workers 執行綁定前，先確認選單仍已發布，而且 LINE 端的選單 id 沒有變；不符合時跳過。
- LINE 個人資料的同步改成：交易 1 讀渠道與身分，交易外呼叫 LINE，交易 2 寫入。
- 圖文選單的列表頁把 `publishing` 顯示成「發布中」，`error` 的選單可以重新發布。
- 不在範圍：LINE 與資料庫的定期對帳（#457），以及 alias 與排程上下架。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `line-rich-menu`：
  - 修改「Rich Menu 草稿內容欄位」：新增 `isDefault`，`selected` 改為展開狀態；`status` 加上 `publishing`、`error`，`lineRichMenuId`、`publishedAt` 由發布流程寫入（MODIFIED）。
  - 修改「Default Rich Menu」：預設選單改看 `isDefault`；取消發布時只在 LINE 的預設是這個選單時才取消（MODIFIED）。
  - 新增「圖文選單展開狀態」（ADDED）。
  - 新增發布的保證：最多建立一次、同一個渠道同時只有一個選單在發布中、中斷或失敗後可以重新發布、設預設失敗時保留原本的預設（ADDED）。
  - 新增「背景綁定只綁到仍在發布中的選單」（ADDED）。

`line-contact-profile-sync` 的行為不變，沒有 delta。

## Impact

- 後端：`apps/api/src/modules/line/`（新增 `rich-menu.flow.ts`、`line-profile.flow.ts`），`rich-menu.routes.ts`、`line-profile.routes.ts` 改呼叫 flow。
- workers：`apps/workers/src/handlers/rich-menu-bind.handler.ts` 執行綁定前先查資料庫。
- 前端：`apps/web/src/app/dashboard/line/rich-menus/`（列表、新建、編輯頁）、`apps/web/src/components/line/rich-menu/RichMenuEditor.tsx`、`apps/web/src/hooks/useRichMenus.ts`、`apps/web/src/lib/rich-menu-confirm.ts`。
- API：
  - `POST /api/v1/line/rich-menus`、`PATCH .../:id`：新增 `isDefault`；`selected` 改為展開狀態。回應同時帶兩個欄位。只有本 repo 的前端呼叫這些 API，與前端同一個 PR 修改。
  - `POST /api/v1/line/rich-menus/:id/publish`：新增 HTTP 409 `PUBLISH_IN_PROGRESS`；設預設失敗時回 200，回應帶警告。
  - `POST .../bind-audience`、`.../unbind-audience`：Redis 無法使用時改回 200，由 outbox-relay 補送。
- 資料庫：一個 migration，`rich_menus` 新增 `isDefault`，以 `selected` 填入。`status` 是字串欄位，`publishing` 不需要改 schema；「停在 `publishing` 多久」以 `updatedAt` 判斷。
- 部署：搬遷前送出、還在佇列裡的綁定工作沒有選單 id，workers 照舊執行，不做檢查。
