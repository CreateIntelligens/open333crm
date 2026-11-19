# 試用管理

試用租戶從申請到期滿的完整生命週期，以及平台可以做的介入。

- **資料來源**：`apps/api/src/modules/platform/trial-admin.service.ts`、`apps/api/src/modules/trial/*`、`apps/web/src/app/trial/*`、`apps/web/src/app/admin/trial/page.tsx`
- **核對日期**：2026-11-19

## 程式的入口

| 入口 | 路由與前綴 | 函式 |
| --- | --- | --- |
| 公開端點 | `apps/api/src/modules/trial/trial.routes.ts`，前綴 `/api/v1/trial` | `trial.service.ts` 的 `requestTrial()`、`resendTrial()`、`getVerifyStatus()`、`verifyAndProvision()` |
| 平台端點 | `apps/api/src/modules/platform/platform.routes.ts`，前綴 `/api/v1/platform` | `trial-admin.service.ts` 的 `listTrialTenants()`、`extendTrial()`、`convertToPaid()`、`restorePurgedTenant()`、`resendVerification()`、`markSignupFailed()`、`updateTenantContract()` |
| 排程 | `apps/api/src/modules/trial/trial.scheduler.ts` | `runTrialLifecycle()` |
| 政策 | 沒有路由，存在平台設定 | `apps/api/src/modules/trial/trial-policy.service.ts` 的 `getTrialPolicy()` |
| 信件 | — | `apps/api/src/modules/trial/trial-emails.ts` |
| email 正規化 | — | `apps/api/src/modules/trial/email-normalizer.ts` 的 `normalizeEmail()` |

全程使用 `fastify.prismaAdmin`（BYPASSRLS）。`trial_signups`、`tenants`、`platform_settings` 都是平台表，沒有 RLS。

平台的異動路由在路由裡寫稽核（`writePlatformAudit()`），服務不寫；排程用 `writeSystemAudit()`，`platformUserId` 為 null。延長寫 `tenant.trial.extend`，轉正式寫 `tenant.trial.convert`，復原寫 `tenant.trial.restore`，作廢寫 `trial.signup.fail`。平台重寄驗證信（`POST /trial-signups/:id/resend`）不寫稽核，見 `../../system/AUDIT.md` 的 SEC-02。

公開端點的速率限制由 `trial.routes.ts` 內註冊的 `@fastify/rate-limit`（`global: false`）提供。把路由搬到別的檔案，路由上的 `config.rateLimit` 會被靜默忽略，見 `../../system/AUDIT.md` 的 SEC-03。速率限制以來源 IP 計算；本機的 loopback 是受信任的代理（`apps/api/src/lib/trust-proxy.ts`），所以本機測試可以用 `X-Forwarded-For` 帶不同的 IP。

## 誰能做什麼

外部使用者只能自助完成申請與信箱驗證，這兩步在 `trial` 模組。開通之後的所有生命週期操作，不是排程自動執行，就是平台人員逐筆操作。

| 動作 | 執行者 | 範圍 |
| --- | --- | --- |
| 申請、信箱驗證 | 外部使用者，在 `/trial` 與 `/trial/verify` | 自己這一筆 |
| 提醒、到期停用、保留期滿軟刪 | `apps/api` 的每小時排程 | 掃全部試用租戶 |
| 延長試用、轉正式方案、復原軟刪 | 平台人員在 `/admin/trial` | 指定的單一租戶 |
| 記錄合約日期 | 平台人員在 `/admin/tenants` 或 `/admin/tenants/:id` | 指定的單一租戶，不限試用租戶 |
| 合約到期前提醒（只寄信，不停用） | `apps/api` 的每小時排程 `contract-reminder.scheduler.ts` | 啟用中、合約迄日未過的租戶，寄給所有啟用中的平台帳號 |
| 重寄驗證信、作廢申請 | 平台人員在 `/admin/trial` | 指定的單一筆申請 |

