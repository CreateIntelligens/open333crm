# 方案異動審核

租戶提出升級或加購申請，平台在此審核。

- **資料來源**：`apps/api/src/modules/platform/plan-change.service.ts`、`apps/api/src/modules/platform/plan-limits.service.ts`、`apps/web/src/app/admin/plan-changes/page.tsx`、`apps/api/src/modules/platform/plan-change.flow.ts`、`apps/web/src/app/dashboard/plan/page.tsx`、`apps/web/src/app/admin/layout.tsx`
- **核對日期**：2026-11-19

## 程式的入口

| 路由 | 檔案與守門 | 函式 |
| --- | --- | --- |
| `GET /api/v1/plan-change` | `apps/api/src/modules/platform/plan-change.routes.ts`。檔案放在 platform 目錄，但用租戶的 `authenticate`，再要求 `settings.manage` | `listTenantPlanChangeRequests()` |
| `GET /api/v1/plan-change/topup-eligibility` | 同上 | `getTopupEligibility()` |
| `POST /api/v1/plan-change` | 同上 | `plan-change.flow.ts` 的 `submitPlanChangeRequest()` → `createPlanChangeRequest()`，之後在背景呼叫 `notifyPlatformOfPlanChange()` |
| `GET /api/v1/platform/plan-change-requests` | `apps/api/src/modules/platform/platform.routes.ts`，守門是 `authenticatePlatformSuperuser` + `blockIfMustChangePassword` | `listPendingRequests()` |
| `PATCH /api/v1/platform/plan-change-requests/:id/approve` | 同上 | `approveRequest()`，路由再以 `writePlatformAudit` 寫 `plan_change.approve` |
| `PATCH /api/v1/platform/plan-change-requests/:id/reject` | 同上 | `rejectRequest()`，路由再寫 `plan_change.reject` |

業務邏輯都在 `apps/api/src/modules/platform/plan-change.service.ts`。前端是 `apps/web/src/app/dashboard/plan/page.tsx` 與 `apps/web/src/app/admin/plan-changes/page.tsx`。

## 一筆申請的流程

租戶在租戶後台的 `/dashboard/plan` 送出，端點是 `POST /api/v1/plan-change`，需要 `settings.manage` 權限。平台在 `/admin/plan-changes` 核准或駁回。

| 階段 | 端點 | 規則 |
| --- | --- | --- |
| 送出 | `POST /api/v1/plan-change` | 同一個租戶同時只能有一筆 `pending`，否則回 409。`upgrade` 當場檢查目標方案存在，`token_topup` 檢查加購量是正整數，而且 AI 月額度基礎上限不是無上限（否則回 400 `TOPUP_UNLIMITED`） |
| 能否加購 | `GET /api/v1/plan-change/topup-eligibility` | 回傳 `allowed`（基礎上限是無上限時為 false）與 `monthlyTokenLimit`。`/dashboard/plan` 在 `allowed` 是 false 時停用「加購 Token」 |
| 待審 | `GET /platform/plan-change-requests` | 只回傳 `pending`，依申請時間舊到新。附租戶名稱、目前方案、本月已核准的加購量（`monthlyTopupTokens`）與目前本月的 AI 月額度上限（`monthlyTokenLimit`，null 是無上限） |
| 核准 | `PATCH /platform/plan-change-requests/:id/approve` | 依型別執行動作，見下文 |
| 駁回 | `PATCH /platform/plan-change-requests/:id/reject` | 只改狀態，不動租戶 |

核准與駁回都只接受 `pending` 的申請，已處理過的回 400，不存在的 id 回 404。兩者都會記下 `reviewedBy`、`reviewedAt` 與審核備註。API 接受選填的 `note` 當審核備註，但 `/admin/plan-changes` 頁沒有備註欄位，從畫面審核的申請都沒有備註（HC-PLATFORM-PLAN-CHANGES-04）。

