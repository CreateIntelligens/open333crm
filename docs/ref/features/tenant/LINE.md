# LINE 工具

側欄「渠道」底下是 LINE 官方帳號專用的工具：圖文選單（Rich Menu）、關鍵字回覆與快速回覆。渠道本身的新增與設定不在這裡，見[渠道管理](./CHANNELS.md)。

- **資料來源**：`apps/api/src/modules/line/*`、`apps/workers/src/handlers/rich-menu-bind.handler.ts`、`apps/web/src/app/dashboard/line/*`、`apps/web/src/components/inbox/MessageInput.tsx`
- **核對日期**：2026-09-30

## 負責的程式

| 頁面 | 程式 | 權限 |
| --- | --- | --- |
| LINE Rich Menu | `line` 的 `rich-menu.routes.ts`、`rich-menu.service.ts`；分眾綁定由 workers 的 `rich-menu-bind.handler.ts` 執行 | `richmenu.manage`（整個 plugin） |
| LINE 關鍵字回覆 | `automation` 模組，見[自動化](./AUTOMATION.md#關鍵字回覆) | `automation.view`、`automation.manage` |
| LINE 快速回覆 | `line` 的 `quick-reply-preset.routes.ts`、`quick-reply-preset.service.ts` | 讀取只驗登入；新增、修改、刪除需要 `quickreply.manage` |

側欄的「渠道」選單要求 `richmenu.manage` 才顯示。因此只有 `automation.manage` 或 `quickreply.manage`、沒有 `richmenu.manage` 的成員，在側欄找不到關鍵字回覆與快速回覆的入口。

## 圖文選單

圖文選單是 LINE 聊天室下方的選單。每個選單屬於一個 LINE 渠道，由一張背景圖與多個可點擊區域組成。

### 生命週期

| 狀態 | 意思 |
| --- | --- |
| `draft` | 只存在於本系統，LINE 上沒有 |
| `published` | 已在 LINE 建立，`lineRichMenuId` 記錄 LINE 給的 ID |
| `error` | 發布過程失敗 |

**發布**（`POST /line/rich-menus/:id/publish`）依序呼叫 LINE API：

1. 建立選單，取得 `lineRichMenuId`。失敗時狀態改成 `error`。
2. 上傳背景圖。失敗時刪除剛建立的選單，狀態改成 `error`。
3. 選單的 `selected` 為 `true` 時，設為這個渠道的預設選單，並取消原本的預設。這一步失敗不算發布失敗，只記 warning；管理員可以到 LINE 官方帳號後台手動設定。

**下架**（`POST /line/rich-menus/:id/unpublish`）先取消預設，再從 LINE 刪除選單，狀態回到 `draft`。LINE 回 404 時視為已經不存在，照樣清掉本地狀態。

只有 `draft` 狀態的選單可以修改。已發布的選單要改內容，先下架、修改、再發布，或用「複製」建立新的草稿。`error` 狀態的選單不能修改，但可以重新發布。

### 分眾綁定

預設選單對所有人生效。要讓特定一群人看到另一個選單，用分眾綁定：

| 動作 | 端點 | 對象 |
| --- | --- | --- |
| 綁定 | `POST /line/rich-menus/:id/bind-audience` | 一個分群，或一個標籤 |
| 解除綁定 | `POST /line/rich-menus/:id/unbind-audience` | 同上 |

API 把分群或標籤解析成這個渠道的 LINE uid 清單，送進 `rich-menu-bind` queue 就回應。workers 分批呼叫 LINE 的批次綁定 API，避免一次送太多撞到 LINE 的頻率限制。

綁定是當下的快照：只綁定操作當時符合條件的人。之後才加入分群或被貼標的人，不會自動綁定。系統也不記錄誰被綁到哪個選單，綁定的狀態只存在 LINE 端。

## 快速回覆

快速回覆是訊息下方的一排按鈕，客人點了就送出按鈕上的文字。快速回覆組合（`QuickReplyPreset`）是預先存好的一組按鈕：

- 屬於租戶，不綁渠道，所有 LINE 渠道共用。
- 項目數、標籤與文字的長度上限依 LINE 規格，寫在 `quick-reply-preset.service.ts`。
- 客服在收件匣的輸入框（`MessageInput.tsx`）選一組，附在這次回覆的訊息上一起送出。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 分眾綁定只綁當下符合條件的人 | 之後加入的人不會自動綁定，系統也不記錄綁定狀態 |
| 設預設選單失敗只記 warning | 介面顯示已發布，但選單可能不是預設 |
| 側欄入口只看 `richmenu.manage` | 只有其他兩個權限的成員找不到關鍵字回覆與快速回覆 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
