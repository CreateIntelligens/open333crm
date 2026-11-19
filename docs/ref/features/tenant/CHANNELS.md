# 渠道管理

渠道是租戶與客人溝通的管道：一個 LINE 官方帳號、一個 Facebook 粉絲專頁、一個網站聊天室，各是一個渠道。管理員在「設定 → 渠道管理」新增渠道、填入憑證、設定 webhook，並決定哪些成員看得到這個渠道。

- **資料來源**：`apps/api/src/modules/channel/*`、`apps/api/src/modules/webhook/*`、`apps/api/src/index.ts`、`packages/database/prisma/schema.prisma`、`apps/web/src/components/settings/ChannelManagement.tsx`
- **核對日期**：2026-09-30

## 負責的程式

| 程式 | 負責什麼 |
| --- | --- |
| `channel.routes.ts`、`channel.service.ts` | 渠道的 CRUD、驗證憑證、webhook 網址、狀態檢查、網站聊天室的嵌入碼與外觀、團隊授權 |
| `line-webhook-setup.service.ts` | 呼叫 LINE API，把 webhook 網址設到 LINE 官方帳號上 |
| `fb-token-monitor.service.ts` | 查詢渠道狀態時，檢查 Facebook 粉絲專頁的 access token 是否仍有效 |
| `meta-token-health.ts` | 排程（id `meta-token-health`，每 6 小時）檢查所有啟用中的 FB 與 IG 渠道的權杖，結果寫進 `settings.tokenHealth`。權杖從有效變成失效時，通知該租戶所有啟用中的管理員（站內通知 `channel_token_invalid` 與 email），持續失效時每 3 天再提醒一次。網路錯誤或 Meta 限流時不改狀態、不通知 |
| `meta-connect` 模組 | 「用 Facebook 連結粉專」：管理員以 Facebook 登入、選擇粉專，系統以平台的 Meta App 建立渠道並訂閱粉專。粉專的權杖不回傳前端 |
| `webhook` 模組的 `webhook-account-routing.ts` | FB 與 IG 的事件依粉專或帳號 ID（`Channel.externalAccountId`）找出真正的渠道，見下方「Webhook」 |
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
| `GET`、`POST /api/v1/webhooks/meta` | 「用 Facebook 連結粉專」建立的渠道共用這個網址，事件依帳號 ID 分派 |

**FB 與 IG 依帳號 ID 分派。** 一個 Meta App 只能設一個回呼網址，多個粉專共用同一個 App 時，所有粉專的事件都送到同一個網址。系統依事件的帳號 ID（`entry.id`）找出真正的渠道，不只看網址上的 `channelId`：

1. 帳號 ID 等於網址渠道的 `externalAccountId`：交給網址渠道。
2. 其他渠道以相同的渠道類型與帳號 ID 認領：交給該渠道，但兩個渠道必須是同一個 Meta App，否則丟棄。
3. 沒有渠道認領，而且網址渠道還沒有 `externalAccountId`：照舊交給網址渠道，並在 `settings.webhookRouting` 記警示。
4. 沒有渠道認領，而且網址渠道已有不同的 `externalAccountId`：丟棄事件，並記警示。
| `POST /channels/webhook-base-url` | 更換 API 的對外位址時，重算租戶所有渠道的 `webhookUrl`，需 `channel.update` 與 `channel.view_all`（總店）。只收 `https` 網址，不可帶 `?`、`#` 或帳號密碼；畫面套用前會確認 |
| `POST /channels/:id/verify` | 以目前的憑證呼叫渠道平台，確認憑證有效 |
| `GET /channels/:id/status` | 渠道的連線狀態。Facebook 會另外檢查 token 是否過期。需要 `channel.view`，看不到的渠道回 404。只讀不寫，「最後驗證」只由 `verify` 更新；渠道管理頁只對啟用中的 FB 渠道呼叫 |

