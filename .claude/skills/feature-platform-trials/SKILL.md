---
name: feature-platform-trials
description: >
  open333CRM「試用申請與到期處理」功能顧問：公開試用申請頁 /trial（email、站台名稱、密碼，防枚舉 202、
  gmail 別名正規化、速率限制）、驗證即開通 /trial/verify（provisionTenant、trialEndsAt、冪等）、
  平台後台 /admin/trial（試用租戶清單與狀態、延長試用、轉正式方案、復原已清除、申請記錄重寄與作廢、
  試用政策設定 trial.enabled/durationDays/reminderDaysBefore/verifyTokenTtlHours/dataRetentionDays/planSlug）、
  每小時試用排程（到期前提醒信、到期自動停用、保留期滿軟刪 purgedAt）、合約起訖日、試用相關 email。
  當需求、bug 或新功能碰到 trial 模組、trial-admin.service、trial_signups、TrialSignup、trialEndsAt、
  purgedAt、trialRemindersSent、試用到期、試用被停用、延長試用、轉正式、開放試用、收不到驗證信、
  試用站台開通失敗、TRIAL_CLOSED、EMAIL_IN_USE、TRIAL_TOKEN_EXPIRED 時使用。
  也在改 provisionTenant、方案升級審核、租戶停用、平台設定 KV、寄信服務前使用。
---

# 試用申請與到期處理

## 先讀
- 功能現況：`docs/ref/features/platform/TRIALS.md`（生命週期、排程三步、清單狀態判定、每項操作改了什麼）；平台共通機制 `docs/ref/features/platform/README.md`
  - 注意：TRIALS.md 沒寫「同一 email 再送申請會覆寫密碼與站台名稱、並繞過重寄節流」（健檢 HC-PLATFORM-TRIALS-01、02），也沒列公開頁面與速率限制。
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-TRIALS.md`；租戶停用、合約、復原的 API 細節在 `docs/ref/features/health/PLATFORM-TENANTS.md`
- 規格：`openspec/specs/trial-application/spec.md`、`openspec/specs/trial-lifecycle/spec.md`、`openspec/specs/trial-data-purge/spec.md`、`openspec/specs/tenant-contract-dates/spec.md`
  - 注意：`trial-application` 寫 token 消耗時「設為 null」，程式保留雜湊、以 `status` 當閘（為了重按冪等）；寫 gmail 才去 `+tag`，程式對所有網域都去。
- AUDIT：TRIAL-02（政策 KV 無型別）、TRIAL-03（保留期滿只標記不刪）、TRIAL-04（租戶頁啟用不處理試用狀態）、SEC-02（平台重寄驗證信無稽核）、SEC-03（rate-limit 註冊在路由模組內）、RBAC-03（到期信只寄 `role=ADMIN`）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-trials`

程式位置：公開端點 `apps/api/src/modules/trial/trial.routes.ts`（前綴 `/api/v1/trial`）→ `apps/api/src/modules/trial/trial.service.ts`；平台端點在 `apps/api/src/modules/platform/platform.routes.ts`（前綴 `/api/v1/platform`）→ `apps/api/src/modules/platform/trial-admin.service.ts`；排程 `apps/api/src/modules/trial/trial.scheduler.ts`；政策 `apps/api/src/modules/trial/trial-policy.service.ts`；信件 `apps/api/src/modules/trial/trial-emails.ts`；正規化 `apps/api/src/modules/trial/email-normalizer.ts`。全程用 `fastify.prismaAdmin`（BYPASSRLS；`trial_signups`、`tenants`、`platform_settings` 都是平台表，沒有 RLS）。

## 前端操作流程

