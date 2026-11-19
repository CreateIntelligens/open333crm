---
name: feature-settings
description: >
  open333CRM「租戶設定」功能顧問：/dashboard/settings/* 的存取與儲存、營業時間、追蹤碼、綁定設定、Partner API 金鑰、CLI 與 MCP、AI 設定的儲存。改到 settings 模組、TenantSettings、settings.manage，或改側欄權限之前使用。
---

# 租戶設定

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。租戶設定的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

設定頁 `/dashboard/settings/*` 的存取與儲存。營業時間（非營業時間自動回覆、時區、假日）、追蹤設定（GA4、Meta Pixel）、跨渠道綁定與 email／手機登記的開關和關鍵字、WebTalk 協作、Partner API 金鑰、CLI 連線與 MCP 唯讀權限、A2A 狀態頁、AI 設定（Chat、Embedding、自備 Gemini 金鑰）的儲存路由。
相關的程式與資料：settings 模組、`settings.routes.ts`、`TenantSettings`、`settings.manage`、office-hours、tracking、identity-binding 設定、webtalk、api-keys、partner key、cli-sessions、CLI token、mcp、a2a。
「營業時間存不了／頁面壞掉」「下班自動回覆沒反應」「設定頁看得到但打不開」「金鑰／token 怎麼管」「GA 沒收到」也使用。改側欄權限、租戶稽核、短連結追蹤碼、聯絡人綁定流程、知識庫 AI 設定之前也使用。
渠道、人員、角色、標籤、SLA、門市各有自己的領域；本領域只負責它們共用的設定頁殼。

## 先讀

先讀功能文件 `docs/ref/features/tenant/SETTINGS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `SETTINGS.md` 的章節 |
| --- | --- |
| 分頁清單、`settings.manage` 的範圍、`TenantSettings` 何時建立 | 分頁與模組 |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 一般設定、改自己的密碼 | 一般設定 |
| 營業時間的檢查、讀取、自動回覆 | 營業時間 |
| 跨渠道綁定的欄位、關鍵字規則、快取 | 跨渠道綁定 |
| GA4、Meta Pixel | 追蹤設定 |
| Partner API 金鑰的權限與錯誤 | API 金鑰 |
| CLI token、MCP | CLI 連線 |
| Passkey | Passkey 登入 |
| A2A 狀態 | A2A |
| 稽核記什麼 | 稽核 |
| WebTalk 的房間、設定、AI 摘要 | WebTalk 協作 |
| 側欄、前端送出的值、沒有畫面入口的功能 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的設定測試在 `apps/api/tests/unit/modules/settings/`、`apps/api/tests/feature/modules/settings/`、`apps/web/tests/unit/components/settings/`、`apps/web/tests/unit/app/dashboard/settings/`，寫法可以照著參考。

`SETTINGS.md` 裡標 `HC-SETTINGS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/SETTINGS.md`
- 規格：`openspec/specs/office-hours-settings/spec.md`、`openspec/specs/tracking-settings/spec.md`、`openspec/specs/webtalk-collaboration/spec.md`、`openspec/specs/open333-cli-auth/spec.md`、`openspec/specs/a2a-agent-tenant-routing/spec.md`
  - 側欄的權限規則在 `openspec/specs/permission-check/spec.md` 與 `openspec/specs/dashboard-tree-navigation/spec.md`。
- 手冊：`apps/web/public/manual/ch17-settings.html`（AI 設定在 `apps/web/public/manual/ch07-ai-settings.html`）
- 影響分析：`node scripts/feature-impact.mjs --domain settings`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `SETTINGS.md` 括號內的章節。

- `settings.routes.ts` 整組要 `settings.manage`。新增設定端點放進這個 plugin 就自動受保護；放在別的模組要自己掛 guard。（分頁與模組）
- 側欄顯示不是授權。新增分頁時，`Sidebar.tsx` 與 `SETTINGS_TABS` 的 `perm` 要和後端 guard 一致。（畫面怎麼呼叫 API）
- 讀營業時間一律經過 `readOfficeHoursSettings()`（`settings/office-hours-settings.ts`）。寫入與讀取用同一份 `officeHoursSettingsSchema`。（營業時間）
- 讀取設定失敗時，前端不可顯示預設值讓人儲存。（畫面怎麼呼叫 API）
- 追蹤 ID 只收 `GA4_ID_PATTERN`、`META_PIXEL_ID_PATTERN`，產生頁面時再驗一次。不要放寬格式。`PUT /settings/tracking` 是整筆取代。（追蹤設定）
- `PUT /settings/identity-binding` 的關鍵字規則不可放寬。改完一定要呼叫 `invalidateIdentityBindingSettings`。（跨渠道綁定）
- 稽核不記 ID、prompt、金鑰的值。（稽核）
- Partner API 金鑰與 CLI token 的明文只在建立時回一次，資料庫只存雜湊。列表與 API 不可回傳明文。（API 金鑰、CLI 連線）
- WebTalk 房間代號只由 `GET /webtalk/session` 發給真人成員。`/webtalk/ai-disabled` 在 `onRequest` 就回 403，不讀 body。（WebTalk 協作）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。

## 回歸清單

改到本領域時，至少重走：

1. 用沒有 `settings.manage` 的帳號看側欄與每個設定分頁：應隱藏或顯示「沒有權限」。後端回 403，`requiredPermission: settings.manage`。
2. 營業時間：
   - 在 `officeHours` 為 `{}` 的租戶打開頁面、啟用、設定、儲存。重新整理後一致。
   - 用 WebChat 在非營業時間傳訊息：收到一則 SYSTEM 自動回覆。30 分鐘內的第二則不再回。
3. 追蹤設定：
   - 合格的 ID 存入後重新整理一致。
   - `g-abc` 被拒，原值不變。
   - 清空後兩欄都是 `null`。
   - 稽核 payload 不含 ID。
4. 跨渠道綁定：
   - 關鍵字衝突都顯示在欄位下：綁定＝解除、用「確認綁定」、email 關鍵字＝綁定關鍵字、超過 5 個、超過 20 字、空白。
   - 正向存入後重新整理一致。
   - 收件匣的代發按鈕跟著開關。
5. 憑證：
   - API 金鑰：建立 → 明文只顯示一次 → 撤銷後 `POST /knowledge/partner-ingest` 回 401。
   - CLI token：建立（勾 MCP）→ `POST /mcp` 列出 tools 成功 → 撤銷後 `/auth/me` 回 401。
6. 每個改過的設定都改回原值。

自動測試：

- `pnpm --filter @open333crm/api test -- modules/settings modules/webtalk modules/auth/cli-session knowledge-partner-key modules/mcp`
- `pnpm --filter @open333crm/web test -- components/settings dashboard/settings lib/webtalk webmcp tree-navigation`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/settings modules/webtalk modules/mcp modules/shortlink/shortlink-tracking-injection`
- E2E：`apps/web/tests/e2e-uat/tenant-settings-ops.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-settings.spec.ts`

## 常見 bug 從哪裡查

- 「營業時間頁面變白」：查 `GET /settings/office-hours` 的回應有沒有 `schedule`。後端應以 `readOfficeHoursSettings()` 回傳完整的預設值。前端 `apps/web/src/components/settings/OfficeHoursSettings.tsx` 直接讀 `config.schedule[day]`。
- 「下班了卻沒有自動回覆」：依序查：
  1. `officeHours.enabled`。已存的設定不合法時一律當作停用，`GET` 回 `enabled: false`。
  2. 渠道的 `botConfig.offlineGreeting`。
  3. 30 分鐘的去重。API 重新啟動會清空。
  - 程式在 `apps/api/src/modules/webhook/inbound-side-effects.ts`。
- 「營業時間內也自動回覆」：多半是假日清單有今天，或時區選錯。跨午夜的時段存不進去（回 400）。
- 「設定頁看得到選單、打開說權限不足」：`apps/web/src/components/layout/Sidebar.tsx` 的該項目沒有 `perm`（HC-SETTINGS-02）。
- 「儲存失敗只說輸入內容有誤」：追蹤設定與營業時間沒有讀 `details.issues`（HC-SETTINGS-08）。真正的原因看 Network 回應的 `error.details.issues`。
- 「合作方說金鑰不能用」：
  - 先看列表的狀態與過期時間。已過期的金鑰仍顯示「啟用中」（HC-SETTINGS-09）。
  - 過期回 `API key expired`；撤銷或打錯回 `Invalid API key`；沒帶 `cmd` 回 400 `INVALID_CMD`。
  - 驗證在 `apps/api/src/modules/auth/partner-api-key.service.ts`。
- 「CLI／MCP 連不上」：`apps/api/src/modules/auth/cli-session.service.ts` 的 `verifyCliSession` 依序檢查撤銷、過期、成員停用。MCP 另檢查 Origin 與 `mcp:*` scope（`apps/api/src/modules/mcp/mcp.routes.ts`）。
- 「改了跨渠道綁定沒生效」：API 行程內的快取 15 秒。有多個 API 行程時，其他行程要等快取過期（APP-09）。
