---
name: feature-platform-tenants
description: >
  open333CRM「平台後台：租戶管理」功能顧問：租戶列表與詳細頁、手動開通、停用與啟用、合約日期、試用資料清除與復原。改到 /admin/tenants、platform-tenant.service、provisionTenant、setTenantActive，或改 webhook 進站、群發排程之前使用。
---

# 平台後台：租戶管理

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。租戶管理的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

租戶列表、租戶詳細頁（資料量統計、基本資料、改方案、操作紀錄）、手動開通租戶與開通信（`loginUrl`、信裡沒有密碼）、重寄開通信、
改成員登入 Email、停用與啟用租戶（擋登入、擋 refresh、丟棄進站訊息）、合約起訖日、試用資料清除（`purgedAt`）與復原、個資遮罩開關，
以及這些操作寫的平台稽核 `platform_audit_logs`。
相關的程式與資料：`/admin/tenants`、`/admin/tenants/[id]`、`platform-tenant.service`、`provisionTenant`、`setTenantActive`、`tenant.isActive`、`TENANT_DISABLED`。
常見的說法：「租戶停用多久生效」「改成員 email」「重寄開通信」「合約日期」「復原已清除租戶」。
改試用開通、方案指派、租戶登入、webhook 進站、群發排程之前也使用，確認停用租戶的行為沒被破壞。

## 先讀

先讀功能文件 `docs/ref/features/platform/TENANTS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `TENANTS.md` 的章節 |
| --- | --- |
| 找路由對應的服務函式 | 程式的入口 |
| 路由的行為、回傳的錯誤 | 平台能對租戶做什麼 |
| 開通、`provisionTenant()`、`trialEndsAt` | 開通一個租戶建立了什麼、手動開通的信裡沒有密碼 |
| 改方案與快取 | 改方案的連帶效果 |
| 合約日期與到期提醒 | 合約日期 |
| 新增異動路由、稽核的 payload | 平台稽核 |
| 停用租戶的保護點、新增進站入口 | 停用租戶多久生效 |
| 個資遮罩 | 平台控制個資遮罩 |
| 前端頁面 | 畫面怎麼呼叫 API |

共通機制（稽核、快取連鎖、資料模型）見 `docs/ref/features/platform/README.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/platform/`、`apps/api/tests/feature/modules/platform/`、`apps/web/tests/unit/app/admin/`，寫法可以照著參考。停用租戶的 feature 測試在 `apps/api/tests/feature/modules/auth/`、`chatbox/`、`marketing/`、`csat/` 的 `*-disabled-*` 檔。`tenant-provisioning` 的 4 個 scenario 沒有任何測試。

`TENANTS.md` 裡標 `HC-PLATFORM-TENANTS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-TENANTS.md`
- 規格：`openspec/specs/tenant-provisioning/spec.md`、`openspec/specs/tenant-contract-dates/spec.md`、`openspec/specs/trial-data-purge/spec.md`
- 停用租戶的規格：
  - `openspec/specs/auth-session/spec.md`（「停用租戶的成員不能登入或換發 token」「停用租戶的長效憑證與既有連線失效」）
  - `openspec/specs/inbound-message-processing/spec.md`（「停用租戶的進站事件直接丟棄」「停用租戶的網站聊天室入口回 404」）
  - `openspec/specs/marketing-scheduling/spec.md`（「The Scheduler Does Not Send Broadcasts Of A Disabled Tenant」）
  - `openspec/specs/csat-survey/spec.md`（「停用租戶不寄出滿意度問卷」）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-tenants`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `TENANTS.md` 括號內的章節。

- `provisionTenant(tx, …)` 必須收呼叫端的交易。試用開通把它和 token 消耗放在同一個交易。email 的唯一檢查刻意放在交易外，讓衝突回 409，不是 `P2002`。（開通一個租戶建立了什麼）
- 手動開通不設 `trialEndsAt`，只有試用開通才設。改這一點會讓試用排程停用這個租戶。（開通一個租戶建立了什麼）
- 停用租戶的保護點：`login()` 驗完密碼才回 403 `TENANT_DISABLED`、`POST /auth/refresh` 回查 `tenant.isActive`、webhook 與網站聊天室丟棄停用租戶的進站事件。新增任何進站入口或憑證類型，都要補 `tenant.isActive` 檢查。（停用租戶多久生效）
- 稽核由路由寫，服務不寫。新增異動路由要自己呼叫 `writePlatformAudit()`，並加進 `platform-audit-routes.test.ts` 的清單。（平台稽核）
- 開通稽核的 payload 不可含密碼。（平台稽核）
- 換方案要同時失效 `invalidatePlanPermissions` 與 `invalidateTenantPlan`。（改方案的連帶效果）
- 合約日期唯一的自動行為是到期前提醒平台帳號。合約到期不可停用租戶、清除資料或改方案。（合約日期）
- 復原不改 `isActive`。延長與轉正式才會同時清除 `purgedAt` 並啟用。（平台能對租戶做什麼）
- `platform.routes.ts` 在路由函式內註冊 rate-limit。拆檔前讀 `docs/ref/system/AUDIT.md` 的 SEC-03。（程式的入口）

