## Why

後台每一頁都載入外部 WebTalk SDK（`webtalk.js`），並以寫死的 `scope: 'origin'`、`siteId: 'open333crm-uat'` 掛載多人聊天工具列。SDK 依這兩個值在瀏覽器端算出房間代號，所以同一網域上**所有租戶的客服都進同一個房間**：彼此看得到在線名單、互傳訊息、互相看到「網頁摘要」的內容。這是跨租戶資料洩漏。

其他問題：

- `siteId` 寫死 `uat`，所有環境共用同一組房間。
- SDK 沒有伺服器端驗證，知道房間代號就能加入；房間代號目前可由網域直接推算。
- 租戶沒有開關。AI 摘要會把整頁文字（含顧客個資）送到外部端點，租戶無法關閉。
- 手動 `mount()` 時 SDK 不讀 `<script>` 上的 `data-webtalk-ai-endpoint`，現行設定其實沒有生效，AI 請求打到 CRM 自己網域的 `/api/webtalk/ai`。
- 登出後 SDK 留下的聊天紀錄與暱稱留在瀏覽器；SDK 的 `unmount()` 會清掉 `window.WebTalk`，同一分頁再登入時無法重新掛載。

使用者決定保留 WebTalk，並補齊多租戶架構。

## What Changes

- **租戶隔離的房間**：新增 `GET /api/v1/webtalk/session`。API 以伺服器密鑰 `WEBTALK_ROOM_SECRET` 對 `siteId`、租戶 ID 與租戶的房間版本做 HMAC-SHA256，產生不可猜測的房間代號，只回給已登入且屬於該租戶的成員。前端以這個代號 `mount`。密鑰或 SDK 網址沒有設定時回 `enabled: false`，前端不載入 SDK（fail-closed），不退回共用房間。
- **設定值改由環境變數提供**：`WEBTALK_SITE_ID`、`WEBTALK_SDK_URL`、`WEBTALK_SDK_INTEGRITY`（選填 SRI）、`WEBTALK_AI_ENDPOINT` 放在 API 的環境變數，由 session 端點在執行時下發；前端不再寫死任何網址或 `siteId`。
- **租戶層級開關**：`TenantSettings` 新增 `webtalkEnabled`（預設開）、`webtalkAiEnabled`（預設關）、`webtalkRoomVersion`。新增 `GET/PUT /api/v1/webtalk/settings` 與 `POST /api/v1/webtalk/settings/rotate-room`（重新產生房間代號，用於成員離職時），權限沿用 `settings.manage`，不新增權限點。設定頁新增「WebTalk 協作」分頁。
- **AI 摘要關閉時**：SDK 的嵌入版一律顯示 AI 按鈕（無法以選項隱藏），所以前端把 `aiEndpoint` 指向 CRM API 的 `POST /api/v1/webtalk/ai-disabled`。這個端點在讀取 body 之前就回 403，頁面內容不會送出到外部。
- **身分**：SDK 沒有讓宿主帶入使用者的選項。前端在 `mount` 前把目前客服的名稱寫入 SDK 讀取的 localStorage 位置，同事看到的是客服本名而不是自取的暱稱。這只是顯示，不是驗證。
- **生命週期**：登出、換帳號、離開後台時卸載 SDK，並清除 SDK 在瀏覽器留下的聊天紀錄與身分資料；登出時若 SDK 曾載入，改用整頁導向 `/login`，關閉 SDK 的信令連線。修正同一分頁再次登入無法重新掛載的問題。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `webtalk-collaboration`：掛載改用後端發放的租戶房間；SDK 網址與 AI 端點改為設定值；新增租戶開關、AI 摘要關閉、房間重新產生、身分帶入與登出清除。

## Impact

- API：新增 `apps/api/src/modules/webtalk/`（`webtalk.routes.ts`、`webtalk.service.ts`），在 `apps/api/src/index.ts` 註冊；`apps/api/src/config/env.ts` 新增 5 個選填環境變數。
- 資料庫：`TenantSettings` 新增 3 個欄位與一個正式 migration。
- Web：`apps/web/src/lib/webtalk.ts`、`components/webtalk/WebTalkGlobal.tsx`、`providers/AuthProvider.tsx`、設定頁與側欄新增「WebTalk 協作」。
- 設定：`.env.api.example`、`docs/ref/features/tenant/SETTINGS.md`、`docs/ref/system/INFRASTRUCTURE.md`。
- 部署：`WEBTALK_ROOM_SECRET` 與 `WEBTALK_SDK_URL` 沒有設定前，所有租戶的 WebTalk 都不會載入。
