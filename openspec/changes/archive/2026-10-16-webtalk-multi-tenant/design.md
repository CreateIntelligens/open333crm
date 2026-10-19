## Context

WebTalk 由已離職同仁在 commit `07bbd54b` 加入。SDK 是外部的單一壓縮檔（`https://webtalk-nine.vercel.app/webtalk.js`，約 2.4 MB，沒有版本號），不在這個 repo。以下結論來自 2026-10-15 下載的版本（內部版本字串 `WEB_TALK_2.0.2`）的原始碼閱讀，沒有官方文件。

### SDK 研究結論

| 項目 | 結論 |
| --- | --- |
| 掛載 API | `window.WebTalk.mount(options)`、`window.WebTalk.unmount()`。`unmount()` 會把 `window.WebTalk` 設為 `undefined`，之後要重新掛載必須保留第一次拿到的 `mount` 函式。 |
| `mount` 讀取的選項 | `roomId`、`scope`（`origin`／`path`／`meta`）、`siteId`、`pageId`、`metaName`、`aiEndpoint`、`enableVirtualRoom`、`placement`、`mobilePlacement`。 |
| 房間代號 | `roomId` 有值時**原樣**使用；沒有值時才由 `scope`／`siteId` 在瀏覽器端組出 `origin:<siteId>` 之類的字串再轉成十六進位。後者任何人都能推算。 |
| `data-webtalk-*` 屬性 | 只有自動掛載（`data-webtalk-auto-mount` 不是 `false`）時才讀。手動 `mount()` 不讀，所以現行的 `data-webtalk-ai-endpoint` 沒有生效。 |
| 傳輸 | WebRTC P2P。信令走 socket.io 到 `https://0.artico.dev`（Artico 公用信令伺服器，嵌入版不能改），STUN 用 `stun.l.google.com:19302`，沒有 TURN。 |
| 連線時機 | **載入 script 時**就建立 peer 並連到信令伺服器，不必等 `mount()`。所以停用的租戶必須完全不載入 script。 |
| 驗證 | 沒有 token、簽章或任何伺服器端驗證。知道 `roomId` 就能加入房間；新成員會從線上成員同步歷史訊息。 |
| 使用者身分 | 沒有讓宿主帶入的選項。名稱、頭像存在 `localStorage` 的 `WEB_TALK_WEB:sync:WEB_TALK_USER_INFO`（頭像在 `WEB_TALK_WEB:local:WEB_TALK_USER_AVATARS`），沒有資料時 SDK 會請使用者自取暱稱。訊息上的名稱與 ID 都是傳送端自己宣稱的。 |
| AI | 嵌入版把 `enableAi` 寫死為 `true`，AI 按鈕一定出現。`aiEndpoint` 沒有給時預設為相對路徑 `/api/webtalk/ai`。AI 請求是 `POST aiEndpoint`，body 含整頁 `document.body.innerText`，不帶 Authorization；失敗時顯示回應 JSON 的 `error.message`。 |
| 本機資料 | 聊天紀錄存在 IndexedDB（`keyval-store` 資料庫，key 前綴 `WEB_TALK_2.0.2:`），其他狀態存在 `localStorage`（前綴 `WEB_TALK_`）。卸載不會清除。 |

## Goals / Non-Goals

**Goals**

- 不同租戶絕不進同一個房間；房間代號不可由公開資訊推算。
- 沒有設定時不載入（fail-closed）。
- 租戶可以關閉 WebTalk 與 AI 摘要；AI 摘要預設關閉。
- 登出或換帳號後，不殘留上一個租戶的房間與聊天紀錄。

**Non-Goals**

- 自行託管 SDK、改寫 SDK、自架信令伺服器。這些要使用者決定（見「殘餘風險」）。
- 自建 AI 代理端點。啟用 AI 時仍送到 `WEBTALK_AI_ENDPOINT`。

## Decisions

### D1：房間代號由 API 以 HMAC 發放