**轉發給下游系統。** 渠道設定的 `settings.downstreamWebhook` 可以把收到的原始 webhook 轉發給另一個網址，例如租戶自己的另一套機器人。規則如下：

- 網址必須是 HTTPS，而且不能指向內網位址。
- `mode` 決定在本系統處理前（`immediate`）或處理後（`after`）轉發。
- 轉發的是原始內容與原始簽章，下游可以自己驗簽。
- 每個事件的 ID 記在 Redis 一段時間。下游若把同一個事件送回來，系統不會再轉發一次，避免無限迴圈。

## 自備應用程式串接（內部作業）

客戶串 Facebook 一律用「用 Facebook 連結粉專」（平台 App，客戶手冊第 15 章第 5 節）。下面兩種手動填憑證的方式只給內部人員使用，2026-11-19 從客戶手冊移到這裡：

- Facebook 自備 Meta App：開發、測試，或客戶堅持用自己的 App 時用。
- Instagram 手動填權杖：Instagram 還沒有自助連結（`add-instagram-login-connect` 未開工），客戶手冊寫「聯繫客服」，由內部人員照這裡操作。

**先確認平台 App 的權限。** 2026-11-19 以 Meta 開發者工具查詢平台 App（創造智能，671495162407854）：已上線（Live），`pages_messaging`、`pages_manage_metadata`、`pages_show_list` 有進階存取，所以任何粉專管理員都能用「用 Facebook 連結粉專」；Instagram 的權限（`instagram_business_basic`、`instagram_business_manage_messages` 等）都沒有核准。沒有進階存取時，Meta 只讓在 App 上有角色的帳號授權（標準存取）。所以協助客戶串 IG 前，要先讓客戶的 IG 帳號在使用的 App 上有角色，否則產生不了權杖或收不到私訊。

### Facebook：自備 Meta App

三個欄位都在 Meta for Developers（`developers.facebook.com/apps`）該 App 裡：

| 欄位 | 位置 |
| --- | --- |
| App ID | 左側「應用程式設定」→「基本資料」→「應用程式編號」。建議填，權杖到期前系統才能提醒 |
| App Secret | 同一頁「應用程式密鑰」，按「顯示」、輸入密碼後複製。用來驗證 webhook 簽章 |
| Page Access Token | 左側「使用案例」→「透過 Messenger from Meta 與顧客互動」→「自訂」→「Messenger API 設定」→「2. 產生存取權杖」，在粉專那列按「產生」，複製 `EAA` 開頭的字串 |
| 粉專 ID | 不用填，按「測試連線」時寫入 `externalAccountId` |

1. 渠道管理 →「新增渠道」→ 類型選 Facebook，填上面三個欄位，選可見成員，儲存。
2. 按該列「測試連線」，成功後列上出現粉專 ID。
3. 打開「編輯渠道」，下方「Facebook Webhook 設定提示」有 webhook 網址與驗證權杖（Verify Token）。
4. 到該 App 的 Messenger Webhooks 設定：回呼網址貼 webhook 網址、驗證權杖貼 Verify Token，訂閱 `messages`、`messaging_postbacks`。

多個粉專共用同一個 App 沒關係，事件依粉專 ID 分派（見上方「Webhook」），所以每個渠道建好都要按一次「測試連線」。用這種方式連的粉專，在「用 Facebook 連結粉專」的清單裡會顯示「已用自備應用程式連結」並鎖住；權杖失效時要到 Meta 重新產生權杖，在「編輯渠道」只貼權杖欄（其他欄留空）、儲存、再按「測試連線」。

### Instagram：手動填權杖

接的是 Instagram 專業帳號的私訊。渠道類型選「Instagram (私訊)」（內部代號 `THREADS`），三個欄位都在 App →「使用案例」→「Instagram API」→「含有 Instagram 登入的 API 設定」：