## 回歸清單

改到本領域時，至少重走下列項目。用 `hc-` 前綴的自建租戶，**不要停用 Demo 或任何既有租戶**。

1. 手動開通：
   - DB 有 Tenant、三個系統角色、ADMIN。
   - 以該帳號登入租戶後台成功。
   - API log 有開通信（`EMAIL_DELIVERY_MODE=log` 只印主旨與 `loginUrl`）。
   - 稽核有 `tenant.provision`。
   - 錯誤情況：重複 email 409、密碼不足 8 字 400、方案不存在 404。
2. 停用：
   - 正確密碼登入 403 `TENANT_DISABLED`、錯誤密碼 401、refresh 401。既有的 access token 可用到過期。
   - LINE/FB webhook 不建資料。
   - WebChat 既有工作階段送訊息、新開工作階段，都回 404，不建資料。
   - 到期的排程群發標 `failed`（`TENANT_DISABLED`），不送出。
   - 啟用之後恢復。
3. 合約：設起訖、只送一個、送 null 清除、迄日早於起日 422。列表與詳細頁讀回一致。
4. 詳細頁：改成員 email（成功、409、格式錯）、重寄開通信、改名稱與方案、操作紀錄有對應的紀錄。
5. `/admin/trial` 復原已清除租戶：成功、422 `NOT_PURGED`、404。

自動測試：

- `pnpm --filter @open333crm/api test -- platform tenant-plan`
- `pnpm --filter @open333crm/web test -- admin`
- feature 測試先搶鎖，**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/platform modules/trial modules/auth/tenant-disabled-access modules/chatbox/chatbox-disabled-tenant modules/marketing/broadcast-disabled-tenant modules/csat/csat-disabled-tenant`
- E2E：
  - `apps/web/tests/e2e-uat/cross-tenant-lifecycle.spec.ts` 會在目標環境開通並停用 `[E2E]` 租戶。**UAT 是正式環境，不要跑**。其中「✓ 已開通」的斷言與畫面不符，這支測試會失敗（HC-PLATFORM-TENANTS-16）。
  - `apps/web/tests/e2e-uat/platform-smoke.spec.ts`

## 常見 bug 從哪裡查

- 「租戶停用了還在收訊息」：
  - 先看渠道類型。LINE、FB、IG 在 `webhook.service.ts`、`webhook-account-routing.ts` 擋，WebChat 在 `chatbox.service.ts` 擋。
  - 新的進站入口沒有檢查 `tenant.isActive`，就會漏掉。
- 「停用了成員還能操作」：REST 最長一個 access token 有效期；Socket、CLI token、Partner API 金鑰都不受影響（AUTH-02）。
- 「按了停用沒反應」：列表頁 `toggleActive` 沒有 try/catch，錯誤只在 console（HC-PLATFORM-TENANTS-03）。
- 「開通的試用租戶沒有到期」：手動開通不設 `trialEndsAt`（HC-PLATFORM-TENANTS-05）。要試用期，請走試用申請。
- 「改了方案權限沒變」：租戶方案快取是行程內 60 秒，多行程只清得掉自己的（`apps/api/src/services/tenant-plan.cache.ts`）。
- 「客戶說收不到開通信」：寄信失敗只寫 log（`[TrialEmail] send failed`），畫面仍顯示成功（HC-PLATFORM-TENANTS-06）。查 API log。
- 「成員改了 email 登不進去」：email 區分大小寫（AUTH-10）。確認輸入與資料庫的大小寫一致。
- 「詳細頁一直載入中」：租戶不存在或 id 不是 UUID（HC-PLATFORM-TENANTS-09）。
