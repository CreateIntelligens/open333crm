# 試用申請與到期處理 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，`EMAIL_DELIVERY_MODE=log`）。UAT 只做未登入的唯讀檢查，見[UAT 操作紀錄](#uat-操作紀錄)
- 規格：`docs/ref/features/feature-map.json` 的 `platform-trials`；功能文件 `docs/ref/features/platform/TRIALS.md`
- 相關報告：租戶管理 `docs/ref/features/health/PLATFORM-TENANTS.md`。合約起訖日、復原的 API 錯誤案例，以及「手動開通選試用方案卻不設 `trialEndsAt`」（HC-PLATFORM-TENANTS-05），都記在那份報告，這裡只引用

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 4 份 spec、46 個 scenario（`trial-application` 9、`trial-lifecycle` 20、`trial-data-purge` 10、`tenant-contract-dates` 7）。缺實作 0 個 scenario，但 `trial-application`「防枚舉統一回應」的需求本文「pending → 依節流規則重寄」沒有實作（HC-PLATFORM-TRIALS-02）。缺同名測試 13 個：`trial-application` 全部 9 個，`trial-lifecycle` 4 個（平台改試用天數、7 天提醒、重跑不重寄、停機跨檔位）。缺前端入口 0（`trial.planSlug` 沒有設定欄位，已記在 TRIAL-02） |
| 自動測試 | unit：api 4 檔 43 通過（`platform-audit-routes`、`plan-change`、`tenant-plan`、`schedule-registrations`），web 1 檔 1 通過（`trial-page`）。feature：6 檔 43 通過（`modules/trial` 4 檔、`plan-change-trial-exit`、`tenant-contract-dates`）。無失敗、無 skip |
| 實際操作 | 14 條流程。正常 7，異常 7，待真機驗 0（實際寄信另列[待真機驗](#待真機驗)） |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-TRIALS-01 | P1 | **任何人都能改寫別人「待驗證」申請的密碼，取得對方的試用站台。** 同一 email 再送一次申請時，`requestTrial` 直接用新送的值覆寫 `passwordHash` 與 `siteName`，並寄一封新驗證信給該 email（舊連結失效）。申請人點最新那封信，租戶就以攻擊者的密碼開通。攻擊者知道 email 與密碼，可以登入這個站台的 ADMIN 帳號，看到申請人之後放進去的所有客戶資料；申請人自己的密碼反而登不進去。攻擊者也可以對從未申請的 email 先送申請，對方點信就落入同一個情況（搶先註冊） | **實測**（本機）：IP-1 以 `hc-platform-trials-a@example.test` / `Passw0rd!` 申請 → IP-2 用同一 email、密碼 `Attacker99!`、站台名稱 `…-attacker` 再申請（202）→ 第一封信的連結回 410 → 點第二封信開通成功 → `POST /auth/login`：`Passw0rd!` 401、`Attacker99!` 200。第二封信的主旨會帶攻擊者填的站台名稱，這是申請人唯一看得出異狀的地方 | `apps/api/src/modules/trial/trial.service.ts:87-101`（`existing` 分支覆寫 `siteName`、`passwordHash`）；`:200`（開通沿用 `signupRow.passwordHash`） | TRIAL-05 |
| HC-PLATFORM-TRIALS-02 | P2 | 再送一次申請會繞過重寄節流。`/resend` 有「間隔 60 秒、最多 5 次」，`/signups` 遇到 pending 的申請卻每次都換 token 寄信，只受「每個 IP 每 10 分鐘 5 次」限制。換 IP 就能對任意信箱無限寄驗證信（以平台名義寄信轟炸，也會耗掉寄信額度與網域信譽）。違反主規格 `trial-application`「防枚舉統一回應」：pending 未過期 → 依節流規則重寄 | **實測**：7 個不同的 `X-Forwarded-For`，對 `hc-platform-trials-b@example.test` 連送 7 次申請，幾秒內 API log 有 7 封驗證信、`verifySentCount=7`；接著 `/resend` 兩次都沒有寄（節流正確）。同一 IP 第 6 次申請 429，正確 | `apps/api/src/modules/trial/trial.service.ts:87-118`；節流只在 `resendTrial`（`:131-135`） | TRIAL-06 |
| HC-PLATFORM-TRIALS-03 | P2 | `/admin/trial` 的操作都沒有錯誤處理：延長、轉正式、復原、重寄、作廢，失敗時畫面沒有任何訊息，錯誤成為未處理的 rejection。操作者會以為按了沒反應，或以為已經處理（例如以為已延長，客戶隔天仍被停用） | **實測**：Playwright 攔截 `PATCH /trial-tenants/*/extend` 回 500 → 按「延長」輸入 3 → 畫面無訊息，console 只有 `Request failed with status code 500`。其他操作讀程式，寫法相同 | `apps/web/src/app/admin/trial/page.tsx:88-123`；初始載入 `:59-75` 也沒有 catch | APP-11（`saveSetting` 部分在 TRIAL-02） |
| HC-PLATFORM-TRIALS-04 | P2 | 申請與開通完全沒有自動測試。`trial-application` 的 9 個 scenario（總開關、關閉後仍可開通、防枚舉、gmail 別名、過期 token、重寄後舊連結失效、開通成功、中途失敗可重試、email 已被建走）都找不到測試，`trial.service.ts`、`email-normalizer.ts`、`trial.routes.ts` 沒有任何測試引用。HC-01、HC-02 就是在沒有測試的地方 | 讀程式：`git ls-files apps/*/tests` 搜尋 `requestTrial`、`verifyAndProvision`、`normalizeEmail`、`trial/signups` 都沒有結果 | `apps/api/src/modules/trial/trial.service.ts`、`apps/api/src/modules/trial/email-normalizer.ts` | CI-04 |
| TRIAL-04 | P3 | 租戶頁「啟用」已到期的試用租戶，下一輪排程又停用並重寄到期信 | **實測**：`hc-platform-trials-A-attacker` 到期停用 → `PATCH /tenants/:id/active {isActive:true}` → 執行 `runTrialLifecycle` → 又變停用，API log 多一封「試用已到期」，稽核多一筆 `tenant.trial.expire` | 見 AUDIT | TRIAL-04（仍存在） |
| SEC-02 | P3 | 平台「重寄驗證信」沒有寫稽核 | **實測**：`POST /trial-signups/:id/resend` 200，`platform_audit_logs` 沒有新紀錄；「作廢」有 `trial.signup.fail` | 見 AUDIT | SEC-02（仍存在） |
| TRIAL-03 | P2 | 保留期滿只標記 `purgedAt`，不刪資料 | **實測**：保留期滿的 `hc-platform-trials-C` 被標記 `purgedAt` 並寫 `tenant.trial.purge`，業務資料不變 | 見 AUDIT | TRIAL-03（仍存在） |
| HC-PLATFORM-TRIALS-05 | P3 | 試用信寄送失敗只寫 log，沒有任何可見紀錄。提醒是先寫 `trialRemindersSent` 再寄信，寄失敗這個檔位就永遠不會再寄；到期信失敗，客戶不知道站台為什麼停用；平台後台看不到任何寄送結果。TRIALS.md 說明這是刻意的取捨，但與「失敗不可以只寫 log」的團隊原則衝突，列出供決定 | **實測**（意外重現）：第一次手動執行排程時寄信設定未載入，3 封信全部寄送失敗（`[TrialEmail] send failed`），但租戶照常停用、`trialRemindersSent` 已寫入 `[7]`，之後的排程不會補寄 | `apps/api/src/modules/trial/trial-emails.ts:145-151`；`apps/api/src/modules/trial/trial.scheduler.ts:100-117` | 新 |
| HC-PLATFORM-TRIALS-06 | P3 | 申請頁接受只有空白的站台名稱與密碼：站台名稱 `"   "`、8 個空白的密碼都能申請（同 HC-PLATFORM-TENANTS-07 的情況）。站台名稱超過 100 字時，後端回 400「最多 100 個字」，畫面卻只顯示「申請失敗，請稍後再試」；輸入框沒有 `maxLength`。429 也顯示同一句 | **實測**（UI）：空白站台名稱與空白密碼 → 顯示「請至信箱完成驗證」，DB 有 `siteName='   '` 的申請，驗證信主旨是「請驗證您的試用申請：   」；101 字 → 「申請失敗，請稍後再試。」 | `apps/api/src/modules/trial/trial.routes.ts:8-12`（`min(1)`、`min(8)` 未 trim）；`apps/web/src/app/trial/page.tsx:20-24, 50-52` | 新 |
| HC-PLATFORM-TRIALS-07 | P3 | 申請頁「重新寄送」按下後沒有任何回饋（沒有「已重寄」、沒有冷卻倒數），申請人會一直按 | **實測**：按「重新寄送」前後畫面文字完全相同；`POST /trial/resend` 有送出 | `apps/web/src/app/trial/page.tsx:29-35, 65-70` | 新 |
| HC-PLATFORM-TRIALS-08 | P3 | 「轉正式」API 不檢查租戶是否為試用租戶。對被平台刻意停用的非試用租戶呼叫，會改方案並重新啟用（`TRIAL_EXIT_DATA` 設 `isActive:true`），稽核記成 `tenant.trial.convert`。UI 只對試用租戶顯示這個選單，目前只能從 API 觸發 | **實測**：停用手動開通的 `hc-platform-trials-rl3-manual`（非試用）→ `PATCH /trial-tenants/:id/convert {planSlug:"standard"}` 200 → 租戶變成啟用、方案變標準版 | `apps/api/src/modules/platform/trial-admin.service.ts:151-166`（對照 `extendTrial` 有 `NOT_TRIAL` 檢查，`:133`） | 新 |
| HC-PLATFORM-TRIALS-09 | P3 | 延長天數輸入 `1.5` 時，前端 `parseInt` 成 1，顯示「已延長 1 天」，不提示。API 送 `days:0` 的錯誤訊息是「不可小於 0」，實際規則是必須大於 0 | **實測**：prompt 輸入 `1.5` → 到期日只加 1 天；`PATCH /extend {days:0}` → 400 `不可小於 0` | `apps/web/src/app/admin/trial/page.tsx:89-92`；`apps/api/src/modules/platform/platform.routes.ts:365`（`positive()` 的中文訊息對應錯） | 新 |
| HC-PLATFORM-TRIALS-10 | P3 | 政策設定分頁只要離開數字欄位就寫入，沒改值也寫，每次多一筆 `setting.update` 稽核。原本沒有這個鍵的（使用程式預設值），會因此被寫成目前的預設值，之後改程式預設不再生效。開放試用的勾選框一按就生效，沒有確認（等於對外開放公開申請） | **實測**：只把焦點從「試用天數」移到下一欄，`setting.update` 稽核從 10 筆變 11 筆。寫入新鍵的部分為讀程式 | `apps/web/src/app/admin/trial/page.tsx:82-86, 269-272` | 新（TRIAL-02 記的是型別與 NaN，不含這兩點） |
| HC-PLATFORM-TRIALS-11 | P3 | 申請記錄分頁的狀態直接顯示英文代碼（`pending_verification`、`provisioned`、`failed`）；不顯示申請時間（API 有回 `createdAt`）、寄信次數，也沒有對應到開通的租戶；只取最近 100 筆，沒有分頁 | **實測**：分頁列出 `hc-platform-trials-ui3@example.test pending_verification` 等 | `apps/web/src/app/admin/trial/page.tsx:235-244`；`apps/api/src/modules/platform/platform.routes.ts:347-357`（`take: 100`） | 新 |
| HC-PLATFORM-TRIALS-12 | P3 | 驗證頁把非 token 的錯誤都顯示成「連結無效，請重新申請」：`TRIAL_IN_PROGRESS`（另一個請求正在開通）、`TRIAL_MISCONFIGURED`（500，試用方案不存在）、429 都屬於這一類。申請人會重新申請，而重新申請不會解決這些問題 | 讀程式。有效、重按（冪等）、無效、無 token、已作廢 5 種情況實測，畫面正確 | `apps/web/src/app/trial/verify/page.tsx:26-31` | 新 |
| HC-PLATFORM-TRIALS-13 | P3 | 平台「作廢」的申請不是終止：申請人再送一次申請，`requestTrial` 把 `failed` 改回 `pending_verification` 並寄新驗證信。驗證頁對已作廢的連結也顯示「請重新申請」。如果作廢是為了擋濫用，擋不住 | 讀程式（作廢後的連結回 410 為實測） | `apps/api/src/modules/trial/trial.service.ts:87-101`（註解寫明「pending（或 failed）」）；`trial-admin.service.ts:189-199` | 新 |
| HC-PLATFORM-TRIALS-14 | P3 | email 正規化與主規格不一致：規格寫 gmail 才移除 `+tag`，程式對所有網域都移除。`a+x@corp.com` 申請過之後，`a@corp.com` 會被靜默擋下（202 但不寄信）。gmail 別名再送申請時，驗證信寄到新寫的別名，站台名稱被覆寫（同 HC-01） | **實測**：`hc.platform.trials.g@gmail.com` 申請後，`hcplatformtrialsg+demo@googlemail.com` 申請 → 同一筆記錄、`siteName` 變成第二次填的值，驗證信寄到 `…+demo@googlemail.com`。非 gmail 網域讀程式 | `apps/api/src/modules/trial/email-normalizer.ts:17-19`；規格 `openspec/specs/trial-application/spec.md`「一個 email 只能申請一次」 | 新 |
| HC-PLATFORM-TRIALS-15 | P3 | 轉正式的方案選單寫死 4 個 slug（`light`、`standard`、`professional`、`enterprise`），不讀 `/plans`。平台新增的方案選不到，停售的方案仍可選，改了 slug 會 404 | 讀程式（與 HC-PLATFORM-TENANTS-10 相同問題） | `apps/web/src/app/admin/trial/page.tsx:36-42` | 新（與 PLAN-01 相關） |
| HC-PLATFORM-TENANTS-05 | P2 | 手動開通預設「免費試用」方案但不設 `trialEndsAt`，這類租戶不會出現在 `/admin/trial` | 本次在 `/admin/trial` 確認：手動開通的租戶都不在清單上 | 見租戶管理報告 | TRIAL-07（引用） |
| HC-PLATFORM-TENANTS-01 | P1 | 停用的租戶仍收得到 WebChat 訊息。試用到期停用的租戶也一樣，違反 `trial-lifecycle`「到期停用」的「inbound 訊息被丟棄」 | 見租戶管理報告（實測） | 見租戶管理報告 | AUTH-11（引用） |

### 已確認正常（與文件一致）

- 總開關關閉：`POST /signups` 回 403 `TRIAL_CLOSED`，不建記錄；關閉之後，已寄出的驗證連結仍能開通。
- 防枚舉：已是 Agent 的 email（`admin@open333crm.dev`、`ADMIN@open333crm.dev`）、已開通過的 email 都回相同的 202，不建記錄、不寄信。
- 驗證：過期 410 `TRIAL_TOKEN_EXPIRED`、無效 410 `TRIAL_TOKEN_INVALID`、缺 token 400、重按回冪等成功（`alreadyProvisioned:true`）、email 已被其他租戶建走 409 `EMAIL_IN_USE` 並把申請標成 `failed`。
- 開通：`trialEndsAt` 為開通時間加 14 天，方案為 `trial`，開通信寄到申請 email。以申請密碼登入後，試用方案天花板生效：`/marketing/campaigns`、`/analytics/overview` 403，`/contacts` 200。
- 速率限制：`/signups` 同一 IP 第 6 次 429，`/resend` 第 4 次 429，換 `X-Forwarded-For` 會分開計算（本機連線來自 loopback，屬於受信任的代理）。
- 排程（以 `runTrialLifecycle` 手動執行一輪）：到期 → 停用、到期信、`tenant.trial.expire` 稽核；剩 7 天與剩 1 天各寄一次提醒，`trialRemindersSent` 依序為 `[7]`、`[7,1]`；早已過保留期但仍啟用的租戶，同一輪先停用再標記 `purgedAt`。到期後登入回 403 `TENANT_DISABLED`。
- 延長：已到期停用的租戶從今天起算、恢復啟用；已清除的租戶在清單上只有「復原」。轉正式到試用方案 400、方案不存在 404；轉正式後租戶從清單消失，稽核 `tenant.trial.convert`。
- 復原：清除標記後狀態變「已停用」，按鈕變回「延長」「轉正式」，稽核 `tenant.trial.restore`。
- 平台重寄驗證信會繞過申請人的節流（寄信次數已到 5 仍會寄），只限待驗證的申請（其他回 400）；作廢已開通的申請回 400；作廢後舊連結 410。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 公開申請 `/trial` | 本機（UI、API） | 正常：送出後顯示「請至信箱完成驗證」，API log 有驗證信 | **異常**：重送會覆寫密碼（HC-01）、繞過節流（HC-02）；空白值被接受、超長顯示通用錯誤（HC-06） | 公開，無 | 速率限制正確 |
| 2 申請頁重寄 | 本機（UI、API） | 正常：節流 60 秒、5 次 | — | 公開 | **異常**：沒有回饋（HC-07） |
| 3 驗證開通 `/trial/verify` | 本機（UI、API） | 正常：開通、重按冪等 | 過期、無效、無 token、已作廢、email 已被使用都正確 | 公開 | 其他錯誤顯示不準（HC-12，讀程式） |
| 4 防枚舉與別名 | 本機（API） | 正常：Agent email、已開通 email 都靜默 202 | **異常**：別名重送覆寫站台名稱並寄到新別名（HC-14） | — | |
| 5 總開關 | 本機（API） | 正常：關閉 403、關閉後仍能開通 | — | — | 測完已刪除 `trial.enabled`（恢復為程式預設關閉） |
| 6 試用租戶列表 `/admin/trial` | 本機（UI） | 正常：5 種狀態、剩餘天數、到期日正確 | 讀取失敗無訊息（HC-03，讀程式） | 平台 token | |
| 7 延長 | 本機（UI、API） | 正常：已到期停用的租戶延長 7 天 → 試用中 | **異常**：失敗無訊息（HC-03）；1.5 變 1（HC-09）；0 前端擋；非試用 400 `NOT_TRIAL`；非 UUID 400 `DATABASE_ERROR`（同 HC-PLATFORM-TENANTS-09） | — | 有確認：無（prompt 本身即確認） |
| 8 轉正式 | 本機（UI、API） | 正常：有 confirm，轉輕量版後從清單消失 | 試用方案 400、不存在 404 | — | **異常**：API 對非試用租戶也生效（HC-08）；方案寫死（HC-15） |
| 9 復原 | 本機（UI） | 正常：confirm 後變已停用 | 422、404 見租戶管理報告 | — | |
| 10 申請記錄：重寄、作廢 | 本機（UI、API） | 正常：重寄繞過節流、作廢有 confirm 與稽核 | 非待驗證 400、已開通 400、不存在 404 | — | **異常**：英文狀態、無時間（HC-11）；重寄無稽核（SEC-02）；作廢可被申請人推翻（HC-13） |
| 11 政策設定 | 本機（UI） | 正常：讀出 14 / 24 / 30 / `7, 1` / 開放 | 清空欄位存 NaN 已在 TRIAL-02，未重測（同時有其他代理在改這些鍵） | — | **異常**：沒改值也寫入（HC-10） |
| 12 到期前提醒（排程） | 本機（手動執行排程） | 正常：7 天、1 天各一封，不重寄 | — | — | 只寄 ADMIN（RBAC-03）；寄失敗不補寄（HC-05） |
| 13 到期停用（排程） | 本機（手動執行排程） | 正常：停用、到期信、稽核、登入 403 | 租戶頁啟用後又被停用（TRIAL-04） | — | WebChat 仍收訊息（HC-PLATFORM-TENANTS-01） |
| 14 保留期滿軟刪（排程） | 本機（手動執行排程） | 正常：標記 `purgedAt`、稽核 | — | — | 不刪資料（TRIAL-03） |
| （參考）合約起訖日 | — | — | — | — | 見租戶管理報告流程 4、8 |

權限：平台後台沒有角色分級（AUTH-04），所有 `/platform/*` 只認平台 token。公開端點沒有登入。試用租戶本身的功能限制由 trial 方案天花板執行，實測正確（見上）。

## 完備度對照

| Spec / Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| trial-application／總開關關閉 | `trial.service.ts:64-67`、`trial.routes.ts:41-43` | **無** | `/trial` 顯示「目前暫不開放」 |
| trial-application／關閉後既有驗證信仍可完成開通 | `verifyAndProvision` 不讀 `enabled` | **無** | `/trial/verify` |
| trial-application／已開通過的 email 再申請 | `trial.service.ts:73-76` | **無** | `/trial` |
| trial-application／gmail 別名重複申請 | `email-normalizer.ts` | **無** | `/trial`（但會覆寫申請內容，HC-14） |
| trial-application／過期 token | `trial.service.ts:180-182` | **無** | `/trial/verify` 顯示「連結已失效或過期」 |
| trial-application／重寄後舊連結失效 | `trial.service.ts:138-147` | **無** | 申請頁「重新寄送」、平台「重寄」 |
| trial-application／開通成功 | `trial.service.ts:184-208` | **無** | `/trial/verify` |
| trial-application／開通中途失敗可重試 | 交易回滾，`status` 回到 pending | **無** | — |
| trial-application／email 已被其他租戶建走 | `trial.service.ts:209-217` | **無** | `/trial/verify` 顯示「此 email 已被使用」 |
| trial-application（需求本文）／pending 依節流重寄 | **未實作**（HC-02） | 無 | — |
| trial-lifecycle／平台改試用天數即時生效 | `getTrialPolicy` 每次讀取 | **無** | 政策分頁 |
| trial-lifecycle／到期前 7 天寄提醒、重跑不重寄、停機跨檔位不漏寄 | `trial.scheduler.ts:86-118` | **無同名**（`trial-scheduler-race.test.ts`「沒有競態時照常寄提醒並寫入標記」部分涵蓋） | 系統排程 |
| trial-lifecycle／到期停用 | `trial.scheduler.ts:75-84` | 有（`trial-data-purge.test.ts`） | 系統排程 |
| trial-lifecycle／試用租戶用盡 token | 屬平台用量領域 | 有（`apps/api/tests/unit/modules/ai/usage-quota.test.ts`） | — |
| trial-lifecycle／轉付費、升級申請脫離試用、試用方案不能當目標（10 個） | `trial-admin.service.ts`、`plan-change.service.ts` | 10/10 同名（`plan-change-trial-exit.test.ts`） | `/admin/trial`、`/admin/plan-changes` |
| trial-lifecycle／平台延長試用（4 個） | `trial-admin.service.ts:126-148` | 4/4 同名（`trial-extend.test.ts`） | `/admin/trial`「延長」 |
| trial-data-purge（10 個） | `trial.scheduler.ts:120-133`、`trial-admin.service.ts:78-89` | 10/10（見租戶管理報告） | `/admin/trial` |
| tenant-contract-dates（7 個） | `trial-admin.service.ts:97-123` | 7/7（`tenant-contract-dates.test.ts`） | `/admin/tenants` |

**有後端、沒有前端入口**：`trial.planSlug` 沒有設定欄位（TRIAL-02）；`TrialSignup.requestIp`、`verifySentCount`、`lastVerifySentAt` 有存，平台看不到。

**前端送出的值與後端 Zod**：申請 `{email, siteName, password}`，`type=email` 由瀏覽器去頭尾空白，後端 `email()` 不接受空白（API 直接送 `"x@y "` 回 400）；延長 `days` 為 `parseInt` 後的正整數；轉正式 `planSlug` 寫死 4 個；政策設定送 `boolean`、`parseInt` 結果（可能是 NaN→null，TRIAL-02）、整數陣列。沒有發現前端送出、後端拒絕的合法值。

## 待真機驗

- 驗證信、開通信、提醒信、到期信在真實信箱的呈現與連結（需要 Resend，且不能寄到真實地址）。
- ~~UAT 的 `trial.enabled` 目前是否開啟~~ **已確認**：主控 2026-10-30 以平台 API 唯讀查詢，UAT 的 `trial.enabled` 是 `true`（公開試用申請開放中），所以 HC-01、HC-02 在正式環境可被利用。
- 正式環境的 `X-Forwarded-For` 鏈：本機 loopback 受信任，所以能用標頭換 IP；正式環境依 `apps/api/src/lib/trust-proxy.ts` 應只採 nginx 附加的值，未在 UAT 驗證。

## UAT 操作紀錄

依指示不送公開試用申請、不確定密碼不登入平台後台。只做未登入的唯讀檢查（持 UAT 鎖約 1 分鐘）：`/trial`、`/trial/verify`、`/admin/trial` 三頁 200；`GET /api/v1/trial/verify`（無 token）400「缺少 token」，與本機一致；`GET /api/v1/platform/trial-tenants` 無 token 401。UAT 建立 0 筆、刪除 0 筆。

本機建立的資料（都在 `open333crm_advisor`，沒有刪除租戶與申請的 API，全部保留）：

| 類型 | 名稱 | ID | 狀態 |
| --- | --- | --- | --- |
| 租戶 | hc-platform-trials-A-attacker | e88986e3-50f3-427c-91b1-44a7eb5bdd8e | 試用，延長後啟用，到期日 2026-11-07；ADMIN 密碼為攻擊者的密碼（HC-01 重現） |
| 租戶 | hc-platform-trials-rl | cf4a68fc-603a-4126-898d-121b8d667f2d | 試用，到期日已改為 2026-10-31，API 的排程會在到期後停用它並寄到期信（log） |
| 租戶 | hc-platform-trials-C | df4e336d-5f56-4665-806d-b3cbda66006f | 試用，停用，已復原（`purgedAt` 清除），下一輪排程會再標記 |
| 租戶 | hc-platform-trials-UI | ded511dc-48f8-407e-8ddb-8d04cad7bb6a | 已轉正式（輕量版） |
| 租戶 | hc-platform-trials-rl3-manual | 247ad6d6-9358-4805-b532-fc4271af3257 | 手動開通，經 HC-08 測試後為標準版、啟用 |
| 試用申請 | `hc-platform-trials-*@example.test`、`hc.platform.trials.g@gmail.com` 共 12 筆 | — | pending / provisioned / failed 混合 |

平台設定：`trial.enabled` 測試期間由我寫入 `true`，結束時刪除這一列，恢復為程式預設（關閉）。`trial.durationDays=14` 這一列在測試期間同時有其他代理寫入，值等於預設值，沒有動。Demo 租戶、其他代理的租戶（包括清單上的 `hc-platform-tenants-B試用`）沒有任何寫入。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-TRIALS-01：重送申請覆寫待驗證申請的密碼（搶先註冊，可取得別人的試用站台）。建議 P1。修正方向：pending 的申請再送時不覆寫密碼與站台名稱，只依節流重寄原連結；或改成驗證後才設定密碼。
- HC-PLATFORM-TRIALS-02：`/signups` 繞過重寄節流，違反 `trial-application` 主規格。建議 P2，與 HC-01 一起修。
- HC-PLATFORM-TRIALS-03：`/admin/trial` 操作失敗沒有訊息（可併入 TRIAL-02 的「前端 `saveSetting()` 補上 catch」）。
- HC-PLATFORM-TRIALS-04：試用申請與開通沒有任何測試。
- HC-PLATFORM-TRIALS-05：試用信寄送失敗只寫 log、提醒不補寄（需要決定是否維持 TRIALS.md 的取捨）。
- HC-PLATFORM-TRIALS-08：轉正式 API 會重新啟用非試用租戶。

## 文件過時之處

- `openspec/specs/trial-application/spec.md`「驗證即開通」寫消耗 token 時「設為 null」。程式刻意保留雜湊、以 `status` 當消耗閘，讓重按能回冪等成功（`trial.service.ts:165-167`）。規格應改成描述目前的做法。
- `openspec/specs/trial-application/spec.md`「一個 email 只能申請一次」寫 gmail 才移除 `+tag`，程式對所有網域都移除（HC-14）。兩邊要決定以哪個為準。
- `docs/ref/features/platform/TRIALS.md` 的核對日期是 2026-09-23。內容與程式一致，但沒有寫出：同一 email 再送申請會覆寫密碼與站台名稱並繞過節流（HC-01、HC-02）、平台「作廢」可被申請人重送推翻（HC-13）、轉正式 API 不限試用租戶（HC-08）。
- `docs/ref/features/platform/TRIALS.md`「誰能做什麼」沒有列出公開頁面 `/trial`、`/trial/verify`，也沒有寫速率限制（申請每 IP 10 分鐘 5 次、重寄 3 次、驗證每分鐘 10 次）。
