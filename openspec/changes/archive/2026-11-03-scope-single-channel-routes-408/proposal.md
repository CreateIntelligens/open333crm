## Why

issue #408（AUDIT RBAC-07）：渠道列表只回可見渠道，但單筆渠道路由不檢查渠道可見範圍。有 `channel.update` 或 `channel.delete`、沒有 `channel.view_all` 的分店成員，知道渠道 ID 就能讀取其他分店渠道的設定（含遮罩憑證與明文 `verifyToken`）、改名、停用、換 FB 權杖、刪除渠道。`POST /webhook-base-url` 會改寫全租戶每個渠道的 webhook 網址，分店成員也能呼叫。`GET /:id/embed-code` 只驗登入，沒有權限碼。

主規格 `channel-visibility-defaults` 已寫明看不到的渠道「在列表與單筆存取檢查都不可見」，但 `channel-scoped-visibility` 的單筆檢查只列對話、工單、聯絡人與群發，沒有渠道本身，也沒有規定渠道管理操作要什麼存取層級。

## What Changes

- 每條帶渠道 ID 的路由先檢查可見範圍：看不到（含不存在、已停用）回 404，與渠道列表一致。
- 存取層級跟著權限碼走：`channel.view` 的讀取（`GET /:id`、`/:id/status`、`/:id/embed-code`、`GET /:id/binding-handle`）要 `read_only`；`channel.update`／`channel.delete` 的管理操作（修改、刪除、測試連線、LIFF 測試與查結果、設定 webhook、WebChat 連結、WebChat 外觀與背景、修改導流識別）要 `full`。層級不足回 403 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`。
- `GET /:id/embed-code` 加上 `channel.view`（權限註冊表本來就寫 `channel.view` 涵蓋 embed-code）。
- `POST /webhook-base-url` 另需 `channel.view_all`：它改的是全租戶的設定，只改可見渠道會讓同租戶各渠道的網域不一致。前端沒有 `channel.view_all` 時不顯示套用欄位。
- 渠道與團隊的指派路由維持只看 `channel.assign_team`：這個權限本來就是全租戶的渠道指派權（與 `GET /assignable`、建立成員時的指派範圍一致）。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `channel-scoped-visibility`：新增渠道本身的單筆路由檢查與層級。
- `channel-management`：Webhook 公開網址只限總店。

## Impact

- `apps/api/src/modules/channel/channel.routes.ts`
- `apps/web/src/components/settings/ChannelManagement.tsx`
- 既有測試 `channel-liff-id.test.ts`、`channel-liff-test.test.ts` 的角色加上 `channel.view_all`：它們測的是 LIFF，不是可見範圍。
- 已停用的渠道對分店成員不可見（既有規則），所以分店成員無法重新啟用已停用的渠道，要由總店處理。