`roomId = "o333-" + base64url(HMAC-SHA256(WEBTALK_ROOM_SECRET, "open333crm:webtalk-room:v1:<siteId>:<tenantId>:<roomVersion>"))`。

- `tenantId` 一律取自 `request.agent.tenantId`，不接受任何輸入。
- 只有 `fastify.authenticate` 通過的成員能取得；Partner API key 與 CLI session 不是真人，回 403。
- 輸出只有 `[A-Za-z0-9_-]`，不含租戶 ID 原文。
- 不用資料庫存隨機代號，因為 HMAC 可以重算，換密鑰就能一次作廢所有房間。
- 替代方案：讓 SDK 繼續用 `siteId` 但改成每租戶不同值。不採用，因為 `siteId` 會以明文出現在前端，且可推算。

### D2：設定由 API 在執行時下發

`WEBTALK_ROOM_SECRET`（至少 32 字元）、`WEBTALK_SITE_ID`（預設 `open333crm`）、`WEBTALK_SDK_URL`、`WEBTALK_SDK_INTEGRITY`（選填）、`WEBTALK_AI_ENDPOINT`（選填）放在 `.env.api`。

- 不用 `NEXT_PUBLIC_*`：那會在 build 時編進前端，換環境要重新 build；密鑰也不能進前端。
- 密鑰或 SDK 網址缺少、格式錯誤（網址不是 https，`localhost` 除外）時，session 回 `enabled: false, reason: "NOT_CONFIGURED"`。
- `siteId` 進入 HMAC，讓共用同一密鑰的兩個環境仍然不同房。各環境仍應使用不同密鑰。
- `WEBTALK_SDK_INTEGRITY` 有值時前端加上 `integrity` 與 `crossorigin="anonymous"`。目前的 SDK 網址沒有版本號，上游每次部署雜湊都會變，所以預設不設。

### D3：租戶開關與預設值

`TenantSettings` 新增：

| 欄位 | 預設 | 理由 |
| --- | --- | --- |
| `webtalkEnabled` | `true` | 使用者決定保留 WebTalk。房間隔離後，同租戶成員之間的協作就是這個功能的用途。關掉預設值會讓所有既有租戶在部署後突然失去功能。 |
| `webtalkAiEnabled` | `false` | AI 摘要會把整頁文字（含顧客姓名、電話、對話）送到第三方端點，屬於個資外送，應由租戶明確同意後開啟。另外 D4 說明現行 AI 其實沒有生效，預設關閉不會讓使用者失去在用的功能。 |
| `webtalkRoomVersion` | `0` | 重新產生房間時加 1。 |

`TenantSettings` 列不存在時，以上預設值生效，讀取不建立新列。

權限沿用 `settings.manage`（設定頁其他分頁也用它），不新增權限點，因此部署時不需要跑 reconcile。session 端點只需要登入。

設定變更在成員下次進入後台（重新整理或重新登入）時生效，不即時推送。

### D4：AI 摘要關閉的方式

嵌入版一定會顯示 AI 按鈕，無法以選項關閉。所以：

- `webtalkAiEnabled=true` 且 `WEBTALK_AI_ENDPOINT` 有設定：`aiEndpoint` 用該值。
- 其他情況：`aiEndpoint` 指向 CRM API 的 `/api/v1/webtalk/ai-disabled`（前端以 `API_BASE_URL` 組出完整網址）。這個端點在 `onRequest` 階段就回 403 `WEBTALK_AI_DISABLED`（「此租戶已停用 WebTalk AI 摘要，如需使用請聯繫管理員。」），不解析也不記錄 body。SDK 會把這段訊息顯示給使用者。

頁面文字仍會傳到 CRM 自己的 API，但不會離開我們的基礎設施。不給 `aiEndpoint` 不可行，因為 SDK 會改打 CRM 前端網域的相對路徑。

### D5：身分帶入

