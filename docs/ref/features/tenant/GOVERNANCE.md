# 稽核、資料權利與對外整合

這一組功能有 API、沒有後台頁面，要透過 CLI、MCP 或直接呼叫 API 使用：查詢租戶的操作紀錄、匯出租戶資料、刪除單一客人的個人資料、把系統事件推送給外部系統，以及讓 AI 工具以 MCP 操作租戶資料。

- **資料來源**：`apps/api/src/modules/tenant-audit/*`、`apps/api/src/modules/data-export/*`、`apps/api/src/modules/data-erasure/*`、`apps/api/src/modules/webhook-subscriptions/*`、`apps/api/src/modules/mcp/*`、`apps/workers/src/handlers/data-export.handler.ts`、`apps/workers/src/handlers/data-erasure.handler.ts`
- **核對日期**：2026-09-30

## 負責的模組

| 功能 | 模組 | 路由前綴 | 權限 |
| --- | --- | --- | --- |
| 租戶稽核日誌 | `tenant-audit` | `/api/v1/tenant/audit-logs` | `audit.view` |
| 資料匯出 | `data-export` | `/api/v1/tenant/data-export` | `data.export` |
| 資料刪除 | `data-erasure` | `/api/v1/tenant/data-erasure` | `data.erase` |
| 對外 Webhook | `webhook-subscriptions` | `/api/v1/webhook-subscriptions` | `webhook.view`、`webhook.manage` |
| MCP | `mcp` | `/mcp` | 帶 `mcp:read` scope 的 CLI token，再依工具檢查 scope |

## 租戶稽核日誌

各模組在重要操作後呼叫 `writeTenantAudit()`，寫入操作者、動作、對象、`payload` 與 IP。`GET /tenant/audit-logs` 可以依動作、操作者與時間區間查詢，每頁最多 100 筆。

目前會寫稽核的動作：

| 範圍 | 動作 |
| --- | --- |
| 成員 | `agent.create`、`agent.role.assign`、`agent.password.reset`、`agent.deactivate`、`agent.purge`、`agent.channels.set` |
| 角色 | `role.permission.update` |
| 渠道 | `channel.create`、`channel.delete`、`channel.assign_team`、`channel.revoke_team` |
| 設定 | `settings.update`，`payload.section` 記錄是哪一類設定 |
| 資料 | `contact.merge`、`case.delete`、`data.export.request`、`data.erasure.request` |

`payload` 刻意不放個人資料，例如合併聯絡人只記兩個 ID。

**沒有寫稽核的重要操作**：登入成功與失敗、Passkey 的註冊與刪除、API 金鑰與 CLI token 的建立和撤銷、修改渠道（包括更換憑證）、角色的建立、改名與刪除、送出群發、自動化規則的增刪改。其中長效憑證與渠道憑證的變更，事後完全無法追查。見 `../../system/AUDIT.md` 的 AUD-01。

稽核紀錄沒有保留期限，也沒有清除排程。

## 資料匯出

匯出整個租戶的聯絡人、對話、訊息與工單，用於資料可攜或備份。

1. `POST /tenant/data-export` 建立一筆 `pending` 的申請，寫稽核，把工作送進 `data-export` queue，立刻回應。
2. workers 的 `data-export.handler.ts` 分頁讀出資料，打包成 zip：每種資料一份 JSON（保留關聯）與一份 CSV（攤平的主表），加上一份 `manifest.json`。
3. 上傳到物件儲存，申請改成 `completed`，並通知申請人。
4. `GET /tenant/data-export/:id` 查詢狀態；`GET /tenant/data-export/:id/download` 取得 15 分鐘有效的下載連結，並累計下載次數。
5. 匯出檔保留 7 天。workers 每小時檢查一次，刪除過期的檔案。

要知道的事：

- **`scope` 參數沒有作用。** 申請可以帶 `scope`，系統會存下來，但打包時不讀它，一律匯出聯絡人、對話、訊息與工單。
- **訊息全部讀進記憶體。** 打包時把租戶的所有訊息累積在一個陣列裡再寫成 JSON，訊息量大的租戶可能讓 workers 記憶體不足。
- **workers 連不上物件儲存時會失敗。** 開發環境的 workers 讀錯環境變數，見 `../../system/AUDIT.md` 的 STO-01。

## 資料刪除

刪除單一客人的個人資料，對應個資法與 GDPR 的被遺忘權。`POST /tenant/data-erasure` 帶 `contactId` 與模式，由 workers 的 `data-erasure.handler.ts` 執行。完成後更新申請狀態與受影響筆數、寫稽核、通知申請人。

| 模式 | 做什麼 |
| --- | --- |
| `anonymize`（預設） | 聯絡人的名稱改成佔位字串，清空頭像、電話與 email；刪除屬性、渠道身分、`IdentityMap` 與長期記憶；把客人傳進來的訊息內容換成 `{ redacted: true }`。對話與工單保留，報表數字不變 |
| `hard_delete` | 刪除聯絡人本身，以及他的對話、訊息、工單、積分、活動提交，並刪除物件儲存裡的媒體檔 |