| 欄位 | 位置 |
| --- | --- |
| Instagram 應用程式編號 | 這一頁上方的數字 |
| Instagram 應用程式密鑰 | 同一頁上方，按「顯示」後複製 |
| Instagram 存取權杖 | 同一頁「產生存取權杖」：按「新增帳號」登入 IG 專業帳號，再按該帳號的「產生權杖」，複製 `IG` 開頭的字串 |

1. 填好三個欄位，選可見成員，儲存。
2. 按「測試連線」，取得 IG 帳號 ID（寫入 `externalAccountId`，用的是 `user_id`）。
3. 「編輯渠道」下方「Instagram Webhook 設定提示」有 webhook 網址與驗證權杖。
4. 到 App 的 Instagram Webhooks 設定：回呼網址貼 webhook 網址、驗證權杖貼 Verify Token，訂閱 `messages`。
5. 請客戶在 Instagram「設定 → 訊息和限時動態回覆 → 訊息控制」打開「允許存取訊息」。

注意：

- 「Instagram 應用程式密鑰」不是「應用程式設定 → 基本資料」的 App Secret。填錯時驗簽失敗，一則訊息都收不到，畫面也沒有錯誤提示。
- 權杖要從「含有 Instagram 登入的 API 設定」產生；其他頁面給的是 Facebook 登入權杖，`graph.instagram.com` 會回 190。
- 帳號管理中心同時連著個人 IG 時，授權畫面可能預設個人帳號，要確認授權的是客戶的官方帳號。
- App 要是上線（Live）模式才收得到一般客人的私訊，開發模式只收得到在 App 上有角色的帳號。
- 編輯 IG 渠道時 webhook 網址下方寫「此為系統內部使用的 Webhook URL」，這句說明有誤，這個網址就是要貼到 Meta 的回呼網址。
- IG 權杖約 60 天到期，系統目前不會自動續期，`meta-token-health` 判定失效後要重新產生並貼上。

## 渠道設定

`Channel.settings` 是 JSON，放各種依渠道而不同的設定：