SDK 沒有身分選項，前端在 `mount` 前寫入 `WEB_TALK_WEB:sync:WEB_TALK_USER_INFO`：`id` 用成員 ID、`name` 用成員名稱，其他欄位用 SDK 的預設值；成員有 http(s) 頭像網址時也寫入頭像。

這只是讓同事看到本名，不是驗證：使用者仍可在 SDK 設定改名，房間內任何人也能宣稱任何名稱。這依賴 SDK 的內部儲存格式，SDK 改版後可能失效，失效時 SDK 會退回請使用者自取暱稱，不影響隔離。

### D6：生命週期

- `WebTalkGlobal` 以成員 ID 為依賴：換帳號時先卸載再重新取得 session。
- 卸載（離開後台、換帳號、登出）時呼叫 SDK `unmount()`，並刪除 `localStorage` 中 `WEB_TALK_` 開頭的 key 與 IndexedDB `keyval-store` 中 `WEB_TALK_` 開頭的 key。
- 第一次載入後保留 `mount` 函式，修正 `unmount()` 清掉 `window.WebTalk` 後無法重新掛載的問題。
- SDK 的 peer 與信令連線是模組層級的單例，`unmount()` 不會關閉。登出時若 SDK 曾載入，改用 `window.location.assign('/login')` 整頁導向，結束這個連線；沒有載入過就維持原本的 `router.push`。

## Risks / Trade-offs

### 殘餘風險：SDK 本身沒有伺服器端驗證

- **房間代號就是通行證**。任何拿到代號的人（例如離職成員、看過瀏覽器開發者工具的人）都能加入並收到同步的歷史訊息，直到租戶「重新產生房間代號」或平台更換 `WEBTALK_ROOM_SECRET`。
- **信令伺服器是第三方**（`0.artico.dev`）。它看得到房間代號與參與者連線資訊（IP）。訊息內容走 WebRTC 資料通道（DTLS 加密），不經過信令伺服器。
- **沒有 TURN**。在嚴格 NAT 後面的成員可能連不上彼此。
- **SDK 網址沒有版本**。vercel 專案的擁有者可以隨時換掉 script 內容，在所有租戶的後台執行任意程式碼（可讀取頁面上的顧客資料與 access token）。這是目前最大的供應鏈風險。
- **身分可偽造**（D5）。

建議（需要使用者決定，這個 change 不做）：

1. 確認 `webtalk-nine.vercel.app` 這個 vercel 專案目前由誰控管；同仁離職後應移轉到公司帳號。
2. 把 SDK 鎖定版本：自行託管一份審閱過的檔案（例如放在 MinIO 或前端 `public/`），並設定 `WEBTALK_SDK_INTEGRITY`。
3. 長期：自架信令伺服器並加上 token 驗證，或改用有伺服器端授權的協作方案。
4. AI 摘要若要開放，建議經由 CRM API 代理，記錄用量並遮罩個資，而不是直接送第三方。

### Trade-offs

- 預設開啟 WebTalk 代表部署後只要設好環境變數，既有租戶就會自動使用（同租戶內）。若希望先讓租戶明確同意，可把 `webtalkEnabled` 預設改成 `false`。
- 登出時清除本機聊天紀錄，下次登入後只能從線上同事同步歷史。

## Migration Plan

1. 套用 migration（新增 3 個有預設值的欄位，不影響既有資料）。
2. 在 `.env.api` 設定 `WEBTALK_ROOM_SECRET`（`openssl rand -base64 48`）與 `WEBTALK_SDK_URL`；要開放 AI 時再設 `WEBTALK_AI_ENDPOINT`。
3. 重新啟動 API。前端不需要重新 build 設定值。
4. 回滾：移除 `WEBTALK_ROOM_SECRET` 即全面停用；欄位可保留。

## Open Questions

- `webtalkEnabled` 預設開啟是否符合業務期待（見 Trade-offs）。
- 是否把 SDK 改為自行託管並鎖版本。