### 公開（申請人）
| # | 流程 | 入口 | API → 後端 | 副作用 | 重點 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 申請 | `/trial`（`apps/web/src/app/trial/page.tsx`） | `POST /trial/signups {email, siteName, password}` → `requestTrial` | 新 email：建 `TrialSignup`（`pending_verification`）＋驗證信；pending/failed：**覆寫 `siteName`、`passwordHash`**、換 token、寄新信（不經節流） | `trial.enabled=false` 回 403 `TRIAL_CLOSED`（唯一對外可見差異）；其餘一律 202 同文案（防枚舉）；已開通過或已是 Agent 的 email 靜默不寄；每 IP 10 分鐘 5 次 |
| 2 | 重寄 | 申請成功畫面「重新寄送」 | `POST /trial/resend {email}` → `resendTrial` | 只對 pending；間隔 60 秒、最多 5 次 | 一律 202；畫面沒有回饋；每 IP 10 分鐘 3 次 |
| 3 | 驗證即開通 | 信中連結 → `/trial/verify?token=`（`apps/web/src/app/trial/verify/page.tsx`） | `GET /trial/verify?token=` → `verifyAndProvision` | 交易內：條件更新 `status` pending→provisioning → `provisionTenant`（方案 `trial.planSlug`、`trialEndsAt = now + durationDays`、三個系統角色、ADMIN）→ provisioned；交易外寄開通信 | 不看 `trial.enabled`（關閉後已寄的連結仍可開通）；過期 410 `TRIAL_TOKEN_EXPIRED`、無效 410 `TRIAL_TOKEN_INVALID`、email 被建走 409 `EMAIL_IN_USE` 並標 failed、重按冪等成功；每分鐘 10 次 |

### 平台後台 `/admin/trial`（`apps/web/src/app/admin/trial/page.tsx`）
| # | 流程 | 入口 | API → 後端 | 副作用 | 注意 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 4 | 試用租戶清單 | 「試用租戶」分頁 | `GET /trial-tenants` → `listTrialTenants` | 無 | 只列 `trialEndsAt` 不為 null 的租戶；狀態依序：已清除 > 已停用 > 已到期 > 即將到期（≤3 天，寫死）> 試用中；手動開通的試用方案租戶不在這裡（HC-PLATFORM-TENANTS-05） |
| 5 | 延長 | 列「延長」→ `window.prompt` 天數 | `PATCH /trial-tenants/:id/extend {days}` → `extendTrial` | 從「現有到期日」與「今天」取較晚者加天數；設 `isActive:true`、清 `trialRemindersSent`、清 `purgedAt`；稽核 `tenant.trial.extend` | 非試用 400 `NOT_TRIAL`；前端 `parseInt`（1.5 變 1）；失敗沒有訊息（HC-PLATFORM-TRIALS-03） |
| 6 | 轉正式 | 列「轉正式…」下拉（寫死 light/standard/professional/enterprise）→ confirm | `PATCH /trial-tenants/:id/convert {planSlug}` → `convertToPaid` | 改 `planId` ＋ `TRIAL_EXIT_DATA`（清 `trialEndsAt`、`purgedAt`，`isActive:true`）；失效權限天花板與租戶方案快取；稽核 `tenant.trial.convert` | 試用方案 400、方案不存在 404；**API 不檢查是否為試用租戶**，會重新啟用被停用的正式租戶（HC-PLATFORM-TRIALS-08） |
| 7 | 復原已清除 | 已清除的列只有「復原」→ confirm | `PATCH /tenants/:id/restore` → `restorePurgedTenant` | 只清 `purgedAt`，**不動 `isActive`**；稽核 `tenant.trial.restore` | 未標記 422 `NOT_PURGED`；沒接著延長或轉正式，下一輪排程會再標記（預期行為） |
| 8 | 申請記錄 | 「申請記錄」分頁（最近 100 筆，狀態顯示英文代碼） | `GET /trial-signups` | 無 | 看不到 `requestIp`、寄信次數 |
| 9 | 重寄驗證信 | 申請記錄列「重寄」 | `POST /trial-signups/:id/resend` → `resendVerification` | 繞過申請人的節流 | 只限 pending（其他 400）；**沒有稽核**（SEC-02） |
| 10 | 作廢 | 申請記錄列「作廢」→ confirm | `PATCH /trial-signups/:id/fail {reason}` → `markSignupFailed` | `failed`、清 `verifyTokenHash`；稽核 `trial.signup.fail` | 已開通 400；申請人再送一次申請就恢復為 pending（HC-PLATFORM-TRIALS-13） |
| 11 | 政策設定 | 「政策設定」分頁：勾選框即存、數字欄位 `onBlur` 即存 | `PUT /settings/:key {value}` → `setPlatformSetting` | 稽核 `setting.update`（無 payload） | 沒改值也寫入；清空欄位存成 NaN→null 失敗且無訊息；沒有 `trial.planSlug` 欄位（TRIAL-02）；勾「開放試用申請」就對外開放，沒有確認 |
| 12 | 合約起訖日 | **不在本頁**：`/admin/tenants` 列表「合約」與詳細頁 | `PATCH /tenants/:id/contract` → `updateTenantContract`（`trial-admin.service.ts`） | 稽核 `tenant.contract.update` | 只是紀錄，不觸發任何生命週期；迄日早於起日 422 `CONTRACT_DATE_INVALID` |