**合約到期提醒**：剩餘天數是迄日的日期減台灣今天的日期。檔位存平台設定
`contract.reminderDaysBefore`（預設 `[30, 7, 1]`），在 `/admin/tenants` 的「合約到期提醒」設定卡修改，按「儲存」才送出。
寫入時前端與 API 都驗證：1 到 365 的整數組成的非空陣列，去重、由大到小；不合法回 400 `VALIDATION_ERROR`，不改存預設值。排程挑「大於或等於剩餘天數」的最小檔位，未寄過才寄，並把較大的檔位一起記入 `tenants.contractRemindersSent`，
晚設定的合約不會連收多封。平台人員修改迄日時清空 `contractRemindersSent`。`/admin/tenants` 列表標示「已過期」與
「30 天內到期」，可依迄日排序。合約到期**不會**停用租戶，是否自動停用尚待產品決定。

## 生命週期

```text
申請        外部填 email、站台名稱 → trial_signups（pending_verification）→ 寄驗證信
  ↓
驗證        點信中連結 → 驗證頁確認連結（不開通）→ 本人設定密碼、確認站台名稱
            → 送出後 provisionTenant 建租戶，trialEndsAt = 現在 + durationDays
  ↓
提醒        剩餘天數到達設定的檔位 → 寄信給該租戶的所有 ADMIN
            寄過的檔位記在 trialRemindersSent，同一檔位不重寄
  ↓
到期        trialEndsAt 已過且仍啟用 → isActive = false
            寄到期信 + 寫入 tenant.trial.expire 稽核
  ↓
軟刪        已停用，且距 trialEndsAt 超過 dataRetentionDays
            → purgedAt = 現在。只標記，業務資料不真刪，可復原
```

## 申請與驗證

申請時不收密碼。管理員密碼只能由打開驗證信連結的人設定，所以知道別人 email 的人無法替對方決定密碼。

| 端點 | 做什麼 |
| --- | --- |
| `POST /api/v1/trial/signups`（email、siteName） | 防枚舉：一律回 202 同文案，`trial.enabled=false` 時回 403 `TRIAL_CLOSED`。請求帶 `password` 時忽略、不儲存（相容舊頁面）。每個 IP 每 10 分鐘 5 次 |
| `POST /api/v1/trial/resend`（email） | 重寄驗證信，一律 202。每個 IP 每 10 分鐘 3 次 |
| `GET /api/v1/trial/verify?token=` | 驗證頁確認連結：回 email、站台名稱、`pending` 或 `provisioned`。只讀，不消耗 token、不開通。連結過期回 410 `TRIAL_TOKEN_EXPIRED`，無效回 410 `TRIAL_TOKEN_INVALID`，申請已是 `failed` 回 409 `EMAIL_IN_USE`。每個 IP 每分鐘 10 次 |
| `POST /api/v1/trial/verify`（token、password、siteName） | 設定密碼並開通。密碼至少 8 碼、站台名稱 trim 後 1–100 字（未送沿用申請的名稱），不合規回 400 且 token 仍可用。不看 `trial.enabled`。`trial.planSlug` 指向不存在的方案時回 500 `TRIAL_MISCONFIGURED`（`../../system/AUDIT.md` 的 TRIAL-02）。每個 IP 每分鐘 10 次 |

申請的站台名稱在 API 端 trim 後限 1–100 字。防枚舉的意思是：`/signups` 與 `/resend` 對已開通、已是 Agent、不存在的 email 都回相同的 202，只有 `TRIAL_CLOSED` 不同。新增分支時，回應、狀態碼與明顯的時間差都不可以洩漏 email 的狀態。

`normalizeEmail()` 把 email trim 並轉小寫，用來建立 Agent。它另外算出一個正規化的值，當作擋重複申請的唯一鍵：對所有網域移除 `+` 之後的字，gmail 與 googlemail 再移除帳號裡的點。主規格 `trial-application` 寫的是只有 gmail 才移除 `+tag`；`a+x@corp.com` 申請過之後，`a@corp.com` 的申請會被靜默擋下（HC-PLATFORM-TRIALS-14）。

`/resend` 的節流：距上次寄出不到 60 秒，或這筆申請已寄滿 5 封驗證信（含第一封）時不寄，仍回 202。

