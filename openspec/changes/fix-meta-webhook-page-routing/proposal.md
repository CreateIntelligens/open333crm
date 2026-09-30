## Why

2026-09-30 在 UAT 實測跨渠道綁定時發現：FB／IG webhook 只依網址上的 `channelId` 決定訊息屬於哪個渠道，完全不看 payload 裡的 `entry.id`（FB 粉專 ID／IG 專業帳號 ID）。

一個 Meta App 的 Page webhook 只能設一個回呼網址。UAT 上兩個不同粉專（Open333test、創造智能）共用 Meta App 671495162407854，回呼網址指向「創造智能」渠道，結果：

- **跨租戶資料錯置**：Open333test 顧客的訊息被寫進創造智能租戶，該租戶客服在收件匣看得到別的租戶顧客的訊息，自動化／AI 也套在這些顧客身上（已在 UAT 實際發生）。
- **回覆全部失敗**：AI 用創造智能粉專的 token 回覆屬於 Open333test 的 PSID，Meta 拒收，顧客收不到回覆（即長期未解的「UAT FB 收到訊息但 AI 沒回」）。
- **驗簽擋不住**：兩個租戶填的是同一個 App Secret，任一租戶的事件都能通過另一租戶渠道的驗簽；且共用 App 代表每個租戶都握有能偽造其他租戶 webhook 的金鑰。
- 同一粉專在同一租戶建兩筆渠道時，只有回呼網址指向的那筆收得到訊息，另一筆永遠無聲。

SaaS 化後多個客戶的粉專一定會接在同一個 Meta App 上，照現行分派方式必然錯置。

## What Changes

**第 1 階段 — 依粉專 ID 分派（止血）**
- FB／IG 插件解析 webhook 時帶出 `accountId`（= `entry.id`），並檢查 payload `object`（FB `page`、IG `instagram`）。
- `processWebhookEvent` 驗簽後依 `accountId` 分組，每組以「渠道類型＋外部帳號 ID」找出真正的渠道與租戶，各自用該渠道的憑證與租戶處理。
- 安全檢查：目標渠道的 App Secret 必須與驗簽所用的相同（同一個 Meta App），否則丟棄。
- 找不到對應渠道時丟棄，不寫進網址指定的租戶；在網址渠道記下「收到不屬於本渠道的帳號事件」警示，後台渠道管理看得到（不只寫 log）。
- 過渡相容：網址渠道尚未取得外部帳號 ID、且沒有其他渠道認領該帳號時，維持舊行為並記警示，避免部署當下既有渠道全部斷線。
- 下游轉發（downstream webhook）只在整包 payload 都屬於網址渠道時才轉發，避免把別的租戶的事件轉出去。

**第 2 階段 — 外部帳號 ID 明文欄位＋唯一限制**
- `Channel` 新增 `externalAccountId`（nullable），`@@unique([channelType, externalAccountId])`：同一個粉專／IG 帳號在全平台只能連結一次（跨租戶、同租戶皆然）。
- 渠道驗證（`verifyChannel`）自動寫入：FB 取 `/me` 的 `id`（粉專 ID）；IG **改取 `user_id`**（IG 專業帳號 ID，才是 webhook `entry.id` 的值；目前取的 `id` 是 App 範圍的使用者 ID，錯的）。
- 建立／更新／驗證遇到重複時回 409 `CHANNEL_ACCOUNT_ALREADY_LINKED`（中文訊息），不讓第二筆建立成功。
- 回填腳本：既有 FB／IG 渠道逐一驗證取得外部帳號 ID，先偵測重複並列出，不自動處理衝突。
- 前端：FB 粉專 ID 欄位改為驗證後自動帶入並唯讀顯示；渠道卡片顯示已連結的帳號 ID 與分派警示。
- 附帶修正：`fb-token-monitor` 寫回 settings 改用原子更新，避免蓋掉系統維護欄位。

**第 3 階段 — 平台持有 Meta App，租戶用 Facebook 登入連粉專**
- 平台方以 env 設定唯一的 Meta App（App ID、App Secret、webhook 驗證權杖）；新增平台級 webhook 端點 `/api/v1/webhooks/meta`（不帶 channelId，依 `object` 與 `entry.id` 分派，用平台 App Secret 驗簽）。
- 租戶在渠道管理按「用 Facebook 連結粉專」→ Facebook Login for Business 授權（`pages_show_list`、`pages_manage_metadata`、`pages_messaging`）→ 列出其管理的粉專 → 勾選後系統建立渠道、取得長效 Page token、呼叫 `POST /{page-id}/subscribed_apps` 訂閱。租戶不再填 App ID／App Secret／驗證權杖。
- OAuth state 存 Redis（綁定租戶、操作者、一次性），不沿用現有 fb-login 的程序內 Map（多實例會失效）。
- 既有「自備 App」渠道保留並繼續可用（相容模式），不強制遷移。
- IG 走 Facebook Login（`instagram_manage_messages`，經粉專連結的 IG 帳號、`graph.facebook.com/{PAGE_ID}/messages`）與現行 IG Login 路線不同，列為第 3 階段後段，另行評估。

**Meta 端前置（需平台方在 Meta 後台完成，非程式碼）**：平台 App 建立 Facebook Login for Business 設定、上述權限的進階存取送審（含操作錄影）、商業驗證、App 切換為 Live。審查通過前僅 App 管理員／測試者自己管理的粉專能授權。

## Capabilities

### New Capabilities
- `meta-page-connect`: 平台持有的 Meta App、租戶以 Facebook 登入授權連結粉專、平台級 webhook 端點。

### Modified Capabilities
- `channel-plugins`: FB／IG webhook 依 `entry.id` 分派渠道與租戶；外部帳號 ID 明文存放並全平台唯一；IG 帳號 ID 改取 `user_id`。
- `threads-channel`: IG 渠道驗證取得並保存 IG 專業帳號 ID。

## Impact

- **資料庫**：`channels` 加欄位與唯一索引（新 migration；既有 RLS policy 不需改；唯一索引為全域檢查，屬預期行為）。建索引前須確認既有資料無重複（UAT：Open333test 粉專在同一租戶有 test333、Demo Facebook 兩筆，需先停用其一並清空其外部帳號 ID）。
- **API**：`webhook.service.ts`、`webhook.routes.ts`、`channel.service.ts`、`channel.routes.ts`、`fb-token-monitor.service.ts`；第 3 階段新增 `modules/meta-connect/`（加入 `check-prisma-admin-usage.mjs` 白名單）。
- **插件**：`packages/channel-plugins` 的 `ParsedWebhookMessage` 加 `accountId`，FB／IG `parseWebhook`。
- **前端**：`ChannelFormDialog`、`ChannelWizard`、`ChannelFieldGuide`、`ChannelManagement`；第 3 階段新增連結粉專流程。
- **部署**：migration → 回填腳本 → 確認無衝突；第 3 階段需新增平台 env 並在 Meta 後台改回呼網址為 `/webhooks/meta`。
- **不在範圍**：WhatsApp、LINE（LINE 每個 OA 各自設 webhook，無此問題）。