### 系統排程 `trial-lifecycle`（每小時，`withoutOverlapping` 鎖 30 分鐘）
| # | 步驟 | 條件 | 做的事 |
| - | ---- | ---- | ------ |
| 13 | 到期 | `isActive` 且 `trialEndsAt < now` | 停用、寄到期信給 `role=ADMIN` 的啟用成員、稽核 `tenant.trial.expire`（`platformUserId` 為 null） |
| 14 | 提醒 | `isActive` 且 `trialEndsAt >= now`，剩餘天數到達 `reminderDaysBefore` 中還沒寄的最大檔位 | 先寫 `trialRemindersSent` 再寄信；寄失敗不補寄 |
| 15 | 軟刪 | 停用、`purgedAt` 為 null、`trialEndsAt` 超過 `dataRetentionDays` | 設 `purgedAt`、稽核 `tenant.trial.purge`；不刪任何資料（TRIAL-03） |

每一步都是「讀取 → `claimEach` 條件更新 → 更新到才寄信與寫稽核」，避免蓋掉平台人員在讀取後做的延長或轉正式。

**有後端、沒有前端入口**：`trial.planSlug`（只能直接打 `PUT /settings/trial.planSlug`）；`TrialSignup.requestIp`、`verifySentCount`、`lastVerifySentAt`；依租戶查平台稽核。

**前端實際送出的值**：申請 `email`（瀏覽器 `type=email` 去頭尾空白）、`siteName`（不 trim、無 `maxLength`，後端上限 100）、`password`（`minLength=8`，空白也算）；延長 `days` 為正整數；轉正式 `planSlug` 寫死 4 個；政策 `trial.enabled` 布林、天數 `parseInt`、提醒檔位為整數陣列。