- **一個租戶同時只能有一筆 `pending`，但只在應用程式檢查（HC-PLATFORM-PLAN-CHANGES-02）。** 送出時先以 `findFirst` 查有沒有 `pending` 的申請，再 `create`，資料庫沒有對應的唯一限制。兩個請求同時送出時，兩個請求可能都通過檢查，系統因此建立兩筆 `pending`。
- **升級的核准與駁回不是原子操作（HC-PLATFORM-PLAN-CHANGES-01）。** `upgrade` 的核准與 `rejectRequest()` 都是「讀狀態 → 改租戶 → 無條件寫狀態」，不在交易內，也不是條件更新。同一筆申請同時核准與駁回時，兩個都回 200，平台稽核同時記下 `plan_change.approve` 與 `plan_change.reject`。加購的核准是條件更新，見[加購只計入核准當月](#加購只計入核准當月)。
- **租戶不能撤回申請，申請也不會逾期（HC-PLATFORM-PLAN-CHANGES-06）。** 系統沒有撤回或取消的端點。租戶送出申請後，只能等平台核准或駁回；平台不處理時，這筆申請一直擋住新申請。

### 送出時檢查什麼

| 欄位 | 後端的規則 |
| --- | --- |
| `type` | `upgrade` 或 `token_topup`（Zod `z.enum`），其他值回 400 `VALIDATION_ERROR` |
| `targetPlanSlug` | 方案不存在回 404。目標是試用方案時回 400，見下表。其他方案都接受，包括停售的方案、平台內部的自訂方案與目前的方案（HC-PLATFORM-PLAN-CHANGES-08） |
| `topupTokens` | `z.number().int().positive()`。填 0 或負數時，錯誤訊息是「不可小於 0」，與實際規則「必須大於 0」不一致（HC-PLATFORM-PLAN-CHANGES-09）。資料庫欄位是 `Int`，超過 2,147,483,647 回 500（HC-PLATFORM-PLAN-CHANGES-07） |
| `note` | `z.string().max(500)` |

試用方案的檢查（`assertNotTrialPlan()`，`apps/api/src/modules/platform/trial-admin.service.ts`）只看**目標**方案，不看租戶目前是不是試用：

| 情況 | 建立申請（`POST /plan-change`） | 平台核准（`/approve`） |
| --- | --- | --- |
| 目標是試用方案（slug 等於試用政策的 `trial.planSlug`），不論目前方案 | 400 `BAD_REQUEST`「不能轉成試用方案」 | 再檢查一次，同樣回 400。申請建立之後，平台可能改了試用政策的 slug |
| 目前是試用租戶，目標是付費方案 | 允許，建一筆 `pending` | 改 `planId`，並套用 `TRIAL_EXIT_DATA`（`trialEndsAt: null`、`purgedAt: null`、`isActive: true`）脫離試用 |
| 目前不是試用，目標是付費方案 | 允許 | 只改 `planId` |

「目前是試用」以 `tenant.trialEndsAt != null` 判斷，不看目前方案的 slug。核准試用租戶的 `upgrade` 必須脫離試用，否則到期排程會停用已付費的租戶。

## 平台方怎麼知道有新申請

- **寄信**：申請建立後，`plan-change.flow.ts` 寄信給所有啟用中的平台帳號，信中有租戶名稱、類型、內容、備註與 `/admin/plan-changes` 的連結。寄信在回應之後進行，失敗不影響申請，也不重試。
- **寄送紀錄**：每次寄送後寫一筆平台稽核 `plan_change.notify_platform`（`platformUserId` 是 null），`payload` 有 `recipients`、`sent`、`failed`（收件人與原因），寄信之前就失敗時有 `error`。平台後台沒有依 `action` 查稽核的介面（PLAN-11），要查 `platform_audit_logs`。
- **側欄數量**：平台後台側欄的「升級申請」顯示待審數量（`GET /platform/plan-change-requests` 的筆數），沒有待審時不顯示。換頁、每 60 秒，以及在升級申請頁核准或駁回後重新載入。

## 各型別核准後做什麼

| 型別 | 核准後的動作 | 失效的快取 |
| --- | --- | --- |
| `upgrade` | 改 `tenant.planId`。試用租戶同時脫離試用，見[試用](./TRIALS.md#哪些操作會讓租戶脫離試用)。新方案的 AI 月額度較高時，清除本月的額度告警旗標 | 權限天花板快取、租戶方案快取 |
| `token_topup` | 只把申請改成 `approved`（條件更新，只更新仍是 `pending` 的申請），不改租戶。加購量計入核准當月的 AI 月額度，並清除本月的額度告警旗標 | AI 額度計數器 |

核准升級後，兩層快取都要失效：

- Redis 的權限交集快取。key 含 `roleId` 與 `planId`（`permission.service.ts` 的 `tenantCacheKey()`），核准時以 `invalidatePlanPermissions(新 planId)` 清除。
- `apps/api/src/services/tenant-plan.cache.ts` 的 `getTenantPlanId()` 60 秒行程內快取（`Map`），核准時以 `invalidateTenantPlan()` 清除。這個函式只清得到處理核准請求的 API 行程。API 有多個行程時，其他行程最長 60 秒仍用舊方案判斷權限天花板（HC-PLATFORM-PLAN-CHANGES-13）。在本機直接改資料庫的 `planId` 之後，要等 60 秒或呼叫 `invalidateTenantPlan()`；Redis 的 `FLUSHDB` 清不到這層。

其他換方案的入口（`platform-tenant.service.ts` 的 `updateTenant()`、`trial-admin.service.ts` 的 `convertToPaid()`）也清這兩層快取。

`upgrade` 只是換方案，**沒有任何「比較貴」的檢查**（HC-PLATFORM-PLAN-CHANGES-05）。目標方案是更便宜或功能更少的方案時，核准一樣會照做，平台頁也不提示這是降級。唯一的例外是試用方案（試用政策 `trial.planSlug` 指定的方案）：建立與核准申請都回 400，見[試用](./TRIALS.md#哪些操作會讓租戶脫離試用)。系統也沒有 `downgrade` 型別，租戶要降級只能請平台直接改，見[租戶管理](./TENANTS.md#改方案的連帶效果)。

核准或駁回之後，租戶不會收到通知（HC-PLATFORM-PLAN-CHANGES-04）。沒有寄信，也沒有站內通知，租戶要自己回 `/dashboard/plan` 才看得到狀態。租戶頁送出後的提示卻寫「審核結果會以站內通知與 Email 通知管理員」，與實際行為不符。租戶頁也不顯示 `reviewNote`。

平台稽核的內容（HC-PLATFORM-PLAN-CHANGES-11）：

- `plan_change.approve` 的 `targetId` 是申請 id，payload 只有 `type` 與 `trialExited`，沒有租戶 id、前後方案與加購量。
- `plan_change.reject` 沒有 payload。
- 送出申請與審核結果都不寫租戶稽核。

改方案的 slug 或刪除方案時：

- 租戶頁的目標方案寫死 `standard`、`professional`、`enterprise`。平台頁的 `PLAN_LABEL` 另外多一個 `light`，其他方案顯示 slug。
- 已送出的申請在核准時，因為目標方案不存在而回 404。

## 加購只計入核准當月

加購只加當月，下個月自動回到方案額度。月份一律用台灣時間：

```text
本月 AI 月額度 = 基礎上限 + 本月（台灣時間）已核准的 token_topup 加總
基礎上限       = limitOverrides.monthlyTokens（有這個 key 時）?? Plan.limits.monthlyTokens；null 是無上限
```

- 一筆加購屬於**核准時間**（`reviewedAt`）所在的台灣月份，不是申請時間。月底送出、隔月 1 日才核准的加購算在隔月。
- 當月加購量直接從已核准的申請加總（`plan-limits.service.ts` 的 `sumMonthlyTopupTokens()`），不另外存，也不寫 `limitOverrides`。每一筆加購都是一筆申請，有審核者、時間與備註，可以對帳。
- 解析只有一份：`plan-limits.service.ts` 的 `getEffectiveLimit()`。LLM 呼叫前的月額度檢查、告警門檻與平台審核頁都呼叫它，`approveRequest()` 也用 `resolveEffectiveLimit()` 判斷基礎上限，不再自己算。
- 換方案之後，加購加在新方案的額度上。
- 基礎上限是無上限時，送出與核准都會被擋下並回 400 `TOPUP_UNLIMITED`。送出端在 2026-11-11 才加上檢查，之前送出的這類申請只能駁回；`/admin/plan-changes` 會停用它們的「核准」按鈕。核准之後才換到無上限方案時，本月仍是無上限。
- 核准是條件更新：同一筆申請同時核准兩次，只有一次成功，另一次回 400。

兩邊畫面都寫明「加購僅限核准當月（台灣時間），下個月回到方案額度」。租戶頁的申請記錄在已核准的加購旁顯示「限 YYYY-MM 使用」；平台審核頁在每筆加購申請下方顯示該租戶「本月已加購」與「本月上限」。

2026-11 月在 11-10 之前核准的加購，仍計入 2026-11 月的額度。

## 額度告警旗標

核准加購時一律清除本月的額度告警旗標與用量計數器。旗標到月底才過期，不清除的話，用量跨越新上限的 80%、100% 時，系統不會再通知。

換方案也會清除，但只在 AI 月額度提高時（比較換方案前後的基礎上限，`plan-limits.service.ts` 的 `monthlyTokensRaisedByPlanChange()`）：核准升級、平台改租戶方案（`updateTenant()`）、試用轉付費（`convertToPaid()`），以及平台調高方案的 `limits.monthlyTokens`（`updatePlan()`，只清沒有覆寫 `monthlyTokens` 的租戶）。上限不變或降低時保留旗標。

申請仍不記金額，系統沒有計費，見 `../../system/AUDIT.md` 的 PLAN-10。

## 平台看不到歷史

`listPendingRequests()` 的查詢條件寫死 `status: 'pending'`，平台後台沒有第二個端點可以查已核准或已駁回的申請。要回答「這個租戶上次升級是什麼時候」只能查資料庫，或從稽核紀錄的 `plan_change.approve` 反查。

租戶自己看得到全部，`listTenantPlanChangeRequests()` 回傳該租戶最近 50 筆。

`reviewedBy` 存的是 `platformUserId`，但不是外鍵，要顯示審核者的姓名必須自己查 `platform_users`。

稽核反查也不實用，平台稽核只能依平台帳號查，不能依租戶或 `action` 查，詳見 `../../system/AUDIT.md` 的 PLAN-11。

平台待審列表的畫面不顯示申請時間與租戶是否在試用中，審核者看不出申請放了多久、是不是試用轉正式（HC-PLATFORM-PLAN-CHANGES-12）。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 租戶側欄「分析與管理 → 方案／帳務」→ `/dashboard/plan` 的申請記錄 | `GET /plan-change`；`GET /plan-change/topup-eligibility` | 側欄依 `settings.manage` 隱藏。沒有權限的成員直接開網址時，讀取回 403，頁面顯示錯誤訊息，表單仍然顯示。記錄顯示申請時間、方案名稱與狀態「處理中／已核准／已駁回」，不顯示 `reviewNote` |
| 「升級方案」→ 目標方案下拉 → 備註 → 「送出申請」 | `POST /plan-change {type:'upgrade', targetPlanSlug, note?}` | 下拉寫死標準版、專業版、企業版，不看目前方案。有處理中的申請時，頁面隱藏表單並顯示提示。錯誤以 `getApiErrorMessage` 顯示 |
| 「加購 Token」→ `+20 萬`、`+50 萬`、`+100 萬` → 「送出申請」 | `POST /plan-change {type:'token_topup', topupTokens, note?}` | `topup-eligibility` 回 `allowed: false` 時，「加購 Token」停用 |
| 平台側欄「升級申請」→ `/admin/plan-changes` | `GET /platform/plan-change-requests` | 只列 `pending`。加購申請下方顯示「本月已加購」與「本月上限」 |
| 列上的「核准」、「駁回」→ `window.confirm` | `PATCH /platform/plan-change-requests/:id/approve`、`/reject` | 不送 body，所以沒有審核備註。失敗時顯示後端的錯誤訊息。AI 月額度無上限的租戶，加購申請的「核准」按鈕停用 |

前後端都沒有的功能：租戶撤回申請、申請逾期、平台查已處理的申請（PLAN-11）、審核結果通知租戶、`downgrade` 型別。

前端送出的值：

- `type`：`upgrade` 或 `token_topup`。
- `targetPlanSlug`：`standard`、`professional`、`enterprise`。後端另外接受任何存在而且不是試用的 slug。
- `topupTokens`：`200000`、`500000`、`1000000`。
- `note`：textarea 沒有字數限制，後端上限 500 字。
- 平台審核的 body：後端接受 `{ note?: string }`，沒有長度限制；畫面不送 body。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
