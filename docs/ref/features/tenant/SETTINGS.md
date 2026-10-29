# 其他設定

「設定」頁有十幾個分頁，其中渠道、人員、角色、標籤與 SLA 各有專文。本文件說明剩下的分頁：一般設定、營業時間、追蹤設定、WebTalk 協作、API 金鑰、CLI 連線、Passkey 登入與 A2A。Chat 與 Embedding 設定在知識庫底下，見[知識庫與 AI](./KNOWLEDGE.md#ai-設定)。

- **資料來源**：`apps/api/src/modules/settings/*`、`apps/api/src/modules/auth/partner-api-key.service.ts`、`apps/api/src/modules/auth/cli-session.service.ts`、`apps/api/src/modules/auth/passkey.service.ts`、`apps/api/src/modules/webhook/inbound-side-effects.ts`、`apps/web/src/app/dashboard/settings/page.tsx`
- **核對日期**：2026-09-30

## 分頁與模組

分頁定義在 `settings/page.tsx` 的 `SETTINGS_TABS`：

| 分頁 | 模組 | 專文 |
| --- | --- | --- |
| 一般設定 | `agent` | 本文件 |
| 渠道管理 | `channel` | [渠道管理](./CHANNELS.md) |
| 人員管理、角色與權限 | `agent`、`role` | [人員與角色](./MEMBERS.md) |
| 標籤管理 | `tag` | [聯絡人與標籤](./CONTACTS.md#標籤) |
| SLA 政策 | `sla` | [服務水準協議](../SLA.md) |
| 營業時間、追蹤設定、API 金鑰、CLI 連線 | `settings` | 本文件 |
| Passkey 登入 | `auth` | 本文件 |
| A2A | `settings` | 本文件 |
| WebTalk 協作 | `webtalk` | 本文件 |

`settings` 模組在整個 plugin 掛了 `requirePermission("settings.manage")`，所以營業時間、追蹤設定、API 金鑰、CLI 連線、A2A，以及 Chat、Embedding 與自備金鑰的設定，全部需要 `settings.manage`。

租戶層級的設定存在 `TenantSettings`，一個租戶一列。這一列在第一次讀取任何設定時才建立，開通租戶時不會建立。

## 一般設定

名稱是一般設定，內容卻是個人設定：顯示自己的名稱、email 與角色，並修改自己的密碼（`PATCH /agents/me/password`，需要舊密碼）。這一頁不需要 `settings.manage`。

租戶層級的一般設定，例如對話閒置多久自動關閉（`inactivityCloseHours`），沒有任何頁面可以修改，見 `../../system/AUDIT.md` 的 CONV-01。

## 營業時間

營業時間決定客人在非營業時間傳訊息時，要不要自動回一則訊息。

| 欄位 | 說明 |
| --- | --- |
| `enabled` | 為 `false` 時一律視為營業中，不自動回覆 |
| `schedule` | 週一到週日各自的開始與結束時間（`HH:mm`）。某天沒有設定就是整天休息 |
| `holidays` | 休假日，格式 `YYYY-MM-DD`，整天視為非營業時間 |
| `outsideHoursMessage` | 非營業時間的自動回覆 |
| `timezone` | 判斷時間所用的時區，存在 `TenantSettings.timezone`，預設 `Asia/Taipei` |

`office-hours.service.ts` 的 `isWithinOfficeHours()` 依租戶時區換算現在時間後比對。

客人在非營業時間傳訊息時，進站管線最後一步 `sendOutsideHoursAutoReply()` 送出自動回覆：

- 渠道的 `botConfig.offlineGreeting` 有值時，優先用它，而不是營業時間設定的訊息。
- 同一個聯絡人 30 分鐘內只回一次。這個去重記錄存在 API 行程的記憶體，API 重新啟動或有多個行程時會各自計算。

營業時間只影響這則自動回覆。機器人、自動化與 SLA 的計時都不看營業時間。

## 追蹤設定

填入 Google Analytics 的 `gaId` 與 Meta Pixel 的 `metaPixelId`。短連結的中轉頁會放入這兩個追蹤碼，見[短連結](./SHORTLINKS.md#點擊時發生什麼)。中轉頁不等追蹤事件送出就轉到目標網址，所以 GA 與 Meta 不一定收到事件。

ID 會被放進公開頁面的 `<script>`，因此只收固定格式：`gaId` 是 `G-` 加 4～20 個大寫英文字母或數字，`metaPixelId` 是 5～20 位數字，其他值回 400。產生頁面時會再檢查一次，資料庫裡不合格的舊值不會輸出。

修改時會寫一筆 `settings.update` 租戶稽核，只記錄有沒有填，不記錄 ID 值。

## API 金鑰

API 金鑰讓外部夥伴系統把文件推送到知識庫（`POST /knowledge/partner-ingest`），見[知識庫與 AI](./KNOWLEDGE.md#匯入)。

| 動作 | 端點 |
| --- | --- |
| 列出 | `GET /settings/api-keys` |
| 建立 | `POST /settings/api-keys`，可以指定有效天數；不指定就不會過期 |
| 撤銷 | `DELETE /settings/api-keys/:id`，把金鑰設為停用 |

金鑰的格式是 `pk_` 開頭加一串隨機字元。完整金鑰只在建立時回傳一次；資料庫只存雜湊值，清單只顯示前綴與最後幾碼。

持金鑰呼叫時，`rbac.guard.ts` 的 `PARTNER_KEY_ALLOWED` 決定它能通過哪些權限檢查，目前只有 `knowledge.admin`。金鑰與 CLI token 怎麼驗證、停用成員或租戶之後是否失效，見[認證與憑證](../../modules/AUTHENTICATION.md)。

## CLI 連線

CLI 連線頁列出租戶內所有未撤銷的 CLI token，也能在這裡建立與撤銷：

| 動作 | 端點 |
| --- | --- |
| 列出 | `GET /settings/cli-sessions`：租戶內所有成員的 token，不只自己的 |
| 建立 | `POST /settings/cli-sessions`：為自己建立一個 token，可以指定 scope 與有效天數，也可以加上 MCP 讀取的 scope |
| 撤銷 | `DELETE /settings/cli-sessions/:id` |

成員也可以不經過這一頁，用 `POST /auth/cli/login` 直接換一個 CLI token。CLI token 的授權只看 scope，不看角色與方案，而且這一頁建立 token 時不限制可以填哪些 scope，見 `../../system/AUDIT.md` 的 RBAC-02。

## Passkey 登入

成員可以註冊 Passkey，之後免密碼登入。這一頁管理的是**自己**的 Passkey：列出、改名與刪除。路由在 `/auth/passkeys`，只驗登入，不需要 `settings.manage`。

## A2A

A2A 橋接讓本系統的 AI agent 接收其他 agent 從 A2A Hub 送來的任務。這一頁只顯示橋接的狀態（`GET /settings/a2a`）：是否啟用、Hub 位址、agent ID 與連線狀態。

橋接的開關與身分全部來自環境變數（`A2A_BRIDGE_ENABLED`、`A2A_HUB_URL`、`A2A_AGENT_ID`、`A2A_AGENT_TOKEN`），整個部署共用一組，租戶不能設定。每個租戶的管理員看到的都是同一個橋接。橋接收到任務時，一律以最早建立的啟用中租戶執行，見 `../../system/AUDIT.md` 的 A2A-01。

## 稽核

設定頁的修改寫入 `settings.update` 租戶稽核，`payload.section` 記錄是哪一類：`office-hours`、`tracking`、`chat`、`embedding`、`gemini-key`。

API 金鑰與 CLI token 的建立和撤銷**沒有**寫入稽核。這兩種都是長效憑證，事後無法查出是誰、在什麼時候建立或撤銷的，見 `../../system/AUDIT.md` 的 AUD-01。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| CLI token 不受角色與方案限制 | 詳見 `../../system/AUDIT.md` 的 RBAC-02 |
| API 金鑰不受租戶停用與建立者清除影響 | 詳見 `../../system/AUDIT.md` 的 AUTH-02 |
| A2A 以最早建立的租戶執行任務 | 詳見 `../../system/AUDIT.md` 的 A2A-01 |
| 長效憑證的建立與撤銷沒有稽核 | 詳見 `../../system/AUDIT.md` 的 AUD-01 |
| 閒置自動關閉的時限沒有頁面 | 詳見 `../../system/AUDIT.md` 的 CONV-01 |
| 非營業時間自動回覆的去重存在記憶體 | API 重新啟動後重算，多行程時各算各的 |
| 營業時間不影響 SLA 計時 | SLA 以自然時間計算 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。

## WebTalk 協作

WebTalk 是後台右下角的多人聊天工具列（外部 SDK），讓同一個租戶的成員即時討論。資料來源：`apps/api/src/modules/webtalk/*`、`apps/web/src/lib/webtalk.ts`、`apps/web/src/components/webtalk/WebTalkGlobal.tsx`、`apps/web/src/components/settings/WebTalkSettings.tsx`。SDK 行為的研究見 `openspec/changes/webtalk-multi-tenant/design.md`（歸檔後在 `openspec/changes/archive/`）。

**房間隔離**：SDK 沒有伺服器端驗證，知道房間代號就能加入。所以房間代號由 API 發放：`GET /webtalk/session` 以 `WEBTALK_ROOM_SECRET` 對 `WEBTALK_SITE_ID`、租戶 ID 與房間版本做 HMAC-SHA256，只回給已登入的真人成員（Partner API key、CLI session 回 403）。不同租戶、不同環境不會同房。伺服器沒有設定密鑰或 SDK 網址時回 `enabled: false`，前端完全不載入 SDK。

**租戶設定**（`TenantSettings`，需要 `settings.manage`）：

| 欄位 | 預設 | 說明 |
| --- | --- | --- |
| `webtalkEnabled` | 開 | 關閉時後台不載入 SDK，也不連線到外部服務 |
| `webtalkAiEnabled` | 關 | AI 摘要會把整頁文字（含顧客個資）送到 `WEBTALK_AI_ENDPOINT`。伺服器沒有設定該端點時，開啟也不生效 |
| `webtalkRoomVersion` | 0 | 按「重新產生房間代號」（`POST /webtalk/settings/rotate-room`）時加一，舊代號從此對不到這個租戶 |

設定變更在成員重新整理頁面後生效。變更與重新產生房間代號都寫入租戶稽核（`settings.update`，`section: "webtalk"`）。稽核與變更在同一個交易寫入：稽核寫入失敗時，變更不生效，請求回錯誤。

**AI 摘要關閉時**：SDK 一定會顯示 AI 按鈕，前端把 SDK 的 AI 端點指向 `POST /webtalk/ai-disabled`。這個端點在解析 body 前就回 403 `WEBTALK_AI_DISABLED`，頁面內容不會送到外部。

**身分**：SDK 沒有讓宿主帶入身分的選項。前端在掛載前把成員 ID 與名稱寫進 SDK 的 localStorage，同事看到的是本名。這只是顯示：使用者仍可在 SDK 設定改名，房間內任何人都能宣稱任何名稱。

**登出與換帳號**：卸載 SDK，並刪除 localStorage 與 IndexedDB（`keyval-store`）中 `WEB_TALK_` 開頭的資料。SDK 載入過時，登出改用整頁導向，關閉 SDK 的信令連線。

**殘餘風險**：

- 房間代號外流（例如離職成員）時，對方仍可加入，直到重新產生房間代號或更換 `WEBTALK_ROOM_SECRET`。
- 信令伺服器 `0.artico.dev` 是第三方，看得到房間代號與連線 IP；訊息內容走 WebRTC 加密通道，不經過信令伺服器。
- SDK 網址沒有版本號。控管 vercel 專案的人可以隨時換掉 script，在所有租戶的後台執行任意程式碼。建議確認專案控管權，並改為自行託管、鎖版本、設定 `WEBTALK_SDK_INTEGRITY`。

