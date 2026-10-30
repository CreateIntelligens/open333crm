---
name: feature-platform-plan-changes
description: >
  open333CRM「方案異動申請與審核」功能顧問：租戶在 /dashboard/plan（方案／帳務）送出升級方案或加購 AI token 申請，
  平台在 /admin/plan-changes（升級申請）核准或駁回；核准後改 tenant.planId 或把加購量加進
  limitOverrides.monthlyTokens，並失效 Redis 權限交集快取與 getTenantPlanId 60 秒進程內快取。
  當需求、bug 或新功能碰到「升級申請」「加購 token」「降級」「方案換不過去」「核准後權限沒生效」「申請卡在處理中」
  「審核按了沒反應」、plan-change 模組（plan-change.service / plan-change.routes）、PlanChangeRequest 資料表時使用。
  也在改方案 slug、方案 limits、試用轉正式、AI 月額度與額度告警前使用。
---

# 方案異動申請與審核

## 先讀
- 功能現況（以它為準）：`docs/ref/features/platform/PLAN-CHANGES.md`
  - 有效額度怎麼算、方案天花板：`docs/ref/features/platform/PLANS.md`；試用脫離：`docs/ref/features/platform/TRIALS.md`
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-PLAN-CHANGES.md`
- 規格：`openspec/specs/plan-change-request/spec.md`（主規格）、`openspec/specs/trial-lifecycle/spec.md`（「轉為付費方案時脫離試用」「試用方案不能當成升級或轉正式的目標」）、`openspec/specs/usage-quota-alerts/spec.md`（「核准加購後再次跨越門檻」）
- 已知問題：`docs/ref/system/AUDIT.md` 的 PLAN-02、PLAN-05、PLAN-10、PLAN-11、PLAN-13、USAGE-03
- 手冊：`apps/web/public/manual/ch14-plan.html`（租戶端；平台後台沒有手冊）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-plan-changes`

程式位置：
- 租戶端路由 `apps/api/src/modules/platform/plan-change.routes.ts`，掛在 `/api/v1/plan-change`（**放在 platform 目錄，但用租戶的 `authenticate`**）。
- 平台審核路由寫在 `apps/api/src/modules/platform/platform.routes.ts`（`/api/v1/platform/plan-change-requests`），守門是 `authenticatePlatformSuperuser` + `blockIfMustChangePassword`。
- 業務邏輯都在 `apps/api/src/modules/platform/plan-change.service.ts`。
- 前端：`apps/web/src/app/dashboard/plan/page.tsx`、`apps/web/src/app/admin/plan-changes/page.tsx`。

## 前端操作流程

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限（後端 / 前端隱藏） |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 租戶看申請記錄 | 側欄「分析與管理 → 方案／帳務」→ `/dashboard/plan` | `GET /plan-change` → `listTenantPlanChangeRequests`（自己租戶、新到舊、50 筆） | 無 | `settings.manage` / 側欄隱藏；**直接開網址仍看到完整表單**，讀取 403 時顯示「尚無申請記錄。」 |
| 2 | 申請升級方案 | 「升級方案」→ 目標方案下拉（寫死 `standard`／`professional`／`enterprise`，不看目前方案）→ 備註 → 「送出申請」 | `POST /plan-change {type:'upgrade', targetPlanSlug, note?}` → `createPlanChangeRequest`：已有 pending 回 409、slug 不存在 404、試用方案 400 | 建一筆 `pending`；不通知平台、不寫任何稽核 | `settings.manage` |
| 3 | 申請加購 token | 「加購 Token」→ `+20 萬`／`+50 萬`／`+100 萬` → 「送出申請」 | `POST /plan-change {type:'token_topup', topupTokens, note?}` | 同上 | `settings.manage` |
| 4 | 平台看待審 | 平台後台側欄「升級申請」→ `/admin/plan-changes` | `GET /platform/plan-change-requests` → `listPendingRequests`（只有 pending，舊到新） | 無 | 平台 superuser |
| 5 | 平台核准 | 列上「核准」→ `window.confirm` | `PATCH /platform/plan-change-requests/:id/approve`（body `{note?}`，**UI 不送 note**）→ `approveRequest` | upgrade：改 `planId`（試用租戶套 `TRIAL_EXIT_DATA`）、`invalidatePlanPermissions(新 planId)`、`invalidateTenantPlan`；token_topup：`limitOverrides.monthlyTokens = 現有有效額度 + 加購量`、`invalidateTenantPlan`、`clearTokenQuotaCache`、`clearQuotaAlertFlags`；寫平台稽核 `plan_change.approve` | 平台 superuser；**失敗沒有任何畫面提示**（`act()` 沒有 catch） |
| 6 | 平台駁回 | 列上「駁回」→ `window.confirm` | `PATCH /platform/plan-change-requests/:id/reject` → `rejectRequest` | 只改申請狀態；寫平台稽核 `plan_change.reject`（payload 空） | 同上 |
| 7 | 租戶看結果 | 回 `/dashboard/plan` 重新整理 | 同 1 | 只看得到「已核准／已駁回」，看不到 `reviewNote`、申請日期 | — |