`requestTrial()` 依 email 的狀態分流：

| 狀態 | 行為 |
| --- | --- |
| 全新 | 建立申請、寄驗證信 |
| 待驗證 | **不改任何申請資料**，交給 `resendTrial()`：距上次寄出不到 60 秒、或已寄滿 5 封時不寄；否則換新 token 寄到原申請的 email，舊連結失效 |
| `failed`（email 衝突或平台作廢） | 視同重新申請：換站台名稱與 token，寄送次數重算為 1 |
| 已開通，或 email 已是任一租戶的 Agent | 靜默，不寄信 |

平台「作廢」的申請也是 `failed`，所以申請人再送一次申請，申請就回到 `pending_verification` 並寄出新的驗證信。作廢擋不住同一個 email 再申請（HC-PLATFORM-TRIALS-13）。

`verifyAndProvision()` 在交易外雜湊密碼，再在同一個交易內以條件式更新搶佔申請（仍是 `pending_verification`、且 token 未被重寄換掉，狀態改成 `provisioning`），再以 `provisionTenant(tx, …)` 建立租戶、system roles 與 ADMIN（方案是 `trial.planSlug`，`trialEndsAt` 是現在加 `trial.durationDays`，密碼是這次送出的），最後標記 `provisioned` 並寫入最終的站台名稱。開通時 email 已被別的帳號建走，回 409 `EMAIL_IN_USE`，申請標成 `failed`。任一步失敗整個回滾，token 仍可重試。寄信不可放進這個交易。同一 token 再送一次（雙擊或兩個分頁同時送出）只開通一次，回 `alreadyProvisioned: true`，不改第一次設定的密碼。開通信在交易外寄出。

`trial_signups` 不存密碼。`passwordHash` 欄位由 migration `20261102100000_drop_trial_signup_password_hash` 移除。

主規格 `trial-application` 與程式有一處寫法不同：程式消耗 token 時保留 token 的雜湊，以 `status` 當作閘門，讓同一個 token 重按時回 `alreadyProvisioned`。

## 排程

排程是 `apps/api/src/modules/trial/trial.scheduler.ts` 的 `runTrialLifecycle()`，由 BullMQ Job Scheduler 每小時觸發一次。API 重啟不會額外執行。註冊時設定 `withoutOverlapping`（鎖的存活時間 30 分鐘），上一期還在跑時，這一期略過。逐租戶 try/catch，單一租戶失敗不影響其他租戶。

它依序執行三步。每一步各讀一次租戶，條件不同：

| 步驟 | 讀取條件 | 做的事 |
| --- | --- | --- |
| 到期 | 仍啟用，`trialEndsAt` 早於這一輪的執行時間 | 停用，寄到期信給該租戶 `role=ADMIN` 的啟用成員 |
| 提醒 | 仍啟用，`trialEndsAt` 不早於這一輪的執行時間 | 剩餘天數到達還沒寄過的檔位時，寄提醒信給該租戶 `role=ADMIN` 的啟用成員 |
| 軟刪 | 已停用，`purgedAt` 為 null，距 `trialEndsAt` 超過保留天數 | 標記軟刪 |

到期排在軟刪之前。早已過保留期、但仍啟用的租戶，同一次執行中先被停用，再被標記。

軟刪的計算基準是 `trialEndsAt`，不是停用當下的時間。平台提前手動停用一個試用租戶，不會讓保留期提早開始。

提醒與到期信的收件人看舊的角色列舉 `role=ADMIN`，不看細粒度角色（`../../system/AUDIT.md` 的 RBAC-03）。剩餘天數是 `trialEndsAt` 減現在、以天為單位無條件進位。

提醒的檔位判定會補寄：它在「大於或等於剩餘天數、而且還沒寄過」的檔位中取最大的一個。系統停機跨越某個檔位時，下一輪仍會補上那一封，不會整個跳過。例如檔位是 `[7, 1]`、剩餘 1 天、兩個檔位都沒寄過時，這一輪寄 7 天的檔位，下一輪再寄 1 天的檔位。

