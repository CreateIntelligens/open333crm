---
name: feature-platform-trials
description: >
  open333CRM「試用申請與到期處理」功能顧問：公開試用申請與驗證、/admin/trial、試用政策、到期提醒、停用與清除排程。改到 trial 模組、trial-admin.service、trial_signups，或改 provisionTenant、租戶停用、寄信服務之前使用。
---

# 試用申請與到期處理

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。試用的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

公開試用申請頁 `/trial`（email、站台名稱，不收密碼；防枚舉 202、email 別名正規化、速率限制）、
驗證頁 `/trial/verify`（確認連結 → 設定密碼 → `provisionTenant`、`trialEndsAt`、冪等）、
平台後台 `/admin/trial`（試用租戶清單與狀態、延長試用、轉正式方案、復原已清除、申請記錄的重寄與作廢、試用政策設定 `trial.*`）、
每小時試用排程（到期前提醒信、到期自動停用、保留期滿軟刪 `purgedAt`）、試用相關 email。
相關的程式與資料：trial 模組、`trial-admin.service`、`trial_signups`、`TrialSignup`、`trialEndsAt`、`purgedAt`、`trialRemindersSent`。
常見的說法與錯誤碼：「試用到期」「試用被停用」「延長試用」「轉正式」「開放試用」「收不到驗證信」「試用站台開通失敗」、`TRIAL_CLOSED`、`EMAIL_IN_USE`、`TRIAL_TOKEN_EXPIRED`。
改 `provisionTenant`、方案升級審核、租戶停用、平台設定 KV、寄信服務之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/platform/TRIALS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `TRIALS.md` 的章節 |
| --- | --- |
| 找路由對應的函式、稽核、速率限制 | 程式的入口 |
| 公開申請、重寄、驗證與開通、email 正規化 | 申請與驗證 |
| 每小時排程、提醒檔位、收件人 | 排程 |
| `trial.*` 政策參數 | 政策參數；寫入方式見 `docs/ref/features/platform/SETTINGS.md` |
| 試用租戶清單的狀態 | 清單上的狀態怎麼判定 |
| 延長、轉正式、復原、重寄、作廢 | 每項操作實際改了什麼 |
| `trialEndsAt`、`TRIAL_EXIT_DATA`、升級審核 | 哪些操作會讓租戶脫離試用 |
| 合約日期與合約到期提醒 | 誰能做什麼；`docs/ref/features/platform/TENANTS.md` 的「合約日期」 |
| 前端頁面 | 畫面怎麼呼叫 API |

平台共通機制見 `docs/ref/features/platform/README.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/trial/`、`apps/api/tests/feature/modules/trial/`、`apps/web/tests/unit/app/trial/`、`apps/web/tests/unit/app/admin/`，寫法可以照著參考。`trial-application` 的 scenario 由 `apps/api/tests/feature/modules/trial/trial-signup-verify.test.ts` 涵蓋；提醒的三個 scenario 沒有同名測試。

`TRIALS.md` 裡標 `HC-PLATFORM-TRIALS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-TRIALS.md`。租戶停用、合約、復原的 API 錯誤案例在 `docs/ref/features/health/PLATFORM-TENANTS.md`。
- 規格：`openspec/specs/trial-application/spec.md`、`openspec/specs/trial-lifecycle/spec.md`、`openspec/specs/trial-data-purge/spec.md`、`openspec/specs/tenant-contract-dates/spec.md`
  - 注意：程式消耗 token 時保留雜湊、以 `status` 當閘（為了重按冪等）；`trial-application` 寫 gmail 才去 `+tag`，程式對所有網域都去（HC-PLATFORM-TRIALS-14）。
- AUDIT：TRIAL-02（政策 KV 無型別）、TRIAL-03（保留期滿只標記不刪）、TRIAL-04（租戶頁啟用不處理試用狀態）、SEC-02（平台重寄驗證信無稽核）、SEC-03（rate-limit 註冊在路由模組內）、RBAC-03（到期信只寄 `role=ADMIN`）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-trials`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `TRIALS.md` 括號內的章節。

- 申請時不可收或存密碼。管理員密碼只能由打開驗證連結的人在 `POST /trial/verify` 設定。`GET /trial/verify` 必須保持只讀。（申請與驗證）
- 開通必須在同一個交易：`trialSignup.updateMany`（pending→provisioning，條件含 token 雜湊）→ `provisionTenant(tx, …)` → provisioned。任何一步失敗整體回滾，token 不算用掉。不要把寄信放進交易。（申請與驗證）
- 防枚舉：`/signups`、`/resend` 對已開通、已是 Agent、不存在的 email 都回相同的 202，只有 `TRIAL_CLOSED` 可以不同。新增分支時，不要讓回應、狀態碼或明顯的時間差洩漏 email 狀態。（申請與驗證）
- pending 的申請再送一次，不可改任何欄位。重寄要走與 `/resend` 相同的節流。（申請與驗證）
- `trialEndsAt` 不是 null 就是試用租戶，排程只掃它。脫離試用只有兩條路：`convertToPaid` 與核准 `upgrade` 申請（`plan-change.service.ts`），兩者都寫 `TRIAL_EXIT_DATA`。改方案（`updateTenant`）、核准加購都**不**脫離試用。（哪些操作會讓租戶脫離試用）
- 試用方案以 `trial.planSlug` 判斷，不寫死。試用方案不能當轉正式或升級的目標（`assertNotTrialPlan`）。（哪些操作會讓租戶脫離試用）
- 手動開通不設 `trialEndsAt`，只有試用驗證開通才設。（`TENANTS.md` 的「開通一個租戶建立了什麼」）
- 復原只清除 `purgedAt`，不改 `isActive`。延長與轉正式才同時清除 `purgedAt` 並啟用。（每項操作實際改了什麼）
- 排程的每個寫入都要走 `claimEach` 的條件更新。提醒的條件要包含讀到的 `trialRemindersSent`，兩期重疊時只寄一次。（排程）
- 平台稽核由路由寫（`writePlatformAudit`），服務不寫；排程用 `writeSystemAudit`。新增平台異動路由要加進 `apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 的清單。（程式的入口）
- 試用信的變數一律經過 `escapeHtml`。既有試用信的 emoji 保留，新信不要加 emoji。（排程）
- 速率限制靠 `trial.routes.ts` 內註冊的 `@fastify/rate-limit`（`global: false`）。把路由搬到別的檔案，`config.rateLimit` 會被靜默忽略（SEC-03）。（程式的入口）

