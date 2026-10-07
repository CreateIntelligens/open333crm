# 渠道管理

渠道是租戶與客人溝通的管道：一個 LINE 官方帳號、一個 Facebook 粉絲專頁、一個網站聊天室，各是一個渠道。管理員在「設定 → 渠道管理」新增渠道、填入憑證、設定 webhook，並決定哪些團隊看得到這個渠道。

- **資料來源**：`apps/api/src/modules/channel/*`、`apps/api/src/modules/webhook/*`、`apps/api/src/index.ts`、`packages/database/prisma/schema.prisma`、`apps/web/src/components/settings/ChannelManagement.tsx`
- **核對日期**：2026-09-30

## 負責的程式

| 程式 | 負責什麼 |
| --- | --- |
| `channel.routes.ts`、`channel.service.ts` | 渠道的 CRUD、驗證憑證、webhook 網址、狀態檢查、網站聊天室的嵌入碼與外觀、團隊授權 |
| `line-webhook-setup.service.ts` | 呼叫 LINE API，把 webhook 網址設到 LINE 官方帳號上 |
| `fb-token-monitor.service.ts` | 檢查 Facebook 粉絲專頁的 access token 是否仍有效。只在查詢渠道狀態時執行，沒有排程 |
| `webchat-embed.service.ts` | 產生網站聊天室的嵌入碼 |
| `webhook` 模組 | 接收渠道平台送來的事件，見[租戶後台](./README.md#一則訊息進來之後) |
| `packages/channel-plugins` | 各渠道的收發實作。API 在 `index.ts` 以 `registerChannelPlugin()` 註冊 |

## 支援的渠道類型

各渠道的外掛怎麼實作、訊息進站與送出怎麼經過外掛，見[渠道外掛](../../modules/CHANNEL-PLUGINS.md)。

`schema.prisma` 的 `ChannelType` 列舉的類型中，只有註冊了外掛的才能實際使用：

| 類型 | 建立渠道 | 註冊外掛 | 收訊息 |
| --- | --- | --- | --- |
| `LINE` | 可以 | 有 | `/api/v1/webhooks/line/:channelId` |
| `FB` | 可以 | 有 | `/api/v1/webhooks/fb/:channelId` |
| `THREADS` | 可以 | 有 | `/api/v1/webhooks/threads/:channelId` |
| `WEBCHAT` | 可以 | 有 | 網站聊天室 widget，見下方 |
| `WHATSAPP` | 可以 | 沒有 | 沒有路由 |
| `TELEGRAM` | 不行 | 沒有 | 沒有路由 |

WhatsApp 渠道可以建立，但收不到訊息也送不出去。見 `../../system/AUDIT.md` 的 APP-02。

## 新增渠道

`createChannel()` 依序：

1. 檢查方案允許的渠道類型（`Plan.allowedChannelTypes`）。
2. 檢查方案的渠道數上限（`maxChannels`），只計算啟用中的渠道。
3. 決定可見的成員（`visibleAgentIds`）：有送就用送來的成員，每一位都要是本租戶啟用中的成員，否則回 400 並且不建立渠道；沒有送就是所有啟用中的成員。
4. 以 `CREDENTIAL_ENCRYPTION_KEY` 加密憑證後存入 `credentialsEncrypted`。
5. 產生公開金鑰（`publicKey`），網站聊天室以它識別渠道。
6. 組出 webhook 網址並存入 `webhookUrl`：`<API 位址>/api/v1/webhooks/<類型>/<渠道 ID>`。
7. 把渠道直綁給第 3 步的成員（`AgentChannelAccess`，`full`）。

`POST /channels` 在同一個交易內建立渠道與綁定；建立者沒有 `channel.view_all` 又不在 `visibleAgentIds` 裡時，自動加入建立者。前端的新增渠道表單與精靈列出所有啟用中的成員，預設全選；全選時不送 `visibleAgentIds`。見[誰看得到這個渠道](#誰看得到這個渠道)。Facebook 登入連結粉專（Meta 串接）建立的渠道一律綁給所有啟用中的成員；這條路徑不在交易內，寫入綁定失敗時刪除剛建立的渠道。

目前的種子方案都沒有填這兩個方案欄位，因此渠道的類型與數量實際上都不受限，見 `../../system/AUDIT.md` 的 PLAN-07。另外，停用的渠道重新啟用時不會再檢查數量上限。

各類型需要的憑證：

| 類型 | 必填憑證 |
| --- | --- |
| LINE | `channelSecret`、`channelAccessToken` |
| Facebook | `appSecret`、`pageAccessToken` |
| WebChat | 不需要 |

## Webhook

渠道平台要把事件送到 `webhookUrl`，系統才收得到訊息：

| 端點 | 作用 |
| --- | --- |
| `POST /channels/:id/setup-webhook` | 呼叫 LINE API，自動把 webhook 網址設到 LINE 官方帳號 |
| `POST /channels/webhook-base-url` | 更換 API 的對外位址時，重算租戶所有渠道的 `webhookUrl` |
| `POST /channels/:id/verify` | 以目前的憑證呼叫渠道平台，確認憑證有效 |
| `GET /channels/:id/status` | 渠道的連線狀態。Facebook 會另外檢查 token 是否過期 |

**轉發給下游系統。** 渠道設定的 `settings.downstreamWebhook` 可以把收到的原始 webhook 轉發給另一個網址，例如租戶自己的另一套機器人。規則如下：

- 網址必須是 HTTPS，而且不能指向內網位址。
- `mode` 決定在本系統處理前（`immediate`）或處理後（`after`）轉發。
- 轉發的是原始內容與原始簽章，下游可以自己驗簽。
- 每個事件的 ID 記在 Redis 一段時間。下游若把同一個事件送回來，系統不會再轉發一次，避免無限迴圈。

## 渠道設定

`Channel.settings` 是 JSON，放各種依渠道而不同的設定：

| 鍵 | 用途 | 說明 |
| --- | --- | --- |
| `botConfig` | 機器人的行為 | 見[收件匣與對話](./INBOX.md#機器人什麼時候回覆) |
| `firstContactGreeting` | 聯絡人第一次進站時的招呼語 | 空字串代表不送 |
| `downstreamWebhook` | 轉發給下游 | 見上方 |
| `liffId` | LINE LIFF 的 ID | 短連結靠它辨識點擊者，見[短連結](./SHORTLINKS.md) |

## 網站聊天室

WebChat 渠道提供一段嵌入碼，貼到租戶的網站上就會出現聊天視窗。

| 端點 | 作用 |
| --- | --- |
| `GET /channels/:id/embed-code` | 產生嵌入碼 |
| `POST /channels/:id/chatbox-link` | 產生給指定網域使用的聊天連結 |
| `PATCH /channels/:id/chatbox-theme`、`POST /channels/:id/chatbox-theme/background` | 聊天視窗的外觀與背景圖 |

訪客的訊息走 `/api/v1/webchat` 與 `/api/v1/chatbox`，屬於對外端點，見[模組總覽](../../modules/OVERVIEW.md#對外端點)。

## 誰看得到這個渠道

渠道可以授權給團隊，並指定層級（`full`、`reply_only`、`read_only`）：

| 端點 | 作用 |
| --- | --- |
| `GET`、`POST /channels/:channelId/teams`、`DELETE /channels/:channelId/teams/:teamId` | 查詢、新增、移除某渠道授權的團隊 |
| `GET /channels/teams/:teamId/channels` | 某團隊能看的渠道 |
| `GET /channels/assignable`、`GET /channels/teams` | 授權畫面的選項 |

也可以直接授權給個別成員，這在人員管理頁設定，見[人員與角色](./MEMBERS.md)。

沒有授權給任何團隊或成員的渠道，只有持有 `channel.view_all` 的成員（總店）看得到。所以新增渠道時就要決定誰看得到：表單與精靈列出所有啟用中的成員，預設全選。2026-10-05 之前，沒有授權的渠道所有成員都看得到；當時既有的這類渠道已由 migration `20261005120000_backfill_unbound_channel_access` 綁給所有啟用中的成員。可見範圍怎麼套用在收件匣與工單，見[收件匣與對話](./INBOX.md#誰看得到哪些對話)。

## 停用與刪除

| 動作 | 端點 | 結果 |
| --- | --- | --- |
| 停用 | `PATCH /channels/:id` 帶 `isActive: false` | 渠道保留。停用的渠道不收發訊息，也不出現在可見範圍 |
| 刪除 | `DELETE /channels/:id` | 硬刪除 |

`AGENTS.md` 規定渠道要以 `isActive: false` 軟刪除，但 `deleteChannel()` 是硬刪除。已經有對話的渠道，因為外鍵不允許，刪除會失敗並回一般的伺服器錯誤；沒有對話的渠道，刪除時聯絡人在這個渠道的身分也一併刪除。見 `../../system/AUDIT.md` 的 CHAN-01。

刪除會寫一筆 `channel.delete` 租戶稽核紀錄。

## 權限

| 動作 | 權限 |
| --- | --- |
| 讀取渠道 | `channel.view` |
| 新增 | `channel.create` |
| 修改、驗證、設定 webhook、嵌入碼與外觀 | `channel.update` |
| 刪除 | `channel.delete` |
| 團隊授權 | `channel.assign_team` |

`GET /channels/:id` 回傳的憑證經過遮罩，不會回傳明文。

渠道清單會依成員的可見範圍過濾；持有 `channel.view_all` 的成員看得到全部。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **刪除是硬刪除，有對話的渠道刪不掉** | 詳見 `../../system/AUDIT.md` 的 CHAN-01 |
| WhatsApp 渠道可以建立但無法使用 | 詳見 `../../system/AUDIT.md` 的 APP-02 |
| **自動化在 Instagram 私訊與網站聊天室送不出訊息** | workers 只註冊 LINE 與 FB 外掛。詳見 `../../system/AUDIT.md` 的 CHAN-02 |
| 方案沒有限制渠道類型與數量 | 重新啟用也不檢查數量。詳見 `../../system/AUDIT.md` 的 PLAN-07 |
| Facebook token 沒有定期檢查 | 只有查詢狀態時才檢查，token 過期前不會通知 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