每一步都先讀出租戶，再逐一「認領」：用讀取條件加上租戶 id 做條件更新（`claimEach()`）。更新到這一筆租戶時，排程才寄信、寫稽核。讀取之後，租戶可能被平台人員延長、轉正式或停用。這時條件不成立，排程略過這一筆，不會用讀到的舊狀態蓋掉平台人員的操作。

提醒的認領條件和讀取條件不同：`trialEndsAt` 與 `trialRemindersSent` 都要仍是讀到的值。比對 `trialRemindersSent` 是為了兩次排程重疊的情況。兩期重疊平常由 `withoutOverlapping` 的鎖擋住。一期跑超過 30 分鐘時，鎖會過期，下一期可能和這一期讀到同一筆。這個條件讓只有一次排程寄信。

提醒是先寫標記再寄信。寄信失敗只寫 log（`trial-emails.ts` 的 `safeSend()`），本來就不會重寄，所以先寫標記不會讓原本會重寄的提醒漏寄。檔位寫進 `trialRemindersSent` 之後，即使寄信失敗，這個檔位也不會再寄。平台後台看不到寄送的結果（HC-PLATFORM-TRIALS-05）。

試用信的變數一律經過 `escapeHtml()`，因為 `siteName` 是申請人自己填的。既有的試用信含 emoji。

排程的停用與軟刪各寫一筆稽核（`tenant.trial.expire`、`tenant.trial.purge`），`platformUserId` 留空代表系統動作。稽核寫入失敗只被吞掉，不會擋下停用或軟刪。

## 政策參數

試用天數、提醒檔位、保留天數都不是寫死的。它們存在 `PlatformSetting` 的 `trial.*` 鍵，平台後台可改，程式預設值寫在 `trial-policy.service.ts` 的 `DEFAULTS`：

| 參數 | 預設值 | 作用 |
| --- | --- | --- |
| `trial.enabled` | `false` | 整個試用功能的開關。**預設關閉**，要平台後台手動開啟 |
| `trial.durationDays` | 14 | 開通時 `trialEndsAt` 距今幾天 |
| `trial.reminderDaysBefore` | `[7, 1]` | 剩餘幾天時寄提醒 |
| `trial.verifyTokenTtlHours` | 24 | 驗證信連結的有效時數 |
| `trial.dataRetentionDays` | 30 | 到期後幾天標記軟刪。只標記，不刪任何資料，見 AUDIT 的 TRIAL-03 |
| `trial.planSlug` | `trial` | 開通時綁定的方案。也用來判斷哪個方案是試用方案 |

這些鍵的寫入方式、型別錯誤時的行為與政策設定分頁的問題，見[平台設定](./SETTINGS.md)。`trial.planSlug` 不在政策設定分頁上，只能打 `PUT /settings/trial.planSlug`。

## 清單上的狀態怎麼判定

`/admin/trial` 的試用租戶清單（`GET /trial-tenants`）只列 `trialEndsAt` 不為 null 的租戶，依到期日由近到遠排序。手動開通、選了試用方案的租戶沒有 `trialEndsAt`，不在這份清單上（HC-PLATFORM-TENANTS-05）。狀態是算出來的，不是欄位，判定依序取第一個成立的：

| 狀態 | 條件 |
| --- | --- |
| 已清除 | `purgedAt` 有值 |
| 已停用 | `isActive` 是 `false` |
| 已到期 | 剩餘天數小於等於 0 |
| 即將到期 | 剩餘天數小於等於 3 |
| 試用中 | 其餘 |

「即將到期」的 3 天寫死在 `listTrialTenants()` 裡，**與提醒信的檔位無關**。`trial.reminderDaysBefore` 預設是剩 7 天與剩 1 天各寄一封，所以租戶收到第一封提醒信時，清單上仍然顯示「試用中」。兩個數字各自獨立，改其中一個不會連動。

## 每項操作實際改了什麼

`extendTrial(tenantId, addDays)` 延長**指定的單一租戶**，不影響其他租戶。新到期日的基準是「該租戶現有的到期日」與「今天」取較晚者：