## 回歸清單

改到本領域時，至少重走下列項目。用 `hc-` 前綴的 email 與租戶，**不要對 Demo 或其他租戶做到期與清除**。`trial.enabled` 測完要恢復。

1. 申請到開通：
   - `trial.enabled=false` 時申請回 403，不建記錄。
   - 開啟之後，在 `/trial` 申請。API log 有驗證信（`EMAIL_DELIVERY_MODE=log` 會印 `verifyUrl`）。
   - 開 `/trial/verify?token=`，出現設定密碼表單。重新整理不會開通。
   - 送出之後站台開通。以驗證頁設定的密碼登入，`/marketing/campaigns` 回 403（trial 天花板）。
2. 錯誤情況：
   - 過期 token（SQL 把 `verifyTokenExpiresAt` 改到過去）410、無效 token 410。
   - 密碼 7 碼 400。重按冪等，密碼不變。
   - email 已被手動開通建走 409。
   - gmail 別名是同一筆申請。已是 Agent 的 email 靜默 202。
3. 同一 email 用不同 IP 再送申請：站台名稱不變、60 秒內不寄新信、寄滿 5 封後不再寄。測試時用 `X-Forwarded-For` 帶不同 IP。
4. 排程：
   - 先確認資料庫裡沒有別人的試用租戶會被波及。
   - 把自建試用租戶的 `trialEndsAt` 分別改成過去、6.5 天後、31 天前。
   - 手動執行 `runTrialLifecycle`。腳本要先呼叫 `apps/api/src/config/env.ts` 的 `loadEnvConfig()`，否則寄信全部失敗。
   - 結果依序是：停用並寄到期信、寄 7 天提醒、停用並軟刪。
5. `/admin/trial`：
   - 延長已到期停用的租戶 → 試用中。
   - 復原已清除 → 已停用。
   - 轉正式 → 從清單消失。轉成試用方案回 400。
   - 申請記錄的重寄、作廢。
6. TRIAL-04：在租戶頁啟用已到期的試用租戶，下一輪排程又停用。

自動測試：

- `pnpm --filter @open333crm/api test -- platform-audit-routes plan-change tenant-plan schedule-registrations trial-routes`
- `pnpm --filter @open333crm/web test -- trial-page verify-page`
- feature 測試先搶鎖，**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/trial modules/platform/plan-change-trial-exit modules/platform/tenant-contract-dates`
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`（只開 `/admin/trial` 頁）。UAT 是正式環境，不要在 UAT 送試用申請。

## 常見 bug 從哪裡查

- 「收不到驗證信」，依序查：
  1. `trial.enabled`。預設關閉，畫面會顯示「目前暫不開放」。
  2. email 是否已是 Agent 或已開通。這兩種情況靜默不寄。
  3. 節流：`verifySentCount` ≥ 5，或 60 秒內寄過。
  4. API log 的 `[TrialEmail] send failed`。
  平台可在申請記錄按「重寄」，這會繞過節流。
- 「驗證連結失效」：同一 email 後來又申請（冷卻過後會重寄）或重寄過，舊連結就失效，要用最新那封。平台作廢過也會失效。
- 「登入密碼不對」：密碼是在驗證頁設定的，不是申請時。同一連結送第二次不會改密碼，要用第一次送出的。
- 「試用租戶被停用了」：`trialEndsAt` 已過，排程停用。要繼續用，請「延長」或「轉正式」。不要在租戶頁按「啟用」（TRIAL-04，最多撐一小時）。
- 「試用租戶沒有到期／不在 /admin/trial」：手動開通的租戶沒有 `trialEndsAt`（HC-PLATFORM-TENANTS-05），或曾被轉正式、核准升級。
- 「改了方案還是被停用」：在租戶詳細頁改方案不脫離試用，要用「轉正式」。
- 「提醒信沒寄」：檔位已寫進 `trialRemindersSent` 就不會再寄，寄失敗也一樣（HC-PLATFORM-TRIALS-05）。「即將到期」的 3 天與提醒檔位無關。
- 「按了延長沒反應」：`/admin/trial` 的操作失敗時沒有訊息（HC-PLATFORM-TRIALS-03）。看瀏覽器 console 與 API 回應。
- 「已清除的資料不見了」：沒有任何資料被刪（TRIAL-03），`purgedAt` 只影響後台顯示。按「復原」即可。
- 「開通回 500 `TRIAL_MISCONFIGURED`」：`trial.planSlug` 指向不存在的方案（TRIAL-02）。