| 鍵 | 用途 | 說明 |
| --- | --- | --- |
| `botConfig` | 機器人的行為 | 見[收件匣與對話](./INBOX.md#機器人什麼時候回覆) |
| `firstContactGreeting` | 聯絡人第一次進站時的招呼語 | 空字串代表不送 |
| `downstreamWebhook` | 轉發給下游 | 見上方 |
| `tokenHealth` | FB、IG 權杖的檢查結果 | 由 `meta-token-health.ts` 寫入，渠道卡片顯示 |
| `webhookRouting` | webhook 分派警示 | 事件的帳號 ID 與網址上的渠道不符時寫入，渠道管理頁顯示給管理員 |
| `chatboxTheme` | 網站聊天室的外觀與背景圖 | 以 `PATCH /channels/:id/chatbox-theme` 與 `POST /channels/:id/chatbox-theme/background` 修改 |
| `bindingHandle`、`bindingHandleAuto` | 跨渠道綁定導流時顯示的帳號識別 | 驗證渠道時自動寫入 `bindingHandleAuto`；管理員以 `/channels/:id/binding-handle` 手動覆寫 `bindingHandle` |
| `liffConfig.loginChannelId` | LINE Login 的 channel ID | 優惠券票券夾驗證顧客的 LINE ID token 時使用 |
| `liffConfig.liffId` | LINE LIFF 的 ID | 短連結靠它辨識點擊者，見[短連結](./SHORTLINKS.md)。儲存時去頭尾空白並檢查格式（10 位數字、`-`、8 個英數字，例如 `1234567890-AbcdEfgh`），不符回 400；空字串表示清除 |

## 網站聊天室

WebChat 渠道提供一段嵌入碼，貼到租戶的網站上就會出現聊天視窗。

| 端點 | 作用 |
| --- | --- |
| `GET /channels/:id/embed-code` | 產生嵌入碼（`channel.view`） |
| `POST /channels/:id/chatbox-link` | 產生給指定網域使用的聊天連結 |
| `PATCH /channels/:id/chatbox-theme`、`POST /channels/:id/chatbox-theme/background` | 聊天視窗的外觀與背景圖 |

訪客的訊息走 `/api/v1/webchat` 與 `/api/v1/chatbox`，屬於對外端點，見[模組總覽](../../modules/OVERVIEW.md#對外端點)。

## 誰看得到這個渠道

渠道主要直接授權給個別成員，並指定層級（`full`、`reply_only`、`read_only`）。新增渠道的表單與精靈列出成員，人員管理頁也能改成員可用的渠道，見[人員與角色](./MEMBERS.md)。

渠道也可以授權給團隊。但系統沒有建立團隊與管理團隊成員的途徑，見 `../../system/AUDIT.md` 的 TEAM-01，所以團隊授權實際上用不到。團隊授權的端點：

| 端點 | 作用 |
| --- | --- |
| `GET`、`POST /channels/:channelId/teams`、`DELETE /channels/:channelId/teams/:teamId` | 查詢、新增、移除某渠道授權的團隊 |
| `GET /channels/teams/:teamId/channels` | 某團隊能看的渠道 |
| `GET /channels/assignable`、`GET /channels/teams` | 授權畫面的選項 |

沒有授權給任何團隊或成員的渠道，只有持有 `channel.view_all` 的成員（總店）看得到。所以新增渠道時就要決定誰看得到：表單與精靈列出所有啟用中的成員，預設全選。2026-10-05 之前建立、沒有授權的渠道，已由 migration `20261005120000_backfill_unbound_channel_access` 綁給所有啟用中的成員。可見範圍怎麼套用在收件匣與工單，見[收件匣與對話](./INBOX.md#誰看得到哪些對話)。

## 停用與刪除

| 動作 | 端點 | 結果 |
| --- | --- | --- |
| 停用 | `PATCH /channels/:id` 帶 `isActive: false` | 渠道保留。停用的渠道不收發訊息，也不出現在可見範圍 |
| 刪除 | `DELETE /channels/:id` | 硬刪除。仍被對話等資料參照時回 409 `CHANNEL_IN_USE` |

渠道管理頁每張卡片有「停用」與「啟用」按鈕。`AGENTS.md` 規定渠道要以 `isActive: false` 軟刪除，但 `deleteChannel()` 是硬刪除。已經有對話的渠道，因為外鍵不允許，刪除回 409 `CHANNEL_IN_USE` 並建議改用停用；沒有對話的渠道，刪除時聯絡人在這個渠道的身分也一併刪除。見 `../../system/AUDIT.md` 的 CHAN-01。

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
| 刪除是硬刪除，有對話的渠道只能停用 | 詳見 `../../system/AUDIT.md` 的 CHAN-01 |
| WhatsApp 渠道可以建立但無法使用 | 詳見 `../../system/AUDIT.md` 的 APP-02 |
| **自動化在網站聊天室送不出訊息** | workers 沒有網站聊天室外掛。詳見 `../../system/AUDIT.md` 的 CHAN-02 |
| 方案沒有限制渠道類型與數量 | 重新啟用也不檢查數量。詳見 `../../system/AUDIT.md` 的 PLAN-07 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。

## 單筆渠道路由的可見範圍

每條帶渠道 ID 的路由（`/:id` GET／PATCH／DELETE、`/verify`、`/liff-test`、`/setup-webhook`、`/status`、`/embed-code`、`/chatbox-link`、`/binding-handle`、`/chatbox-theme`、`/chatbox-theme/background`）都先以 `assertChannelVisible()` 檢查：看不到（含不存在、已停用）回 404。`channel.view` 的讀取要 `read_only`；`channel.update`／`channel.delete` 的管理操作要 `full`，不足回 403 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`。總店（`channel.view_all`）不受限制。渠道與團隊的指派路由只看 `channel.assign_team`（全租戶指派權），不看操作者的可見範圍。主規格：`channel-scoped-visibility`「單筆渠道路由的可見範圍」。