| 情境 | 基準 | 延長 7 天後 |
| --- | --- | --- |
| 到期日 10/31，今天 10/20（未到期） | 10/31 | 11/7 |
| 到期日 10/15，今天 10/20（已過期） | 10/20 | 10/27 |

取較晚者是為了讓兩個方向都合理。一律從今天起算，第一種情境會變成 10/27，比原本的到期日還早。一律從原到期日起算，第二種情境會變成 10/22，延長的天數有一大半用在過去。

天數必須是正整數，不是試用租戶回 400 `NOT_TRIAL`。延長同時把 `isActive` 設成 `true`，因此已到期停用的租戶會恢復；並清空 `trialRemindersSent`，讓新週期重新發提醒。延長也把 `purgedAt` 清成 `null`，已清除的租戶延長後不再顯示「已清除」。

`convertToPaid(tenantId, planSlug)` 不檢查租戶是不是試用租戶。平台人員對正式租戶呼叫也會成功，結果等同改方案，而且會重新啟用被停用的租戶，稽核記成 `tenant.trial.convert`（HC-PLATFORM-TRIALS-08）。方案不存在回 404。轉正式之後，系統失效權限天花板快取與租戶方案快取。它改 `planId`，並寫入 `TRIAL_EXIT_DATA`：把 `trialEndsAt` 與 `purgedAt` 清成 `null`、把 `isActive` 設成 `true`。清空 `trialEndsAt` 是脫離試用的關鍵：排程只掃 `trialEndsAt` 不為 null 的租戶。目標方案是試用方案時回 400，試用方案以試用政策的 `trial.planSlug` 判斷（`assertNotTrialPlan()`）。

`restorePurgedTenant(tenantId)` 清除 `purgedAt`，但**不動 `isActive`**，租戶維持停用。業務資料本來就是軟刪，復原只是讓平台方重新看到它不是「已清除」狀態。保留期滿時沒有任何資料被刪除，見 `../../system/AUDIT.md` 的 TRIAL-03。復原是讓平台人員接著延長或轉正式。復原後沒有這樣做，租戶仍符合標記的條件，下一輪排程會再標記，這是預期的行為。

`resendVerification(signupId)` 重寄驗證信，而且**刻意繞過使用者端的重寄節流**（使用者寄滿 5 封之後，只能由平台人員重寄），避免平台人員的操作靜默失敗。只有 `pending_verification` 的申請能重寄，其餘回 400。

`markSignupFailed(signupId, reason)` 手動把申請標記為 `failed` 並清掉驗證 token，供排查或作廢使用。已開通的申請不能標記，回 400。

`/admin/trial` 的「申請記錄」（`GET /trial-signups`）列出最近 100 筆，沒有分頁。`TrialSignup` 的 `requestIp`、`verifySentCount`、`lastVerifySentAt` 不在畫面上。這個分頁以中文顯示狀態：`pending_verification` 等待驗證、`provisioned` 已開通、`failed` 失敗／已作廢（email 衝突與平台作廢都是 `failed`，原因見「備註」欄）。其他狀態顯示原值。

`updateTenantContract(tenantId, dates)` 不觸發任何試用生命週期行為。合約日期唯一的自動行為是上面的合約到期提醒。入口在 `/admin/tenants`，不在 `/admin/trial`。兩個日期都是選用的：傳 `undefined` 不動該欄、傳 `null` 清除、傳日期設值。更新後兩者都有值時，迄日必須不早於起日，否則回 422 `CONTRACT_DATE_INVALID`。這個檢查會合併資料庫現值比對，因此只傳其中一個日期也擋得住。

## 哪些操作會讓租戶脫離試用

`trialEndsAt` 不是 null 的租戶就是試用租戶。下列兩個操作讓租戶脫離試用，寫入的內容相同（`trial-admin.service.ts` 的 `TRIAL_EXIT_DATA`）：清空 `trialEndsAt` 與 `purgedAt`，並設 `isActive: true`。

