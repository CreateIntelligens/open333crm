## Why

docs/ref/system/AUDIT.md RBAC-01（issue #197）：權限碼早已定義，但工單、對話、標籤、短連結四個模組的 45 條路由都沒有 `requirePermission`，只要登入就能操作。租戶在「角色與權限」設定的限制在這些模組完全不生效，例如沒有刪除權限的成員仍可永久刪除工單，只能檢視的角色仍可送訊息給客人。聯絡人模組已在 #185 補上，這次補齊其餘四個模組。

## What Changes

每條路由掛上對應的權限碼（權限碼與說明見 `packages/core/src/rbac/permissions.ts`）：

| 模組 | 路由 | 權限碼 |
| --- | --- | --- |
| 工單 | `GET /cases`、`/cases/categories`、`/cases/stats`、`/cases/:id`、`/cases/:id/events` | `case.view` |
| 工單 | `POST /cases`、`POST /cases/from-conversation/:conversationId`、`POST /conversations/:id/case` | `case.create` |
| 工單 | `PATCH /cases/:id`、`POST /cases/:id/tags`、`DELETE /cases/:id/tags/:tagId`、`POST /cases/:id/notes`、`/resolve`、`/close`、`/reopen`、`/csat`、`POST /cases/:id/conversations/:conversationId/link` | `case.update` |
| 工單 | `PATCH /cases/:id` 帶 `assigneeId` 或 `teamId` 時另需；`POST /cases/:id/assign` | `case.assign` |
| 工單 | `PATCH /cases/:id` 把狀態改為 `ESCALATED` 時另需；`POST /cases/:id/escalate` | `case.escalate` |
| 工單 | `DELETE /cases/:id` | `case.delete` |
| 對話 | `GET /conversations`、`/conversations/:id`、`/conversations/:id/messages`、`POST /conversations/:id/read` | `inbox.view` |
| 對話 | `POST /conversations/:id/messages`、`/send-image`、`/send-video`、`/typing` | `inbox.reply` |
| 對話 | `PATCH /conversations/:id`、`POST /conversations/:id/close`、`/handoff`、`POST /conversations/:id/tags`、`DELETE /conversations/:id/tags/:tagId` | `inbox.manage` |
| 標籤 | `GET /tags` | `tag.view` |
| 標籤 | `POST /tags`、`PATCH /tags/:id`、`DELETE /tags/:id` | `tag.manage` |
| 短連結 | `GET /shortlinks`、`/:id`、`/:id/stats`、`/:id/clicks`、`/:id/qrcode` | `shortlink.view` |
| 短連結 | `POST /shortlinks`、`PATCH /shortlinks/:id`、`DELETE /shortlinks/:id` | `shortlink.manage` |

工單與對話路由原有的渠道可見範圍與存取層級檢查（CM-173）保留，權限碼檢查疊加在前。

## Capabilities

### Modified Capabilities

- `case-management`、`core-inbox`：路由依權限碼授權。

## Impact

- `apps/api/src/modules/{case,conversation,tag,shortlink}/*.routes.ts`
- 上線影響：UAT（目前唯一的部署環境）3 個租戶的所有角色都具備上表 13 個權限碼，13 個權限碼都屬於 `inbox` 功能模組、5 種方案都包含，上線後不會有既有成員被擋。新租戶的系統角色由種子資料提供，同樣具備。
- 系統預設的 `agent` 角色目前含 `case.delete`，上線後客服仍可刪除工單，行為不變；是否收回由產品另行決定。
