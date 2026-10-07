## 1. 測試

測試名稱以情境名稱開頭。這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 3 節）。違反情境的 2 個問題記錄在 `AUDIT.md`，修正前沒有測試。

情境同時適用 `/api/v1/chatbox/*` 與 `/api/v1/webchat/:channelId/*` 兩組路由時，每組路由各有一個測試。

測試檔的簡稱：

- `routes`：`apps/api/tests/unit/modules/webchat/webchat-public-routes.test.ts`
- `limits`：`apps/api/tests/unit/modules/chatbox/chatbox-public-limits.test.ts`
- `socket`：`apps/api/tests/unit/modules/webchat/visitor-socket.test.ts`
- `keys`：`apps/api/tests/unit/modules/webchat/public-webchat-limits.test.ts`（既有測試）
- `delivery`：`apps/api/tests/unit/modules/conversation/webchat-visitor-delivery.test.ts`
- `widget`：`apps/widget/tests/unit/widget.test.ts`
- `wsock`：`apps/widget/tests/unit/socket.test.ts`
- `page`：`apps/web/tests/unit/app/chatbox/chatbox-page.test.tsx`

**`webchat-public-abuse-controls`**

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 舊的工作階段路由預設停用 | 以預設設定呼叫舊的工作階段路由 | `routes` |
| 舊的工作階段路由預設停用 | 啟用舊的工作階段路由 | `routes` |
| 公開請求的大小限制 | 文字訊息超過 4000 個字元 | `limits` |
| 公開請求的大小限制 | 訊息請求的 body 超過 128 KB | `routes` |
| 公開請求的大小限制 | 上傳的檔案類型不支援 | `limits` |
| 公開請求的大小限制 | 上傳的檔案超過大小上限 | `limits` |
| 工作階段的有效期限最長三天 | 設定的有效期限超過三天 | `limits` |
| 工作階段的有效期限最長三天 | 建立工作階段時的有效期限 | `limits` |
| 訊息與上傳請求的頻率限制 | 同一個來源 IP 的訊息超過每分鐘上限 | `routes` |
| 訊息與上傳請求的頻率限制 | 同一個工作階段的訊息超過每分鐘上限 | `routes` |
| 訊息與上傳請求的頻率限制 | 同一個渠道的訊息超過每分鐘上限 | `routes` |
| 訊息與上傳請求的頻率限制 | 同一個工作階段的訊息超過每小時上限 | `routes` |
| 訊息與上傳請求的頻率限制 | 同一個渠道的訊息超過每小時上限 | `routes` |
| 訊息與上傳請求的頻率限制 | 上傳超過每分鐘上限 | `routes` |
| 訊息與上傳請求的頻率限制 | 訊息達到來源 IP 的上限後仍可上傳 | 沒有測試：webchat 路由違反（AUDIT CHAN-05） |
| 建立工作階段與訪客 socket 連線的頻率限制 | 同一個來源 IP 建立工作階段超過上限 | `routes` |
| 建立工作階段與訪客 socket 連線的頻率限制 | 同一個來源 IP 的訪客 socket 連線超過上限 | `socket` |
| 頻率限制的計數鍵與日誌不含原始的工作階段憑證 | 以工作階段計數 | `keys`；`routes` 的日誌測試也檢查計數鍵是摘要 |
| 頻率限制的計數鍵與日誌不含原始的工作階段憑證 | 請求因頻率限制被拒絕 | `routes` |

**`webchat-widget`**

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| Visitor session initialization | First-time visitor loads widget | `widget` |
| Visitor session initialization | Same tab reloads widget | `widget` |
| Visitor session initialization | Two tabs open the same widget | `widget`（與上一個情境同一個測試：widget 每次載入的行為相同） |
| Visitor session initialization | Session API returns greeting | `widget` |
| Visitor session initialization | Chatbox mode uses session id instead of visitor token | `page` |
| Visitor message sending | Visitor sends a text message | `widget`、`routes`、`limits` |
| Visitor message sending | Visitor sends an image | `widget`、`routes`、`limits` |
| Visitor message sending | Visitor sends a video | `widget`、`limits` |
| Visitor message sending | Invalid visitorToken | `routes` |
| Visitor message sending | Session belongs to another channel | `routes` |
| Visitor message sending | Message send fails | 沒有測試：widget 違反（AUDIT CHAN-04） |
| Visitor message sending | File too large | `widget` |
| Real-time message delivery to visitor | Widget connects with the claimed session | `wsock`、`widget` |
| Real-time message delivery to visitor | Verified socket joins the session room | `socket` |
| Real-time message delivery to visitor | Agent replies to visitor | `delivery`、`widget` |
| Real-time message delivery to visitor | Bot replies to visitor | `delivery` |
| Real-time message delivery to visitor | Visitor Socket.IO auth fails | `socket` |