| 操作 | 位置 |
| --- | --- |
| 轉正式 | `/admin/trial` 的「轉正式…」，`convertToPaid()` |
| 核准升級申請 | `/admin/plan-changes` 核准 `upgrade` 申請，`approveRequest()`。只有試用租戶會脫離試用，稽核的 payload 記錄 `trialExited` |

下列操作**不會**脫離試用：

- 核准 `token_topup` 申請。試用租戶加購之後，到期仍會被停用。
- 在 `/admin/tenants/:id` 改方案（`updateTenant()`）。頁面會提示這個租戶仍在試用中。

試用方案不能當成「轉正式」或升級申請的目標（`assertNotTrialPlan()`）。否則租戶留在試用方案、`trialEndsAt` 卻被清空，永遠不會到期。

試用到期被停用的租戶，與其他停用的租戶一樣：進站訊息（含網站聊天室）被丟棄，到期的群發不送出並標成 `failed`（`TENANT_DISABLED`），不寄滿意度問卷，成員登入回 403 `TENANT_DISABLED`。見[租戶管理](./TENANTS.md#停用租戶多久生效)。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 申請頁 `/trial`（`apps/web/src/app/trial/page.tsx`） | `POST /trial/signups`，`{ email, siteName }` | `email` 是 `type=email`，瀏覽器去掉頭尾空白。站台名稱欄位沒有 `maxLength`。`trial.enabled=false` 時顯示「目前暫不開放」。其他錯誤（含 400、429）都顯示「申請失敗，請稍後再試」 |
| 申請成功畫面的「重新寄送」 | `POST /trial/resend`，`{ email }` | 按下之後沒有任何回饋（HC-PLATFORM-TRIALS-07） |
| 信中的連結 → 驗證頁 `/trial/verify?token=`（`apps/web/src/app/trial/verify/page.tsx`） | `GET /trial/verify?token=` | 只讀，重新整理不會開通。過期與無效的連結顯示同一個畫面 |
| 驗證頁的表單：站台名稱可改、密碼輸入兩次 | `POST /trial/verify`，`{ token, password, siteName }` | 密碼欄位 `minLength=8`，前端另外比對兩次輸入。站台名稱 trim，`maxLength=100`。欄位錯誤顯示 `details.issues` 的第一則訊息 |
| `/admin/trial` 的「試用租戶」分頁 | `GET /trial-tenants` | 狀態見[清單上的狀態怎麼判定](#清單上的狀態怎麼判定)。已清除的列只有「復原」按鈕 |
| 列的「延長」→ `window.prompt` 輸入天數 | `PATCH /trial-tenants/:id/extend`，`{ days }` | 前端以 `parseInt()` 解析，輸入 `1.5` 送出 1，畫面不提示（HC-PLATFORM-TRIALS-09） |
| 列的「轉正式…」下拉 → 確認框 | `PATCH /trial-tenants/:id/convert`，`{ planSlug }` | 下拉寫死 `light`、`standard`、`professional`、`enterprise`，不讀 `/plans`（HC-PLATFORM-TRIALS-15） |
| 已清除的列的「復原」→ 確認框 | `PATCH /tenants/:id/restore` | 復原之後租戶仍是停用 |
| 「申請記錄」分頁的「重寄」 | `POST /trial-signups/:id/resend` | 只有等待驗證的申請有這個按鈕 |
| 「申請記錄」分頁的「作廢」→ 確認框 | `PATCH /trial-signups/:id/fail`，`{ reason }` | `reason` 固定是「平台手動作廢」 |
| 上面五個平台操作失敗時 | — | 延長、轉正式、復原、重寄、作廢都沒有錯誤處理，失敗時畫面沒有任何訊息（HC-PLATFORM-TRIALS-03） |
| 「政策設定」分頁 | `GET`、`PUT /settings/:key` | 見[平台設定的畫面怎麼呼叫 API](./SETTINGS.md#畫面怎麼呼叫-api)。勾「開放試用申請」就立即對外開放，沒有確認框；數字欄位離開就寫入，沒改值也寫（HC-PLATFORM-TRIALS-10） |

合約起訖日的入口不在本頁，在 `/admin/tenants`，見[租戶管理](./TENANTS.md#合約日期)。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
