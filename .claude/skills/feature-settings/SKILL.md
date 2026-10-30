---
name: feature-settings
description: >
  open333CRM「租戶設定」功能顧問：設定頁 /dashboard/settings/* 的存取與儲存，以及營業時間（非營業時間自動回覆、時區、假日）、
  追蹤設定（GA4、Meta Pixel）、跨渠道綁定與 email／手機登記開關和關鍵字、WebTalk 協作、Partner API 金鑰、
  CLI 連線與 MCP 唯讀權限、A2A 狀態頁、AI 設定（Chat、Embedding、自備 Gemini 金鑰）的儲存路由。
  當需求、bug 或新功能碰到 settings 模組、settings.routes.ts、TenantSettings、settings.manage、office-hours、tracking、
  identity-binding 設定、webtalk、api-keys、partner key、cli-sessions、CLI token、mcp、a2a，或使用者說
  「營業時間存不了／頁面壞掉」、「下班自動回覆沒反應」、「設定頁看得到但打不開」、「金鑰／token 怎麼管」、「GA 沒收到」時使用。
  也在改側欄權限、租戶稽核、短連結追蹤碼、聯絡人綁定流程、知識庫 AI 設定前使用，確認不破壞設定的讀寫。
---

# 租戶設定

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/SETTINGS.md`
  - 注意：其中的分頁表少了「跨渠道綁定」與「門市與核銷帳號」，「稽核」一節的 `section` 清單少了 `identity-binding` 與 `webtalk`，也沒寫營業時間在 `officeHours` 為 `{}` 時的狀況。見健檢的「文件過時之處」。
- 健檢結果與已知問題：`docs/ref/features/health/SETTINGS.md`
- 規格：`openspec/specs/office-hours-settings/spec.md`、`openspec/specs/tracking-settings/spec.md`、`openspec/specs/webtalk-collaboration/spec.md`、`openspec/specs/open333-cli-auth/spec.md`、`openspec/specs/a2a-agent-tenant-routing/spec.md`（側欄的權限規則在 `openspec/specs/permission-check/spec.md` 與 `openspec/specs/dashboard-tree-navigation/spec.md`）
- 手冊：`apps/web/public/manual/ch17-settings.html`（AI 設定在 `apps/web/public/manual/ch07-ai-settings.html`）
- 影響分析：`node scripts/feature-impact.mjs --domain settings`

路由前綴：`/api/v1/settings`（`apps/api/src/modules/settings/settings.routes.ts`，整個 plugin 掛 `authenticate` + `requirePermission("settings.manage")`）、
`/api/v1/webtalk`（`apps/api/src/modules/webtalk/webtalk.routes.ts`，設定類端點逐條掛 `settings.manage`）、
`/api/v1/auth/passkeys`（`apps/api/src/modules/auth/auth.routes.ts`，只驗登入）、`/api/v1/agents/me/password`、`/mcp`。

分頁清單在 `apps/web/src/app/dashboard/settings/page.tsx` 的 `SETTINGS_TABS`，側欄在 `apps/web/src/components/layout/Sidebar.tsx`。
渠道、人員、角色、標籤、SLA、門市各有自己的領域（channels、members、contacts、sla、marketing），本領域只負責它們共用的「設定頁殼」。

## 前端操作流程

格式：入口 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 進入設定頁 | 側欄「設定」各子項目；`/dashboard/settings/<section>`，不認得的 section 顯示一般設定 | 各分頁自己讀取 | — | **側欄的營業時間、追蹤設定、API 金鑰、CLI 連線沒有 `perm`**，沒有 `settings.manage` 的成員看得到，打開顯示「無法讀取…：權限不足」，API 金鑰與 CLI 頁仍有「建立金鑰」「產生 Token」鈕（健檢 HC-SETTINGS-02）。跨渠道綁定、WebTalk、A2A 有 `perm`，頁內也用 `PermissionDenied` 擋 |
| 2 | 一般設定：改自己的密碼 | `/dashboard/settings/general` | `PATCH /agents/me/password {currentPassword, newPassword}` → `changeOwnPasswordFlow` | 舊密碼立即不能登入；refresh token 不失效（AUDIT AUTH-08） | 只驗登入 / 不需隱藏。姓名、email、角色唯讀，沒有改名端點 |
| 3 | 營業時間 | `/dashboard/settings/office-hours` | `GET`、`PUT /settings/office-hours {timezone, officeHours}` → `office-hours.service.ts` `getOfficeHours`／`updateOfficeHours` | 稽核 `settings.update`（`section: office-hours`）。進站時 `inbound-side-effects.ts` 的 `sendOutsideHoursAutoReply` 依設定送 SYSTEM 訊息（同一聯絡人 30 分鐘一次，記憶體去重）；渠道 `botConfig.offlineGreeting` 優先 | `settings.manage` / **側欄不隱藏**。讀取失敗時不顯示表單（規格 `office-hours-settings`）。**`officeHours` 為 `{}` 時按「啟用」整頁崩潰**（HC-SETTINGS-01） |
| 4 | 追蹤設定 | `/dashboard/settings/tracking` | `GET`、`PUT /settings/tracking {gaId, metaPixelId}` → `tracking-settings.service.ts` | 稽核只記有沒有填；短連結中轉頁輸出追蹤碼 | `settings.manage` / **側欄不隱藏** |
| 5 | 跨渠道綁定、email／手機登記 | `/dashboard/settings/identity-binding` | `GET`、`PUT /settings/identity-binding`（7 個欄位）→ `binding-links.ts` 的 `applyIdentityBindingUpdate`、`findIdentityBindingKeywordIssue`，寫 `TenantSettings.identityBinding` | `invalidateIdentityBindingSettings`（API 行程內快取 15 秒）；稽核記三個開關；前端 `resetIdentityBindingStatusCache` 讓收件匣代發按鈕更新 | `settings.manage` / 側欄與頁面都隱藏 |
| 6 | WebTalk 協作 | `/dashboard/settings/webtalk` | `GET`、`PUT /webtalk/settings {enabled?, aiEnabled?}`、`POST /webtalk/settings/rotate-room` → `webtalk.flow.ts` | 同交易寫稽核（`section: webtalk`）；成員重新整理才生效 | `settings.manage` / 隱藏。頁面不顯示伺服器是否設定 WebTalk（HC-SETTINGS-15）。WebTalk 是外加外掛，手冊不介紹 |
| 7 | Partner API 金鑰 | `/dashboard/settings/api-keys` | `GET`、`POST /settings/api-keys {name, expiresInDays?}`、`DELETE /settings/api-keys/:id`（設 `isActive=false`）→ `partner-api-key.service.ts` | 完整金鑰只回一次、存 bcrypt 雜湊；**沒有稽核**（AUD-01）；只能通過 `knowledge.admin`（`rbac.guard.ts` 的 `PARTNER_KEY_ALLOWED`） | `settings.manage` / **側欄不隱藏，建立鈕也不隱藏** |
| 8 | CLI 連線與 MCP | `/dashboard/settings/cli-sessions` | `GET`、`POST /settings/cli-sessions {name, mcpRead, expiresInDays}`、`DELETE /settings/cli-sessions/:id` → `cli-session.service.ts` | 列出租戶內所有成員的 token（含 `open333 login` 自動產生的）；勾「MCP 唯讀」加 `mcp:read`，可呼叫 `POST /mcp`（`mcp.routes.ts`）；**沒有稽核**（AUD-01） | `settings.manage` / **不隱藏**。scope 由請求自帶、不看角色與方案（RBAC-02） |
| 9 | Passkey | `/dashboard/settings/passkeys` | `GET /auth/passkeys`、`PATCH`、`DELETE /auth/passkeys/:id`、註冊 `POST /auth/passkeys/register/*` | 只管自己的 Passkey；未設定 `WEBAUTHN_RP_ID`、`WEBAUTHN_ORIGIN` 時頁面顯示未啟用 | 只驗登入 |
| 10 | A2A 狀態 | 側欄「設定 → 整合 → A2A」 | `GET /settings/a2a` → `a2a-status.service.ts` `buildA2AStatus` | 唯讀，資料來自環境變數，全部租戶看到同一座橋接（A2A-01） | `settings.manage` / 隱藏。「目前狀態」只要有 `A2A_AGENT_ID` 就顯示 connected（HC-SETTINGS-05） |
| 11 | AI 設定的儲存（頁面歸 knowledge） | `/dashboard/knowledge/chat-prompt`、`/dashboard/knowledge/embedding` | `GET`、`PUT /settings/chat`、`/settings/embedding`、`/settings/gemini-key`；`GET /settings/chat/models`、`POST /settings/chat/health`、`/settings/embedding/health` | 稽核只記改了哪些欄位名（`keys`），金鑰只記 set/clear | `settings.manage` / 側欄「AI 設定」隱藏 |

**有後端、沒有前端入口**：`TenantSettings.inactivityCloseHours`（連後端路由都沒有，CONV-01）；`POST /settings/cli-sessions` 的 `scopes` 欄位（UI 只有 MCP 勾選）；`POST /auth/cli/login`（`open333 login` 用）；`GET /webtalk/session` 的 `reason`（設定頁不顯示）；營業時間 `timezone` 後端收任意字串，UI 只有 7 個選項；API 金鑰與 CLI 的 `expiresInDays` 後端收任意正整數，UI 只有固定選項。

**前端實際送出的值**：
- 營業時間：`{ timezone: "Asia/Taipei"|"Asia/Tokyo"|"Asia/Shanghai"|"Asia/Hong_Kong"|"Asia/Singapore"|"America/New_York"|"Europe/London", officeHours: { enabled, schedule: { mon…sun: {start:"HH:mm", end:"HH:mm"} | null }, holidays: ["YYYY-MM-DD"], outsideHoursMessage } }`。`type=time` 清空會送 `""`，後端回 400。
- 追蹤：`{ gaId: trim() || null, metaPixelId: trim() || null }`。
- 跨渠道綁定：七個欄位全送，關鍵字以 `、` `,` `，` 換行切開後 trim、去空字串。
- WebTalk：`{ enabled, aiEnabled }`。
- API 金鑰：`{ name: trim(), expiresInDays?: 30|90|180|365 }`（永不過期時不送）。
- CLI：`{ name: trim(), mcpRead, expiresInDays: 7|30|90|365 }`（預設 30）。
- 改密碼：`{ currentPassword, newPassword }`，前端擋 8 字以下、與舊密碼相同、兩次不符。

## 不可破壞的規則
- `settings.routes.ts` 整組要 `settings.manage`。新增設定端點放進這個 plugin 就自動受保護；放在別的模組要自己掛 guard。
- **側欄顯示不是授權**：前端隱藏與否不影響後端 403，但規格要求側欄隱藏沒權限的項目，新增分頁時 `Sidebar.tsx` 與 `SETTINGS_TABS` 的 `perm` 要和後端 guard 一致。
- `TenantSettings` 一個租戶一列，開通租戶時不會建立，第一次讀取任何設定或第一次呼叫 AI 時才建立。由營業時間以外的路徑建立時，`officeHours` 是 schema 預設的 `{}`，**讀營業時間的程式要把 `{}` 視為沒有設定**。
- 讀取設定失敗時，前端不可顯示預設值讓人儲存（營業時間、追蹤設定都已照做），否則會覆蓋正式設定。
- 追蹤 ID 會進公開頁的 `<script>`：只收 `GA4_ID_PATTERN`、`META_PIXEL_ID_PATTERN`，產生頁面時再驗一次。不要放寬格式。
- `PUT /settings/tracking` 是整筆取代：沒送的欄位存成 `null`。
- `PUT /settings/identity-binding` 沒送的 email／手機欄位沿用已存值；`確認綁定` 不可當關鍵字；各方式關鍵字不可互相重複（不分大小寫）。改完一定要呼叫 `invalidateIdentityBindingSettings`。
- 稽核只記「哪一區、哪些欄位、有沒有設定」，**不記 ID、prompt、金鑰的值**。
- Partner API 金鑰與 CLI token 的明文只在建立時回一次；資料庫只存雜湊。列表與 API 不可回傳明文。
- WebTalk 房間代號只由 `GET /webtalk/session` 發給真人成員（Partner key、CLI token 回 403）；`/webtalk/ai-disabled` 在 `onRequest` 就回 403，不讀 body。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain settings` 看最新版本。重點：
- **被依賴**：聯絡人（綁定與登記開關、關鍵字）、知識庫（Chat／Embedding／金鑰路由、Partner API 金鑰）、短連結（GA／Pixel）、收件匣（非營業時間自動回覆、閒置關閉）、數據分析（CLI 報表）、LINE（MCP 的 LINE 工具）。
- **依賴**：成員（`settings.manage` 由角色授予，admin 與 supervisor 預設都有；改密碼與 Passkey 的程式歸成員）、治理（租戶稽核）、渠道（`offlineGreeting`、導流識別）、收件匣（自動回覆在進站管線）、平台租戶（停用租戶不讓長效憑證失效，AUTH-02）。

## 回歸清單
改到本領域時，至少重走：
1. 用沒有 `settings.manage` 的帳號看側欄與每個設定分頁：應隱藏或顯示「沒有權限」，後端回 403 `requiredPermission: settings.manage`。
2. 營業時間：在 `officeHours` 為 `{}` 的租戶打開頁面、啟用、設定、儲存、重新整理後一致；用 WebChat 在非營業時間傳訊息，收到一則 SYSTEM 自動回覆，30 分鐘內第二則不再回。
3. 追蹤設定：合格 ID 存入後重新整理一致；`g-abc` 被拒且原值不變；清空後兩欄都是 `null`；看稽核 payload 不含 ID。
4. 跨渠道綁定：關鍵字衝突（綁定＝解除、用「確認綁定」、email 關鍵字＝綁定關鍵字、超過 5 個、超過 20 字、空白）都顯示在欄位下；正向存入後重新整理一致；收件匣代發按鈕跟著開關。
5. API 金鑰：建立 → 明文只顯示一次 → 撤銷後 `POST /knowledge/partner-ingest` 回 401；CLI token：建立（勾 MCP）→ `POST /mcp` 列出 tools 成功 → 撤銷後 `/auth/me` 回 401。
6. 每個改過的設定都改回原值。
- 自動測試：`pnpm --filter @open333crm/api test -- modules/settings modules/webtalk modules/auth/cli-session knowledge-partner-key modules/mcp`；`pnpm --filter @open333crm/web test -- components/settings dashboard/settings lib/webtalk webmcp tree-navigation`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/settings modules/webtalk modules/mcp modules/shortlink/shortlink-tracking-injection`。
- E2E：`apps/web/tests/e2e-uat/tenant-settings-ops.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-settings.spec.ts`。

## 常見 bug 從哪裡查
- 「營業時間按啟用頁面變白」：資料庫 `tenant_settings.officeHours` 是 `{}`。`apps/api/src/modules/settings/office-hours.service.ts` 的 `getOfficeHours` 只在沒有這一列時給預設值；前端 `apps/web/src/components/settings/OfficeHoursSettings.tsx` 直接讀 `config.schedule[day]`。
- 「下班了卻沒有自動回覆」：依序查 `officeHours.enabled`、時區是否合法（不合法時只在 API log 印 `Office hours auto-reply error`）、渠道 `botConfig.offlineGreeting`、30 分鐘去重（API 重啟會清空）、時段是否跨午夜（不支援，整天都算非營業）。程式在 `apps/api/src/modules/webhook/inbound-side-effects.ts`。
- 「營業時間內也自動回覆」：多半是結束時間早於開始時間（跨午夜）或假日清單有今天。
- 「設定頁看得到選單、打開說權限不足」：`apps/web/src/components/layout/Sidebar.tsx` 的該項目沒有 `perm`（HC-SETTINGS-02）。
- 「儲存失敗只說輸入內容有誤」：追蹤設定與營業時間用 `getApiErrorMessage`，沒有讀 `details.issues`；真正原因看 Network 回應的 `error.details.issues`。
- 「合作方說金鑰不能用」：先看列表狀態與過期時間（已過期仍顯示「啟用中」）；過期回 `API key expired`、撤銷或打錯回 `Invalid API key`；沒帶 `cmd` 回 400 `INVALID_CMD`。驗證在 `apps/api/src/modules/auth/partner-api-key.service.ts`。
- 「CLI／MCP 連不上」：`apps/api/src/modules/auth/cli-session.service.ts` 的 `verifyCliSession` 依序檢查撤銷、過期、成員停用；MCP 另檢查 Origin 與 `mcp:*` scope（`apps/api/src/modules/mcp/mcp.routes.ts`）。
- 「改了跨渠道綁定沒生效」：API 行程內快取 15 秒；多個 API 行程時另一個行程要等快取過期（APP-09）。