**兩種模式都有沒涵蓋的資料：**

| 資料 | `anonymize` | `hard_delete` |
| --- | --- | --- |
| 客服回覆的訊息內容 | 保留 | 刪除 |
| 客人傳的圖片與檔案 | 保留檔案 | 刪除 |
| 活動提交的表單答案、積分 | 保留 | 刪除 |
| 工單標題、描述、備註與 CSAT 留言 | 保留 | 刪除 |
| 點擊紀錄（`ClickLog`，含 IP、User-Agent、LINE uid） | 保留 | 保留 |
| 群發收件紀錄、知識庫回報、Canvas 執行紀錄 | 保留 | 保留 |

最後一類資料表只存 `contactId`，沒有外鍵，兩種模式都不處理。見 `../../system/AUDIT.md` 的 ERASE-01。

## 對外 Webhook

租戶可以訂閱系統事件，事件發生時系統把事件 POST 到指定網址。

| 端點 | 作用 |
| --- | --- |
| `GET`、`POST /webhook-subscriptions` | 列出、建立訂閱 |
| `GET`、`PATCH`、`DELETE /webhook-subscriptions/:id` | 查看、修改、刪除訂閱 |
| `POST /webhook-subscriptions/:id/test` | 送一個測試事件 |

**怎麼送出。** `webhook-dispatcher.ts` 的 `setupWebhookDispatcher()` 在 API 行程訂閱 eventBus 的所有事件。事件發生時，找出同租戶、啟用中、而且訂閱了這個事件的網址，逐一送出：

- 內容是 `{ event, tenantId, timestamp, data }`，`data` 是事件的原始內容。
- 標頭帶 `X-Webhook-Signature: sha256=<HMAC>`、`X-Webhook-Event` 與 `X-Webhook-Delivery`。HMAC 以訂閱的 `secret` 計算；建立時沒給 `secret` 就自動產生。
- 目標網址指向內網位址時不送出。
- 單次逾時 10 秒，失敗重試兩次，間隔逐次拉長。重試在 API 行程內等待，API 重新啟動時尚未完成的重試會遺失。
- 每次送出寫一筆 `WebhookDelivery`。

**只收得到 API 行程 eventBus 上的事件。** 有些事件在介面或文件上存在，卻不會送出：`conversation.assigned` 與兩個 SLA 事件沒有發布端；從工單下拉選單改狀態不會發布事件。見 `../../system/AUDIT.md` 的 CONV-02、APP-05 與 CASE-01。

**事件名稱沒有白名單。** 訂閱時可以填任意字串，打錯的事件名稱不會報錯，只是永遠收不到。

讀取訂閱的端點會回傳 `secret`，持有 `webhook.view` 的成員就能看到簽章金鑰。

## MCP

`/mcp` 讓 AI 工具以 MCP（Model Context Protocol）操作租戶資料。`authenticateMcp()` 只接受帶 `mcp:read` scope 的 CLI token；只帶客服 JWT 的請求回 403。每個工具再各自檢查所需的 scope：

| 工具 | 作用 | 需要的 scope |
| --- | --- | --- |
| `crm_get_current_agent`、`crm_search_contacts`、`crm_get_contact`、`crm_list_cases`、`crm_get_case`、`crm_get_analytics_overview`、`crm_get_case_statistics` | 讀取 | `mcp:read` |
| `crm_line_list_conversations`、`crm_line_get_conversation`、`crm_line_search_contacts`、`crm_line_get_broadcast` | 讀取 LINE 對話與群發 | LINE 讀取 scope |
| `crm_line_direct_send` | 送一則 LINE 訊息。先預覽，再以 5 分鐘有效的確認 token 送出 | LINE 發送 scope |
| `crm_line_broadcast_initiate` | 建立 LINE 群發 | LINE 群發 scope |

scope 的常數定義在 `mcp.constants.ts`。工具只檢查 scope，不檢查成員的角色與方案，見 `../../system/AUDIT.md` 的 RBAC-02。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 重要操作沒有稽核 | 詳見 `../../system/AUDIT.md` 的 AUD-01 |
| 資料刪除沒有涵蓋所有個人資料 | 詳見 `../../system/AUDIT.md` 的 ERASE-01 |
| MCP 與 CLI 不受角色與方案限制 | 詳見 `../../system/AUDIT.md` 的 RBAC-02 |
| 匯出的 `scope` 參數沒有作用 | 一律匯出全部 |
| 匯出把所有訊息讀進記憶體 | 大租戶可能失敗 |
| 對外 Webhook 的重試在記憶體中等待 | API 重新啟動會遺失 |
| 對外 Webhook 的事件名稱沒有白名單 | 打錯不會報錯 |
| 沒有後台頁面 | 只能透過 CLI、MCP 或直接呼叫 API |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