- [x] 1.1 寫上表的測試
- [x] 1.2 `apps/widget` 新增開發相依套件 `jsdom`，讓 `widget` 測試在 DOM 環境執行

## 2. 文件

- [x] 2.1 `docs/ref/system/AUDIT.md` 新增 CHAN-04、CHAN-05
- [x] 2.2 `docs/ref/system/AUDIT-REVIEWS.md` 新增複查紀錄

## 3. 突變驗證

每個突變改壞一處或多處程式，執行對應的測試，確認測試失敗後還原。

| 檔案 | 突變 | 抓到的測試 |
| --- | --- | --- |
| `webchat.routes.ts` | 舊路由一律啟用 | 以預設設定呼叫舊的工作階段路由 |
| `webchat.routes.ts` | 舊路由啟用後仍回 410 | 啟用舊的工作階段路由 |
| `webchat.routes.ts` | 舊路由轉傳 visitorToken | 啟用舊的工作階段路由 |
| `webchat.routes.ts` | webchat 訊息 body 上限放寬 | 訊息請求的 body 超過 128 KB（webchat） |
| `chatbox.routes.ts` | chatbox 訊息 body 上限放寬 | 訊息請求的 body 超過 128 KB（chatbox） |
| `chatbox.registry.ts` | 文字上限放寬 | 文字訊息超過 4000 個字元 |
| `chatbox.registry.ts` | 文字上限收緊 | 文字訊息超過 4000 個字元 |
| `webchat.service.ts` | 上傳不檢查類型 | 上傳的檔案類型不支援 |
| `webchat.service.ts` | 圖片套用影片的上限 | 上傳的檔案超過大小上限 |
| `webchat.service.ts` | 影片不檢查大小 | 上傳的檔案超過大小上限 |
| `webchat.service.ts` | 剛好等於上限也拒絕 | 上傳的檔案超過大小上限 |
| `env.ts` | 環境變數不限有效期限 | 設定的有效期限超過三天 |
| `chatbox.service.ts` | 有效期限不封頂 | 建立工作階段時的有效期限 |
| `webchat.routes.ts` | 只拿掉路由自己的 IP 計數 | 存活（預期）：外掛以相同上限先擋下 |
| `webchat.routes.ts` | 只停用外掛的每路由上限 | 存活（預期）：路由自己的 IP 計數以相同上限擋下 |
| `webchat.routes.ts` | webchat 訊息不限 IP | 同一個來源 IP 的訊息超過每分鐘上限（webchat） |
| `chatbox.routes.ts` | chatbox 訊息不限 IP | 同一個來源 IP 的訊息超過每分鐘上限（chatbox） |
| `webchat.routes.ts` | webchat 訊息不限工作階段 | 同一個工作階段的訊息超過每分鐘上限（webchat） |
| `chatbox.routes.ts` | chatbox 訊息不限工作階段 | 同一個工作階段的訊息超過每分鐘上限（chatbox） |
| `webchat.routes.ts` | webchat 訊息不限渠道 | 同一個渠道的訊息超過每分鐘上限（webchat） |
| `chatbox.routes.ts` | chatbox 訊息不限渠道 | 同一個渠道的訊息超過每分鐘上限（chatbox） |
| `webchat.routes.ts` | webchat 不限工作階段每小時 | 同一個工作階段的訊息超過每小時上限（webchat） |
| `chatbox.routes.ts` | chatbox 不限工作階段每小時 | 同一個工作階段的訊息超過每小時上限（chatbox） |
| `webchat.routes.ts` | webchat 不限渠道每小時 | 同一個渠道的訊息超過每小時上限（webchat） |
| `chatbox.routes.ts` | chatbox 不限渠道每小時 | 同一個渠道的訊息超過每小時上限（chatbox） |
| `webchat.routes.ts` | webchat 上傳不限 IP | 上傳超過每分鐘上限（webchat） |
| `chatbox.routes.ts` | chatbox 上傳不限 IP | 上傳超過每分鐘上限（chatbox） |
| `webchat.routes.ts` | webchat 上傳不限工作階段 | 上傳超過每分鐘上限（webchat） |
| `chatbox.routes.ts` | chatbox 上傳不限工作階段 | 上傳超過每分鐘上限（chatbox） |
| `public-webchat-limits.ts` | 計數區間結束後不重新計算 | `public-webchat-limits.test.ts`（既有測試） |
| `chatbox.routes.ts` | chatbox 建立工作階段不限次數 | 建立工作階段超過上限（chatbox） |
| `webchat.routes.ts` | 舊路由建立工作階段不限次數 | 建立工作階段超過上限（舊的工作階段路由） |
| `webchat.socket.ts` | socket 連線不限次數 | 訪客 socket 連線超過上限 |
| `public-webchat-limits.ts` | 計數鍵不做摘要 | `public-webchat-limits.test.ts`（既有測試） |
| `webchat.routes.ts` | webchat 日誌帶 sessionId | 請求因頻率限制被拒絕（webchat） |
| `chatbox.routes.ts` | chatbox 日誌帶 claim token | 請求因頻率限制被拒絕（chatbox） |
| `webchat.routes.ts` | webchat 不寫 warn 日誌 | 請求因頻率限制被拒絕（webchat） |
| `chatbox.routes.ts` | chatbox 日誌不帶請求 ID | 請求因頻率限制被拒絕（chatbox） |
| `webchat.routes.ts` | webchat 訊息不檢查渠道 | Session belongs to another channel |
| `webchat.routes.ts` | webchat 上傳不檢查渠道 | Session belongs to another channel |
| `webchat.routes.ts` | webchat 訊息不要求 claim token | Invalid visitorToken（webchat） |
| `chatbox.routes.ts` | chatbox 訊息不要求 claim token | Invalid visitorToken（chatbox） |
| `webchat.routes.ts` | webchat 上傳不要求 claim token | Invalid visitorToken（webchat） |
| `chatbox.routes.ts` | chatbox 上傳不要求 claim token | Invalid visitorToken（chatbox） |
| `webchat.routes.ts` | webchat 路由不轉交訊息 | Visitor sends a text message（webchat） |
| `webchat.routes.ts` | 上傳改用請求帶的工作階段 | Visitor sends an image（webchat） |
| `chatbox.service.ts` | 進站處理用請求的租戶 | Visitor sends a text message |
| `chatbox.service.ts` | 進站處理用請求的對話 | Visitor sends a text message |
| `webchat.socket.ts` | socket 房間採用 auth 的值 | Verified socket joins the session room |
| `webchat.socket.ts` | socket 不要求 claim token | Visitor Socket.IO auth fails |
| `webchat.socket.ts` | socket 驗證失敗仍放行 | Visitor Socket.IO auth fails |
| `conversation.service.ts` | 客服回覆送錯房間 | Agent replies to visitor |
| `conversation.service.ts` | 客服回覆不推給訪客 | Agent replies to visitor |
| `conversation.service.ts` | 機器人回覆不發布 | Bot replies to visitor |
| `conversation.service.ts` | 機器人回覆用錯渠道的身分 | Bot replies to visitor |
| `index.ts` | widget 把 sessionId 存進 sessionStorage | First-time visitor loads widget |
| `session.ts` | widget 送 visitorToken | First-time visitor loads widget |
| `index.ts` | widget 重用上一個工作階段 | Same tab reloads widget |
| `index.ts` | widget 不顯示問候語 | Session API returns greeting |
| `index.ts` | widget 文字訊息不帶 claim token | Visitor sends a text message |
| `index.ts` | widget 上傳不帶 claim token | Visitor sends an image |
| `index.ts` | widget 媒體訊息類型錯誤 | Visitor sends a video |
| `index.ts` | widget 不檢查檔案大小 | File too large |
| `index.ts` | widget 不檢查檔案類型 | File too large |
| `index.ts` | widget 不顯示 agent:message | Agent replies to visitor |
| `socket.ts` | widget socket 不帶 claim token | Widget connects with the claimed session |
| `page.tsx` | chatbox 頁面 socket 不帶 claim token | Chatbox mode uses session id instead of visitor token |
| `page.tsx` | chatbox 頁面建立訪客 token | Chatbox mode uses session id instead of visitor token |

68 個突變中，66 個讓測試失敗。存活的 2 個在預期內。訊息路由自己的來源 IP 計數，與同一條路由的 `@fastify/rate-limit` 上限都是每分鐘 30 次。只拿掉其中一個時，另一個以相同的上限擋下請求，行為不變。兩個都拿掉時（「webchat 訊息不限 IP」），測試失敗。

頻率限制的上限互相重疊，例如驗證通過的工作階段一定先碰到每小時的上限。因此測試除了檢查 429，也從 warn 日誌的計數鍵確認擋下請求的是情境指的那一個上限。

- [x] 3.1 執行上表的突變，除了預期存活的 2 個，每個突變都讓對應的測試失敗

## 4. 歸檔

- [x] 4.1 `pnpm test` 通過；`node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs restore-webchat-abuse-specs` 通過，以 `pnpm exec openspec archive` 歸檔
- [x] 4.3 改寫新主規格 `webchat-public-abuse-controls` 的 Purpose
