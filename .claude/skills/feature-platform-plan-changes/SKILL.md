---
name: feature-platform-plan-changes
description: >
  open333CRM「方案異動申請與審核」功能顧問：租戶申請升級方案或加購 AI token，平台在 /admin/plan-changes 核准或駁回。改到 plan-change 模組、PlanChangeRequest，或改方案 slug、方案 limits、AI 月額度之前使用。
---

# 方案異動申請與審核

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。方案異動的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

租戶在 `/dashboard/plan`（方案／帳務）送出升級方案或加購 AI token 的申請，平台在 `/admin/plan-changes`（升級申請）核准或駁回。
核准後改 `tenant.planId`，或把加購量計入核准當月（台灣時間）的 AI 月額度，並失效 Redis 權限交集快取與 `getTenantPlanId` 60 秒行程內快取。
相關的程式與資料：plan-change 模組（`plan-change.service`、`plan-change.routes`、`plan-change.flow`）、`PlanChangeRequest` 資料表。
常見問題：「升級申請」「加購 token」「降級」「方案換不過去」「核准後權限沒生效」「申請卡在處理中」「審核按了沒反應」。
改方案 slug、方案 limits、試用轉正式、AI 月額度與額度告警之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/platform/PLAN-CHANGES.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `PLAN-CHANGES.md` 的章節 |
| --- | --- |
| 找路由對應的函式 | 程式的入口 |
| 送出申請、一筆 `pending`、試用方案的檢查 | 一筆申請的流程、送出時檢查什麼 |
| 平台收到申請的通知 | 平台方怎麼知道有新申請 |
| 核准升級、快取失效、稽核、改方案 slug | 各型別核准後做什麼 |
| 加購的月額度 | 加購只計入核准當月 |
| 額度告警旗標 | 額度告警旗標 |
| 已處理的申請 | 平台看不到歷史 |
| 前端頁面 | 畫面怎麼呼叫 API |

有效額度怎麼算、方案天花板見 `docs/ref/features/platform/PLANS.md`；試用脫離見 `docs/ref/features/platform/TRIALS.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/platform/`（`plan-change*.test.ts`）、`apps/api/tests/feature/modules/platform/`（`plan-change-trial-exit.test.ts`），寫法可以照著參考。

`PLAN-CHANGES.md` 裡標 `HC-PLATFORM-PLAN-CHANGES-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-PLAN-CHANGES.md`
- 規格：
  - `openspec/specs/plan-change-request/spec.md`（主規格）
  - `openspec/specs/trial-lifecycle/spec.md`（「轉為付費方案時脫離試用」「試用方案不能當成升級或轉正式的目標」）
  - `openspec/specs/usage-quota-alerts/spec.md`（「核准加購後再次跨越門檻」）
