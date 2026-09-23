# 試用管理

試用租戶從申請到期滿的完整生命週期，以及平台可以做的介入。

- **資料來源**：`apps/api/src/modules/platform/trial-admin.service.ts`、`apps/api/src/modules/trial/*`
- **核對日期**：2026-09-23

## 誰能做什麼

外部使用者只能自助完成申請與信箱驗證，這兩步在 `trial` 模組。開通之後的所有生命週期操作，不是排程自動執行，就是平台人員逐筆操作。

| 動作 | 執行者 | 範圍 |
| --- | --- | --- |
| 申請、信箱驗證 | 外部使用者 | 自己這一筆 |
| 提醒、到期停用、保留期滿軟刪 | `apps/api` 的每小時排程 | 掃全部試用租戶 |
| 延長試用、轉正式方案、復原軟刪、記錄合約日期 | 平台人員在 `/admin/trial` | 指定的單一租戶 |
| 重寄驗證信、作廢申請 | 平台人員在 `/admin/trial` | 指定的單一筆申請 |

## 生命週期

```text
申請        外部填表 → trial_signups（pending_verification）→ 寄驗證信
  ↓
驗證        點信中連結 → provisionTenant 建租戶
            trialEndsAt = 現在 + durationDays
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

排程是 `apps/api/src/modules/trial/trial.scheduler.ts` 的 `runTrialLifecycle()`，啟動時跑一次，之後每小時一次。逐租戶 try/catch，單一租戶失敗不影響其他租戶。

它掃兩輪，條件不同：

| 輪次 | 條件 | 做的事 |
| --- | --- | --- |
| 第一輪 | `trialEndsAt` 不為 null **且仍啟用** | 到期就停用，否則看要不要寄提醒 |
| 第二輪 | `trialEndsAt` 不為 null、**已停用**、`purgedAt` 為 null | 距 `trialEndsAt` 超過保留天數就標記軟刪 |

軟刪的計算基準是 `trialEndsAt`，不是停用當下的時間。平台提前手動停用一個試用租戶，不會讓保留期提早開始。

提醒的檔位判定會補寄：它找的是「小於等於剩餘天數、而且還沒寄過」的最大檔位。系統停機跨越某個檔位時，下一輪仍會補上那一封，不會整個跳過。

排程的停用與軟刪各寫一筆稽核（`tenant.trial.expire`、`tenant.trial.purge`），`platformUserId` 留空代表系統動作。稽核寫入失敗只被吞掉，不會擋下停用或軟刪。

## 政策參數

試用天數、提醒檔位、保留天數都不是寫死的。它們存在 `PlatformSetting` 的 `trial.*` 鍵，平台後台可改，程式預設值寫在 `trial-policy.service.ts` 的 `DEFAULTS`：

| 參數 | 預設值 | 作用 |
| --- | --- | --- |
| `trial.enabled` | `false` | 整個試用功能的開關。**預設關閉**，要平台後台手動開啟 |
| `trial.durationDays` | 14 | 開通時 `trialEndsAt` 距今幾天 |
| `trial.reminderDaysBefore` | `[7, 1]` | 剩餘幾天時寄提醒 |
| `trial.verifyTokenTtlHours` | 24 | 驗證信連結的有效時數 |
| `trial.dataRetentionDays` | 30 | 到期後幾天標記軟刪 |
| `trial.planSlug` | `trial` | 開通時綁定的方案 |

## 清單上的狀態怎麼判定

`/admin/trial` 的試用租戶清單只列 `trialEndsAt` 不為 null 的租戶，依到期日由近到遠排序。狀態是算出來的，不是欄位，判定依序取第一個成立的：

| 狀態 | 條件 |
| --- | --- |
| 已清除 | `purgedAt` 有值 |
| 已停用 | `isActive` 為假 |
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

延長同時把 `isActive` 設為真，因此已到期停用的租戶會恢復；並清空 `trialRemindersSent`，讓新週期重新發提醒。

`convertToPaid(tenantId, planSlug)` 改 `planId`、把 `trialEndsAt` 清成 `null`、確保 `isActive` 為真。清空 `trialEndsAt` 是脫離試用的關鍵：排程只掃 `trialEndsAt` 不為 null 的租戶。目標方案是 `trial` 時擋下。

`restorePurgedTenant(tenantId)` 清除 `purgedAt`，但**不動 `isActive`**，租戶維持停用。業務資料本來就是軟刪，復原只是讓平台方重新看到它不是「已清除」狀態。

`resendVerification(signupId)` 重寄驗證信，而且**刻意繞過使用者端的重寄節流**，避免平台人員的操作靜默失敗。只有 `pending_verification` 的申請能重寄，其餘回 400。

`markSignupFailed(signupId, reason)` 手動把申請標記為 `failed` 並清掉驗證 token，供排查或作廢使用。已開通的申請不能標記，回 400。

`updateTenantContract(tenantId, dates)` 只是記錄，不觸發任何自動生命週期行為。兩個日期都是選用的：傳 `undefined` 不動該欄、傳 `null` 清除、傳日期設值。更新後兩者都有值時，迄日必須不早於起日，否則回 422 `CONTRACT_DATE_INVALID`。這個檢查會合併資料庫現值比對，因此只傳其中一個日期也擋得住。

## 升級的另一條路徑會留下問題

試用租戶也可以走 `/api/v1/plan-change` 申請升級，由平台在 `/admin/plan-changes` 核准。這條路徑只改 `planId`，**不會清空 `trialEndsAt`**，租戶因此仍在排程的掃描範圍內，到了原本的到期日照樣被停用。詳見 `../../system/AUDIT.md` 的 TRIAL-01。

要讓租戶真正脫離試用，目前只能走 `/admin/trial` 的轉正式方案。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
