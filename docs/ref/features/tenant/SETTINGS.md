# 其他設定

「設定」頁有十幾個分頁，其中渠道、人員、角色、標籤與 SLA 各有專文。本文件說明剩下的分頁：一般設定、營業時間、追蹤設定、WebTalk 協作、API 金鑰、CLI 連線、Passkey 登入與 A2A。Chat 與 Embedding 設定在知識庫底下，見[知識庫與 AI](./KNOWLEDGE.md#ai-設定)。

- **資料來源**：`apps/api/src/modules/settings/*`、`apps/api/src/modules/auth/partner-api-key.service.ts`、`apps/api/src/modules/auth/cli-session.service.ts`、`apps/api/src/modules/auth/passkey.service.ts`、`apps/api/src/modules/webhook/inbound-side-effects.ts`、`apps/web/src/app/dashboard/settings/page.tsx`、`apps/web/src/components/settings/*`、`apps/web/src/components/layout/Sidebar.tsx`
- **核對日期**：2026-11-19

## 分頁與模組

分頁定義在 `settings/page.tsx` 的 `SETTINGS_TABS`。`/dashboard/settings/<section>` 的 section 不在表裡時，顯示一般設定。渠道、人員、角色、標籤、SLA、門市各有自己的功能文件；本文件只負責它們共用的設定頁，以及下表標「本文件」的分頁：

| 分頁 | 模組 | 專文 |
| --- | --- | --- |
| 一般設定 | `agent` | 本文件 |
| 渠道管理 | `channel` | [渠道管理](./CHANNELS.md) |
| 人員管理、角色與權限 | `agent`、`role` | [人員與角色](./MEMBERS.md) |
| 標籤管理 | `tag` | [聯絡人與標籤](./CONTACTS.md#標籤) |
| SLA 政策 | `sla` | [服務水準協議](../SLA.md) |
| 營業時間、追蹤設定、跨渠道綁定、API 金鑰、CLI 連線 | `settings` | 本文件 |
| 門市與核銷帳號 | `store` | [行銷活動、素材與優惠券](./MARKETING.md)。分頁需要 `store.view` |
| Passkey 登入 | `auth` | 本文件 |
| A2A | `settings` | 本文件 |
| WebTalk 協作 | `webtalk` | 本文件 |

`settings` 模組的路由前綴是 `/api/v1/settings`（`settings.routes.ts`）。整個 plugin 掛了 `authenticate` 與 `requirePermission("settings.manage")`。新增的設定端點放進這個 plugin 就自動受保護；放在別的模組時，要自己掛 guard。所以營業時間、追蹤設定、API 金鑰、CLI 連線、A2A，以及 Chat、Embedding 與自備金鑰的設定，全部需要 `settings.manage`。

營業時間、追蹤設定、API 金鑰與 CLI 連線各有自己的路由檔，由 `settings.routes.ts` 以子 plugin 註冊，所以也套用上面的權限檢查：

| 分頁 | 路由檔 | flow |
| --- | --- | --- |
| 營業時間 | `settings/office-hours.routes.ts` | `settings/office-hours.flow.ts` |
| 追蹤設定 | `settings/tracking-settings.routes.ts` | `settings/tracking-settings.flow.ts` |
| API 金鑰 | `settings/partner-api-key.routes.ts` | `auth/partner-api-key.flow.ts` |
| CLI 連線 | `settings/cli-session.routes.ts` | `auth/cli-session.flow.ts` |

這四組路由的每個請求都在 flow 開的一個租戶交易內完成。建立 API 金鑰與 CLI token 時，flow 先在交易外產生並雜湊，再開交易寫入。

租戶層級的設定存在 `TenantSettings`，一個租戶一列。這一列在第一次讀取任何設定、或第一次呼叫 AI 時才建立，開通租戶時不會建立。由營業時間以外的路徑建立時，`officeHours` 是 schema 預設的 `{}`。

## 程式的入口

| 分頁 | 路由 | flow 或 service 函式 |
| --- | --- | --- |
| 一般設定的改密碼 | `PATCH /agents/me/password` | `agent.flow.ts` 的 `changeOwnPasswordFlow()`，見[人員與角色](./MEMBERS.md#密碼) |
| 營業時間 | `GET`、`PUT /settings/office-hours` | `office-hours.service.ts` 的 `getOfficeHours()`、`updateOfficeHours()` |
| 追蹤設定 | `GET`、`PUT /settings/tracking` | `tracking-settings.service.ts` |
| 跨渠道綁定 | `GET`、`PUT /settings/identity-binding` | `binding-links.ts` 的 `applyIdentityBindingUpdate()`、`findIdentityBindingKeywordIssue()`；存檔後 `invalidateIdentityBindingSettings()` |
| WebTalk 協作 | `GET`、`PUT /webtalk/settings`、`POST /webtalk/settings/rotate-room`（`webtalk/webtalk.routes.ts`，前綴 `/api/v1/webtalk`，設定類端點逐條掛 `settings.manage`） | `webtalk.flow.ts` |
| API 金鑰 | `GET`、`POST /settings/api-keys`、`DELETE /settings/api-keys/:id` | `partner-api-key.service.ts` |
| CLI 連線 | `GET`、`POST /settings/cli-sessions`、`DELETE /settings/cli-sessions/:id` | `cli-session.service.ts` |
| Passkey 登入 | `GET /auth/passkeys`、`PATCH`、`DELETE /auth/passkeys/:id`、`POST /auth/passkeys/register/*`（`auth/auth.routes.ts`） | `passkey.service.ts` |
| A2A | `GET /settings/a2a` | `a2a-status.service.ts` 的 `buildA2AStatus()` |
| AI 設定的儲存（頁面在知識庫） | `GET`、`PUT /settings/chat`、`/settings/embedding`、`/settings/gemini-key`；`GET /settings/chat/models`；`POST /settings/chat/health`、`/settings/embedding/health` | `chat-settings.flow.ts`、`embedding-settings.flow.ts` |

## 一般設定

名稱是一般設定，內容卻是個人設定：顯示自己的名稱、email 與角色，並修改自己的密碼（`PATCH /agents/me/password`，需要舊密碼）。這一頁不需要 `settings.manage`。名稱、email、角色是唯讀的，沒有改名的端點。

改密碼之後，舊密碼立即不能登入，但已發出的 refresh token 不失效（AUTH-08）。前端擋下 8 字以下、與舊密碼相同、兩次輸入不符的新密碼。新密碼欄位的提示寫「至少 6 個字元」，實際的檢查是 8 字（HC-SETTINGS-13）。

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

`PUT /settings/office-hours` 依 `settings/office-hours-settings.ts` 的 schema 檢查輸入，不合法時回 400 `VALIDATION_ERROR`，已存的設定不變：

- 時段是 `HH:mm`，範圍 00:00～23:59，結束時間必須晚於開始時間。不支援跨過午夜的時段。
- 假日是存在的日期，最多 366 筆。
- 時區是 Node 可以換算的 IANA 時區。
- 非營業時間的訊息是 1～1000 字。

讀取營業時間一律經過 `readOfficeHoursSettings()`。讀取時以同一份 schema（`officeHoursSettingsSchema`）解析已存的設定。設定不合法時（例如其他設定建立 `TenantSettings` 時留下的 `{}`，或加上檢查之前存入的不合法時區），整份當作沒有設定：回傳預設值，`enabled` 是 `false`，收訊時不自動回覆。讀取不改寫資料庫，成員下一次儲存時覆蓋。

客人在非營業時間傳訊息時，進站管線最後一步 `sendOutsideHoursAutoReply()` 送出自動回覆：

- 渠道的 `botConfig.offlineGreeting` 有值時，優先用它，而不是營業時間設定的訊息。
- 自動回覆是一則 SYSTEM 訊息。
- 同一個聯絡人 30 分鐘內只回一次。這個去重記錄存在 API 行程的記憶體，API 重新啟動或有多個行程時會各自計算。
- 加好友、封鎖、群組加入離開、收回訊息等系統事件（`contentType` 是 `follow`、`unfollow`、`join`、`leave`、`memberJoined`、`memberLeft`、`unsend`、`videoPlayComplete`、`accountLink`、`beacon`）不送自動回覆。

營業時間只影響這則自動回覆。機器人、自動化與 SLA 的計時都不看營業時間。

修改營業時間寫一筆 `settings.update` 稽核，`payload.section` 是 `office-hours`。

## 跨渠道綁定

「跨渠道綁定」分頁設定顧客用關鍵字把不同渠道的身分綁成同一個聯絡人，也設定 email 與手機登記。設定存在 `TenantSettings.identityBinding`。路由是 `GET`、`PUT /settings/identity-binding`（`settings.routes.ts`），需要 `settings.manage`。

| 欄位 | 說明 |
| --- | --- |
| `enabled` | 跨渠道綁定的開關 |
| `bindKeywords`、`unbindKeywords` | 綁定與解除綁定的關鍵字，各 1～5 個，每個 1～20 字 |
| `emailEnabled`、`emailKeywords` | email 登記的開關與關鍵字。沒送時沿用已儲存的值 |
| `phoneEnabled`、`phoneKeywords` | 手機登記的開關與關鍵字。沒送時沿用已儲存的值 |

儲存時的檢查：

- 沒送的 email 與手機欄位沿用已儲存的值。
- 「確認綁定」不能當關鍵字。
- 不同方式的關鍵字不能互相重複，不分大小寫。例如綁定與解除相同、email 關鍵字與綁定關鍵字相同，都回 400，錯誤指出是哪一欄。
- 同一欄裡的關鍵字不檢查重複，`["a","A"]` 可以存入（HC-SETTINGS-16）。

API 行程把綁定設定快取 15 秒。存檔後一定要呼叫 `invalidateIdentityBindingSettings()` 清除快取。有多個 API 行程時，其他行程要等快取過期（APP-09）。

儲存時寫一筆 `settings.update` 稽核，`payload.section` 是 `identity-binding`，記錄三個開關。綁定與登記怎麼運作，見[聯絡人與標籤](./CONTACTS.md)。

## 追蹤設定

填入 Google Analytics 的 `gaId` 與 Meta Pixel 的 `metaPixelId`。短連結的中轉頁會放入這兩個追蹤碼，見[短連結](./SHORTLINKS.md#點擊時發生什麼)。中轉頁不等追蹤事件送出就轉到目標網址，所以 GA 與 Meta 不一定收到事件。

`PUT /settings/tracking` 整筆取代：沒送的欄位存成 `null`。

ID 會被放進公開頁面的 `<script>`，因此只收固定格式（`GA4_ID_PATTERN`、`META_PIXEL_ID_PATTERN`），不要放寬：`gaId` 是 `G-` 加 4～20 個大寫英文字母或數字，`metaPixelId` 是 5～20 位數字，其他值回 400。產生頁面時會再檢查一次，資料庫裡不合格的舊值不會輸出。

修改時會寫一筆 `settings.update` 租戶稽核，只記錄有沒有填，不記錄 ID 值。

## API 金鑰

API 金鑰讓外部夥伴系統把文件推送到知識庫（`POST /knowledge/partner-ingest`），見[知識庫與 AI](./KNOWLEDGE.md#匯入)。

| 動作 | 端點 |
| --- | --- |
| 列出 | `GET /settings/api-keys` |
| 建立 | `POST /settings/api-keys`，可以指定 1～365 天的有效天數；不指定就不會過期 |
| 撤銷 | `DELETE /settings/api-keys/:id`，把金鑰設為停用（`isActive: false`） |

金鑰的格式是 `pk_` 開頭加一串隨機字元。完整金鑰只在建立時回傳一次；資料庫只存雜湊值，清單只顯示前綴與最後幾碼。

持金鑰呼叫時，`rbac.guard.ts` 的 `PARTNER_KEY_ALLOWED` 決定它能通過哪些權限檢查，目前只有 `knowledge.admin`。接受金鑰的路由只有 `POST /knowledge/partner-ingest`。管理金鑰（列表、建立、撤銷）只要 `settings.manage`，不需要 `knowledge.admin`。金鑰不帶建立者的角色，建立者自己有沒有 `knowledge.admin` 不影響金鑰能做什麼。

金鑰驗證失敗時回 401：過期回 `API key expired`，撤銷或打錯回 `Invalid API key`（`partner-api-key.service.ts`）。`partner-ingest` 沒帶 `cmd` 時回 400 `INVALID_CMD`。建立金鑰後畫面顯示的 curl 範例沒有 `cmd`，照抄會收到這個錯誤（HC-SETTINGS-10）。這些錯誤訊息是英文。金鑰與 CLI token 怎麼驗證、停用成員或租戶之後是否失效，見[認證與憑證](../../modules/AUTHENTICATION.md)。

## CLI 連線

CLI 連線頁列出租戶內所有未撤銷的 CLI token，也能在這裡建立與撤銷：

| 動作 | 端點 |
| --- | --- |
| 列出 | `GET /settings/cli-sessions`：租戶內所有成員的 token，不只自己的 |
| 建立 | `POST /settings/cli-sessions`：為自己建立一個 token，可以指定 scope 與 1～365 天的有效天數（不指定就是 30 天），也可以加上 MCP 讀取的 scope |
| 撤銷 | `DELETE /settings/cli-sessions/:id` |

「建立」勾選「MCP 唯讀」時加上 `mcp:read` scope，這個 token 可以呼叫 `POST /mcp`（`mcp.routes.ts`）。MCP 另外檢查 Origin（`MCP_ALLOWED_ORIGINS`）與 `mcp:*` scope。`verifyCliSession()` 依序檢查撤銷、過期、成員停用。撤銷不存在的 CLI token 回 200 `revoked: true`（HC-SETTINGS-11）。

成員也可以不經過這一頁，用 `POST /auth/cli/login`（`open333 login`）直接換一個 CLI token。這一頁也列出這種 token。CLI token 的授權只看 scope，不看角色與方案，而且這一頁建立 token 時不限制可以填哪些 scope，見 `../../system/AUDIT.md` 的 RBAC-02。

## Passkey 登入

成員可以註冊 Passkey，之後免密碼登入。這一頁管理的是**自己**的 Passkey：列出、改名與刪除。路由在 `/auth/passkeys`，只驗登入，不需要 `settings.manage`。API 沒有設定 `WEBAUTHN_RP_ID` 與 `WEBAUTHN_ORIGIN` 時，頁面顯示 Passkey 尚未啟用。列表的時間以不帶語系的 `toLocaleString()` 顯示（HC-SETTINGS-14）。

## A2A

A2A 橋接讓本系統的 AI agent 接收其他 agent 從 A2A Hub 送來的任務。這一頁只顯示橋接的狀態（`GET /settings/a2a`）：是否啟用、Hub 位址、agent ID 與連線狀態。

橋接的開關與身分全部來自環境變數（`A2A_BRIDGE_ENABLED`、`A2A_HUB_URL`、`A2A_AGENT_ID`、`A2A_AGENT_TOKEN`），整個部署共用一組，租戶不能設定。每個租戶的管理員看到的都是同一個橋接。「目前狀態」只要設定了 `A2A_AGENT_ID` 就顯示 `connected`，橋接連線失敗時也一樣（HC-SETTINGS-05）。橋接收到任務時，一律以最早建立的啟用中租戶執行，見 `../../system/AUDIT.md` 的 A2A-01。

## 稽核

設定頁的修改寫入 `settings.update` 租戶稽核，`payload.section` 記錄是哪一類：`office-hours`、`tracking`、`identity-binding`、`webtalk`、`chat`、`embedding`、`gemini-key`。

稽核只記「哪一區、哪些欄位、有沒有設定」，不記追蹤 ID、prompt、金鑰的值。Chat 與 Embedding 只記改了哪些欄位名（`keys`），自備金鑰只記設定或清除。

營業時間與追蹤設定的稽核和修改在同一個交易寫入：稽核寫入失敗時，修改也不寫入。

API 金鑰與 CLI token 的建立和撤銷也寫稽核，稽核與憑證在同一個交易寫入，紀錄不含金鑰或 token 的明文：

| 操作 | `action` | 內容 |
| --- | --- | --- |
| 設定頁建立、撤銷 API 金鑰 | `settings.update` | `payload.section` 是 `api-keys`，`operation` 是 `create` 或 `revoke`，`apiKeyId` 是金鑰的 id |
| 設定頁建立、撤銷 CLI token | `settings.update` | `payload.section` 是 `cli-sessions`，`operation` 是 `create` 或 `revoke`，`sessionId` 是 token 的 id |
| `POST /auth/cli/login`、`/auth/cli/logout` | `cli_session.login`、`cli_session.logout` | `targetType` 是 `cli_session`，`targetId` 是 token 的 id |

撤銷的對象不存在、屬於另一個租戶或已經撤銷時，不寫稽核。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 側欄「設定」的各子項目 | 各分頁自己讀取 | 側欄的「營業時間」「追蹤設定」「API 金鑰」「CLI 連線」沒有 `perm`，`SETTINGS_TABS` 也沒有。沒有 `settings.manage` 的成員看得到這四項，打開顯示「無法讀取…：權限不足」，API 金鑰與 CLI 頁仍有「建立金鑰」「產生 Token」按鈕（HC-SETTINGS-02）。跨渠道綁定、WebTalk、A2A 有 `perm`，頁內也以 `PermissionDenied` 擋下 |
| 一般設定 `/dashboard/settings/general` | `PATCH /agents/me/password` | 見[一般設定](#一般設定) |
| 營業時間 `/dashboard/settings/office-hours`（`OfficeHoursSettings.tsx`） | `GET`、`PUT /settings/office-hours` | 讀取失敗時不顯示表單，避免以預設值覆蓋正式設定 |
| 追蹤設定 `/dashboard/settings/tracking`（`TrackingSettings.tsx`） | `GET`、`PUT /settings/tracking` | 讀取失敗時不顯示表單 |
| 跨渠道綁定 `/dashboard/settings/identity-binding` | `GET`、`PUT /settings/identity-binding` | 關鍵字的錯誤顯示在欄位下。存檔後呼叫 `resetIdentityBindingStatusCache`，讓收件匣的代發按鈕跟著開關更新 |
| WebTalk 協作 `/dashboard/settings/webtalk` | `GET`、`PUT /webtalk/settings`、`POST /webtalk/settings/rotate-room` | 頁面不顯示伺服器有沒有設定 WebTalk。伺服器沒有設定時，頁面照樣可以切換開關（HC-SETTINGS-15） |
| API 金鑰 `/dashboard/settings/api-keys`（`ApiKeyManagement.tsx`） | `GET`、`POST`、`DELETE /settings/api-keys` | 列表的狀態只看撤銷，已過期的金鑰也顯示「啟用中」（HC-SETTINGS-09） |
| CLI 連線 `/dashboard/settings/cli-sessions`（`CliSessionManagement.tsx`） | `GET`、`POST`、`DELETE /settings/cli-sessions` | 過期的 token 不標示（HC-SETTINGS-09） |
| Passkey 登入 `/dashboard/settings/passkeys` | `/auth/passkeys` | 只管理自己的 Passkey |
| A2A `/dashboard/settings/a2a` | `GET /settings/a2a` | 唯讀 |
| AI 設定 `/dashboard/knowledge/chat-prompt`、`/dashboard/knowledge/embedding` | `/settings/chat`、`/settings/embedding`、`/settings/gemini-key` | 頁面屬於知識庫，見[知識庫與 AI](./KNOWLEDGE.md#ai-設定) |

追蹤設定與營業時間儲存失敗時，以 `getApiErrorMessage` 顯示通用訊息「輸入內容有誤，請檢查後重新送出」，不顯示回應 `error.details.issues` 的欄位訊息（HC-SETTINGS-08）。

畫面送出的值：

- 營業時間：`{ timezone, officeHours: { enabled, schedule, holidays, outsideHoursMessage } }`。
  - `timezone` 只有 7 個選項：`Asia/Taipei`、`Asia/Tokyo`、`Asia/Shanghai`、`Asia/Hong_Kong`、`Asia/Singapore`、`America/New_York`、`Europe/London`。後端接受任何有效的 IANA 時區。
  - `schedule` 是 `mon`～`sun`，每天是 `{ start: "HH:mm", end: "HH:mm" }` 或 `null`。`type=time` 的欄位清空時送 `""`，後端回 400。
  - `holidays` 是 `"YYYY-MM-DD"` 的陣列。
- 追蹤：`{ gaId: trim() || null, metaPixelId: trim() || null }`。
- 跨渠道綁定：七個欄位全送。關鍵字以 `、`、`,`、`，`、換行切開，再去除空白與空字串。
- WebTalk：`{ enabled, aiEnabled }`。
- API 金鑰：`{ name: trim(), expiresInDays }`。`expiresInDays` 的選項是 30、90、180、365，選「永不過期」時不送。後端接受 1～365。
- CLI：`{ name: trim(), mcpRead, expiresInDays }`。`expiresInDays` 的選項是 7、30、90、365，預設 30。後端接受 1～365。
- 改密碼：`{ currentPassword, newPassword }`。

下列功能沒有畫面入口：

- `TenantSettings.inactivityCloseHours`：連後端路由也沒有（CONV-01）。
- `POST /settings/cli-sessions` 的 `scopes` 欄位：畫面只有 MCP 勾選。
- `POST /auth/cli/login`：`open333 login` 使用。
- `GET /webtalk/session` 回應的 `reason`：設定頁不顯示。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| CLI token 不受角色與方案限制 | 詳見 `../../system/AUDIT.md` 的 RBAC-02 |
| API 金鑰不受租戶停用與建立者清除影響 | 詳見 `../../system/AUDIT.md` 的 AUTH-02 |
| A2A 以最早建立的租戶執行任務 | 詳見 `../../system/AUDIT.md` 的 A2A-01 |
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