- 已知問題：`docs/ref/system/AUDIT.md` 的 PLAN-10、PLAN-11、PLAN-16、USAGE-03
- 手冊：`apps/web/public/manual/ch14-plan.html`（租戶端；平台後台沒有手冊）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-plan-changes`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `PLAN-CHANGES.md` 括號內的章節。

- 同一個租戶同時只能有一筆 `pending`（規格要求）。現在只靠 `findFirst` 再 `create`。改這段要用條件寫入或部分唯一索引，不要再加一層 `findFirst`。（一筆申請的流程）
- 核准與駁回只處理 `pending`。改升級的核准或駁回時，用 `updateMany({ where: { id, status: 'pending' } })` 搶狀態，搶到才改租戶。（一筆申請的流程）
- 換方案後兩層快取都要失效：Redis 權限交集快取與 `tenant-plan.cache.ts` 的 60 秒行程內 Map。其他換方案入口（`updateTenant()`、`convertToPaid()`）要做同樣的事。（各型別核准後做什麼）
- 加購只計入**核准當月**（台灣時間，依 `reviewedAt`）。當月上限只在 `plan-limits.service.ts` 的 `getEffectiveLimit()` 計算，不要在別處重寫。核准加購**不寫** `limitOverrides`。基礎上限無上限時必須回 400 `TOPUP_UNLIMITED`。（加購只計入核准當月）
- 會提高 AI 月額度的換方案入口（核准升級、`updateTenant()`、`convertToPaid()`、`updatePlan()`）在上限提高時要清告警旗標（`monthlyTokensRaisedByPlanChange()`）。（額度告警旗標）
- 核准加購要同時清計數器（`clearTokenQuotaCache`，校正 USAGE-03 的少算）與告警旗標（`clearQuotaAlertFlags`）。不要拿掉任何一行。（加購只計入核准當月、額度告警旗標）
- 試用方案不能是目標，建立與核准兩處都要擋。核准試用租戶的 `upgrade` 必須脫離試用。（送出時檢查什麼）
- 前端的錯誤一律讓使用者看得到。租戶頁用 `getApiErrorMessage`，平台頁顯示後端的錯誤訊息。（畫面怎麼呼叫 API）
- UI 不放 emoji 與 ✓（使用者要求）。

## 回歸清單

改到本領域時，至少重走。在本機用自己建的 `hc-` 租戶，**不要改 Demo 租戶的方案**：

1. 升級：
   - 平台 API `POST /platform/tenants` 建一個 light 租戶。
   - 租戶 admin 開 `/dashboard/plan`，送「升級 → 專業版」。
   - 平台在 `/admin/plan-changes` 核准。
   - 租戶 `GET /marketing/campaigns` 立刻從 403 變 200，不用等 60 秒。
2. 加購：
   - 送一筆「加購 +20 萬」→ 平台頁該列顯示「本月已加購」「本月上限」→ 核准 → `tenants.limitOverrides` 不變。
   - 再送一筆，在平台頁看到本月上限已含前一筆。
   - 租戶頁的申請記錄顯示「限 YYYY-MM 使用」。
3. 已有 `pending` 時再送 → 409，畫面上看得到錯誤訊息。
4. 駁回一筆 → 租戶頁顯示「已駁回」，方案與覆寫值不變。
5. 企業版（無上限）租戶：加購的按鈕停用；用 API 送出回 400 `TOPUP_UNLIMITED`。
6. 已處理的申請再核准或駁回 → 400；不存在的 id → 404。
7. 用沒有 `settings.manage` 的帳號（seed agent）：側欄沒有「方案／帳務」，API 回 403，`details.requiredPermission = settings.manage`。
8. 試用租戶送 upgrade（目標是付費方案）→ 核准 → `trialEndsAt` 清空（feature 測試涵蓋）。目標選試用方案 → 建立時回 400。

自動測試：

- `pnpm --filter @open333crm/api test -- plan-change`
- feature 測試先搶鎖，再執行 `pnpm --filter @open333crm/api test:feature modules/platform/plan-change`
- 相關：`pnpm --filter @open333crm/api test -- platform-audit-routes`、`pnpm --filter @open333crm/api test -- platform-auth-guard`
- E2E：`apps/web/tests/e2e-uat/cross-plan-request.spec.ts`（申請 → 平台駁回 → 方案不變）。
  - 這個 spec 等待的文字還帶 ✓，與畫面的文字不同，要先修 spec（HC-PLATFORM-PLAN-CHANGES-14）。
  - UAT Demo 有一筆待審的加購，spec 遇到 `pending` 會中止。這筆申請由 BD 使用，不要處理。

## 常見 bug 從哪裡查

- 「核准了但權限沒變」：
  - 先看 `tenants.planId` 是否真的改了。
  - 再看是不是有多個 API 行程：只有處理核准的行程清了 `getTenantPlanId` 快取，其他行程最長 60 秒（HC-PLATFORM-PLAN-CHANGES-13）。
  - Redis key 看 `permission.service.ts` 的 `tenantCacheKey`。
- 「平台按核准後申請還在列表」：看頁面上方的錯誤訊息，或打 API 看回應。常見的是 `TOPUP_UNLIMITED`（無上限租戶的加購）、404（目標方案已刪）、400（已處理）。
- 「租戶一直顯示有處理中的申請、不能再送」：租戶不能撤回，只能請平台核准或駁回。查 `plan_change_requests where status='pending'`。
- 「同一租戶有兩筆 pending」：同時送出的競態，沒有唯一索引（HC-PLATFORM-PLAN-CHANGES-02）。
- 「升級後 AI 額度沒變大」：租戶有 `limitOverrides.monthlyTokens`（覆寫優先）。正常流程不寫這個欄位，有的話是有人直接改資料庫。
- 「上個月加購的額度不見了」：正常，加購只計入核准當月。
- 「升級後額度快用完卻沒收到告警」：查新方案的基礎上限是否真的比較高。上限沒提高時不清旗標。
- 「租戶申請被駁回但不知道原因」：UI 不送審核備註，租戶頁也不顯示 `reviewNote`；平台也不通知租戶（HC-PLATFORM-PLAN-CHANGES-04）。
- 「查某租戶什麼時候升級的」：平台後台查不到（PLAN-11）。查 `plan_change_requests` 或 `platform_audit_logs`（`targetId` 是申請 id，payload 沒有租戶 id）。