**有後端、沒有前端入口**：審核備註 `note`（API 接受，UI 不送，租戶頁也不顯示 `reviewNote`）。
**前後端都沒有**：租戶撤回申請、申請逾期、平台查已處理的申請（PLAN-11）、核准／駁回通知租戶（沒有站內通知也沒有 email）、`downgrade` 型別（降級要嘛走 `upgrade` 選較小的方案，要嘛平台在租戶編輯頁直接改）。

## 前端實際送出的值
- `type`：`upgrade` | `token_topup`（後端 Zod `z.enum`，其他值 400 `VALIDATION_ERROR`）。
- `targetPlanSlug`：前端寫死 `standard`、`professional`、`enterprise`；後端接受任何存在的 slug（含停售、自訂、與目前相同的方案），只擋試用方案（`trial.planSlug`）。
- `topupTokens`：前端只有 `200000`、`500000`、`1000000`；後端 `z.number().int().positive()`，但資料庫是 `Int`，超過 2,147,483,647 回 500。
- `note`：`z.string().max(500)`，前端 textarea 沒有字數限制。
- 平台審核 body：`{ note?: string }`，沒有長度限制；目前 UI 不送 body。

## 不可破壞的規則
- 同一租戶同時只能一筆 `pending`（規格要求）。目前只靠 `findFirst` 再 `create`，沒有唯一索引，同時送出會建立多筆（健檢 HC-PLATFORM-PLAN-CHANGES-02）。改這段要用條件寫入或部分唯一索引，不要再加一層 `findFirst`。
- 核准／駁回只處理 `pending`。目前「讀狀態 → 改租戶 → 寫狀態」不在交易內、也不是條件更新（HC-PLATFORM-PLAN-CHANGES-01）；改這段時用 `updateMany({ where: { id, status: 'pending' } })` 搶狀態，搶到才改租戶。
- 換方案後兩層快取都要失效：Redis 權限交集快取（key 含 `roleId` 與 `planId`）與 `apps/api/src/services/tenant-plan.cache.ts` 的 60 秒進程內 Map。後者只清得到處理該請求的 API 進程；本機手動改 DB 後要等 60 秒或呼叫 `invalidateTenantPlan`（`FLUSHDB` 清不到）。其他換方案入口（`platform-tenant.service.ts` 的 `updateTenant()`、`trial-admin.service.ts` 的 `convertToPaid()`）要做同樣的事。
- 加購是「現有有效額度 + 加購量」寫進 `limitOverrides.monthlyTokens`，是**永久提高每月上限**（PLAN-02），而且覆寫值會蓋過之後升級的方案額度（PLAN-05）。有效額度無上限時必須回 400 `TOPUP_UNLIMITED`。有效額度的解析邏輯在 `apps/api/src/modules/platform/plan-limits.service.ts` 也有一份，改一邊要看另一邊。
- 核准加購要同時清計數器（`clearTokenQuotaCache`，校正 USAGE-03 的少算）與告警旗標（`clearQuotaAlertFlags`，PLAN-06 已修）；不要拿掉任何一行。
- 試用方案不能是目標（建立與核准兩處都要擋）；核准試用租戶的 `upgrade` 必須脫離試用（清 `trialEndsAt` 等，否則到期排程會停用已付費租戶，TRIAL-01 已修）。
- 前端的錯誤一律要讓使用者看得到；平台頁的 `act()` 目前會吞掉 400／404。
- UI 不放 emoji 與 ✓（使用者要求）。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-plan-changes` 看最新版本。重點：
- **依賴**：平台方案（目標方案、`features` 天花板、`limits.monthlyTokens`）、平台認證（superuser 守門）、成員與權限（`settings.manage`、兩層權限快取）、試用（`assertNotTrialPlan`、`TRIAL_EXIT_DATA`）、知識庫／AI 額度（`token-quota.service.ts` 的計數器與告警旗標）、平台租戶（`platform.routes.ts`、`writePlatformAudit`）。
- **被依賴**：試用（試用轉正式走 upgrade 申請）、平台用量（月額度上限）、通知（額度告警的按鈕連到 `/dashboard/plan`）。
- 改方案的 slug 或刪除方案：租戶頁與平台頁都寫死了 `standard`／`professional`／`enterprise`（平台頁另有 `light`）的對照，自訂方案在平台頁顯示 slug；已送出的申請在核准時會因目標方案不存在回 404。

## 回歸清單
改到本領域時，至少重走（本機，用自己建的 `hc-` 租戶，**不要改 Demo 租戶的方案**）：
1. 平台 API `POST /platform/tenants` 建一個 light 租戶 → 租戶 admin 開 `/dashboard/plan` 送「升級 → 專業版」→ 平台 `/admin/plan-changes` 核准 → 租戶 `GET /marketing/campaigns` 立刻從 403 變 200（不用等 60 秒）。
2. 再送一筆「加購 +20 萬」→ 核准 → `tenants.limitOverrides.monthlyTokens` 等於「原有效額度 + 200000」。
3. 已有 pending 時再送 → 409；畫面上的錯誤訊息要看得到。
4. 駁回一筆 → 租戶頁顯示「已駁回」，方案與覆寫值不變。
5. 企業版（無上限）租戶送加購 → 平台核准 → 400 `TOPUP_UNLIMITED`，畫面必須顯示原因。
6. 已處理的申請再核准／駁回 → 400；不存在的 id → 404。
7. 用沒有 `settings.manage` 的帳號（seed agent）：側欄沒有「方案／帳務」，API 回 403 `details.requiredPermission = settings.manage`。
8. 試用租戶送 upgrade → 核准 → `trialEndsAt` 清空（feature 測試涵蓋）。
- 自動測試：`pnpm --filter @open333crm/api test -- plan-change`（unit 20 個）；feature 測試搶鎖後 `pnpm --filter @open333crm/api test:feature modules/platform/plan-change`（10 個）。相關：`-- platform-audit-routes`、`-- platform-auth-guard`。
- E2E：`apps/web/tests/e2e-uat/cross-plan-request.spec.ts`（申請 → 平台駁回 → 方案不變）。注意它等待的文字還帶 ✓，UI 已拿掉，要先修 spec；UAT Demo 有一筆 2026-09-16 起的待審加購，spec 遇到 pending 會中止。

## 常見 bug 從哪裡查
- 「核准了但權限沒變」：先看 `tenants.planId` 是否真的改了；再看是不是多個 API 實例（只有處理核准的那個進程清了 `getTenantPlanId` 快取，其他實例最長 60 秒）；Redis key 看 `permission.service.ts` 的 `tenantCacheKey`。
- 「平台按核准沒反應、申請還在列表」：`/admin/plan-changes` 的 `act()` 沒有錯誤處理。打 API 看回應：常見是 `TOPUP_UNLIMITED`（企業版加購）、404 目標方案已刪、400 已處理。
- 「租戶一直顯示有處理中的申請、不能再送」：租戶不能撤回，只能請平台核准或駁回。查 `plan_change_requests where status='pending'`。
- 「同一租戶有兩筆 pending」：同時送出的競態（沒有唯一索引）。
- 「升級後 AI 額度沒變大」：租戶有 `limitOverrides.monthlyTokens`（加購過），覆寫優先（PLAN-05）。
- 「升級後額度快用完卻沒收到告警」：換方案不清告警旗標（PLAN-13）。
- 「租戶申請被駁回但不知道原因」：UI 不送審核備註，租戶頁也不顯示 `reviewNote`；平台也沒有通知租戶。
- 「查某租戶什麼時候升級的」：平台後台查不到（PLAN-11）；查 `plan_change_requests` 或 `platform_audit_logs`（`targetId` 是申請 id，payload 沒有租戶 id）。