## 不可破壞的規則
- 開通必須在同一交易：`trialSignup.updateMany`（pending→provisioning）→ `provisionTenant(tx, …)` → provisioned。任何一步失敗整體回滾，token 不算用掉。不要把寄信放進交易。
- 防枚舉：`/signups`、`/resend` 對已開通、已是 Agent、不存在的 email 都回相同的 202。只有 `TRIAL_CLOSED` 可以不同。新增分支時不要讓回應、狀態碼或明顯的時間差洩漏 email 狀態。
- `trialEndsAt` 不是 null 就是試用租戶，排程只掃它。脫離試用只有兩條路：`convertToPaid` 與核准 `upgrade` 申請（`plan-change.service.ts`），兩者都寫 `TRIAL_EXIT_DATA`。改方案（`updateTenant`）、核准加購都**不**脫離試用。
- 試用方案（以 `trial.planSlug` 判斷，不寫死）不能當轉正式或升級的目標（`assertNotTrialPlan`）。
- 手動開通不設 `trialEndsAt`；只有試用驗證開通才設。
- 復原只清 `purgedAt`、不動 `isActive`；延長與轉正式才同時清 `purgedAt` 並啟用。
- 排程的每個寫入都要走 `claimEach` 的條件更新；提醒的條件要包含讀到的 `trialRemindersSent`（兩期重疊時只寄一次）。
- 平台稽核由路由寫（`writePlatformAudit`），服務不寫；排程用 `writeSystemAudit`（`platformUserId` 為 null）。新增平台異動路由要加進 `apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 的清單。
- 試用信的變數一律經 `escapeHtml`（`siteName` 是申請人自填）。既有試用信的 emoji 保留，新信不要加 emoji。
- 速率限制靠 `trial.routes.ts` 內註冊的 `@fastify/rate-limit`（`global: false`）。把路由搬到別的檔案，`config.rateLimit` 會被靜默忽略（SEC-03）。測試時用 `X-Forwarded-For` 帶不同 IP（本機 loopback 是受信任代理，`apps/api/src/lib/trust-proxy.ts`）。
- 修 HC-PLATFORM-TRIALS-01、02 時：pending 的申請再送一次不可覆寫密碼與站台名稱，重寄要走與 `/resend` 相同的節流。

## 跨功能牽連
執行 `node scripts/feature-impact.mjs --domain platform-trials` 看最新版本。重點：
- **依賴**：租戶管理（`provisionTenant`、停用行為）、平台認證（平台 token；到期後成員登入 `TENANT_DISABLED`）、方案（trial 方案天花板、轉正式的快取失效）、平台設定（`trial.*` KV）、通知（`sendEmail`）、成員（提醒只寄 `role=ADMIN`）。
- **被依賴**：租戶管理（合約與復原的服務在 `trial-admin.service.ts`、開通信模板在 `trial-emails.ts`）、方案異動審核（`TRIAL_EXIT_DATA`、`assertNotTrialPlan`）、平台用量（試用 AI 額度）。
- 試用到期停用的租戶仍收得到 WebChat 訊息（HC-PLATFORM-TENANTS-01），排程群發也照送（HC-PLATFORM-TENANTS-04）。

## 回歸清單
改到本領域時，至少重走（用 `hc-` 前綴的 email 與租戶，**不要對 Demo 或其他租戶做到期與清除**；`trial.enabled` 測完要恢復）：
1. `trial.enabled=false` → 申請 403、不建記錄 → 開啟 → `/trial` 申請 → API log 有驗證信（`EMAIL_DELIVERY_MODE=log` 會印 `verifyUrl`）→ 開 `/trial/verify?token=` → 站台已開通 → 以申請密碼登入，`/marketing/campaigns` 403（trial 天花板）。
2. 錯誤：過期 token（SQL 把 `verifyTokenExpiresAt` 改到過去）410、無效 410、重按冪等、email 已被手動開通建走 409、gmail 別名同一筆、已是 Agent 的 email 靜默 202。
3. 同一 email 用不同 IP 再送申請：確認密碼不被覆寫、不能繞過節流（HC-PLATFORM-TRIALS-01、02 修好之後）。
4. 排程：把自建試用租戶的 `trialEndsAt` 改成過去 / 6.5 天後 / 31 天前，手動執行 `runTrialLifecycle`（腳本要先呼叫 `apps/api/src/config/env.ts` 的 `loadEnvConfig()`，否則寄信全部失敗）→ 停用＋到期信、7 天提醒、停用＋軟刪；確認執行前資料庫沒有別人的試用租戶會被波及。
5. `/admin/trial`：延長已到期停用的租戶 → 試用中；復原已清除 → 已停用；轉正式 → 從清單消失；試用方案 400；重寄、作廢。
6. TRIAL-04：租戶頁啟用已到期試用租戶 → 下一輪排程又停用。
- 自動測試：`pnpm --filter @open333crm/api test -- platform-audit-routes plan-change tenant-plan schedule-registrations`；`pnpm --filter @open333crm/web test -- trial-page`；feature（先搶鎖、**不要加 `--`**）：`pnpm --filter @open333crm/api test:feature modules/trial modules/platform/plan-change-trial-exit modules/platform/tenant-contract-dates`。
- `trial-application` 的 9 個 scenario 沒有任何測試；提醒的三個 scenario 沒有同名測試。
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`（只開 `/admin/trial` 頁）。UAT 是正式環境，不要在 UAT 送試用申請。

## 常見 bug 從哪裡查
- 「收不到驗證信」：先看 `trial.enabled`（預設關閉，畫面會顯示「目前暫不開放」）；再看是否已是 Agent 或已開通（靜默不寄）；再看節流（`verifySentCount` ≥ 5 或 60 秒內）；最後查 API log 的 `[TrialEmail] send failed`。平台可在申請記錄按「重寄」（繞過節流）。
- 「驗證連結失效」：同一 email 後來又申請或重寄過，舊連結就失效，用最新那封；平台作廢過也會失效。
- 「登入密碼不對」：同一 email 在驗證前被再送過申請，密碼被覆寫成後送的值（HC-PLATFORM-TRIALS-01）。
- 「試用租戶被停用了」：`trialEndsAt` 已過，排程停用；要繼續用請「延長」或「轉正式」，不要在租戶頁按「啟用」（TRIAL-04，最多撐一小時）。
- 「試用租戶沒有到期／不在 /admin/trial」：手動開通的租戶沒有 `trialEndsAt`（HC-PLATFORM-TENANTS-05）；或曾被轉正式、核准升級。
- 「改了方案還是被停用」：在租戶詳細頁改方案不脫離試用，要用「轉正式」。
- 「提醒信沒寄」：檔位已寫進 `trialRemindersSent` 就不會再寄（寄失敗也一樣）；「即將到期」的 3 天與提醒檔位無關。
- 「已清除的資料不見了」：沒有任何資料被刪（TRIAL-03），`purgedAt` 只影響後台顯示；按「復原」即可。
- 「開通回 500 `TRIAL_MISCONFIGURED`」：`trial.planSlug` 指向不存在的方案（TRIAL-02）。
