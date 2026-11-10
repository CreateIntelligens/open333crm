## Context

試用到期流程在 `apps/api/src/modules/trial/trial.scheduler.ts`：每小時執行，`trialRemindersSent` 記錄寄過的檔位，
以「讀取時的值」做條件更新認領，認領成功才寄信。檔位存在平台設定 `trial.reminderDaysBefore`（`trial-policy.service.ts`）。
合約提醒沿用同一套做法，差別是收件人是平台帳號，不是租戶 ADMIN。

## Goals / Non-Goals

**Goals**：列表標示到期狀態並可排序；到期前寄提醒信給平台帳號；同一檔位只寄一次；迄日修改後重新計算。

**Non-Goals**：合約到期自動停用或寬限期（需要產品決定）；替通用設定端點的其他鍵加型別（AUDIT TRIAL-02 的整體修正）。

## Decisions

### D1 剩餘天數以台灣日曆日計算

`contractEndDate` 由 date input 送出，存成該日的 UTC 00:00。剩餘天數 =「迄日的日期」減「台灣時區今天的日期」，單位是天。
迄日當天剩 0 天，迄日隔天起是負數（已過期）。這樣排程與列表看到的天數一致，不會因為寄信的時間點早晚差一天。
列表在瀏覽器以本地日期計算（平台人員都在台灣）。

### D2 檔位選擇：最小的「剩餘天數 ≤ 檔位」，並把較大的檔位一起標記

試用的做法是挑最大的未寄檔位，剩 5 天才設定合約時，第一期寄 30 天檔、下一期再寄 7 天檔，一小時內收到兩封。
合約改成：找出所有 `剩餘天數 ≤ m` 的檔位中最小的一個；它還沒寄過時寄一封，並把它與所有比它大的檔位一起寫入
`contractRemindersSent`。剩 5 天時只寄一封（7 天檔），之後剩 1 天再寄 1 天檔。迄日當天（剩 0 天）仍可補寄 1 天檔；
已過期不寄。

### D3 冪等：條件更新認領

認領的條件是讀到的 `contractEndDate` 與 `contractRemindersSent`，加上 `isActive=true`。兩期重疊或平台人員在讀取後
修改迄日、停用租戶時，條件不成立，這一筆略過。先認領再寄信；寄信失敗只記 log（與試用相同，`safeSend`）。

### D4 修改迄日時清空標記

`updateTenantContract()` 在送出的 `contractEndDate` 與現值不同時，同一個 update 寫入 `contractRemindersSent: []`。
只改起日、或送出相同迄日時不清空，避免重寄。

### D5 收件人

所有 `platform_users.isActive=true` 的帳號，每人一封。沒有啟用中的平台帳號時仍認領（不重試），記 warn log。

### D6 排程與連線

`setupContractReminderScheduler()` 每小時一次、`withoutOverlapping` 30 分鐘，與試用相同；在 `index.ts` 以 `prismaAdmin`
接線（平台層跨租戶，AGENTS.md 允許）。

### D7 提醒天數的編輯畫面與寫入驗證

設定卡放在 `/admin/tenants`：合約日期在這一頁編輯、到期標籤也在這一頁，營運人員不必到試用管理頁找合約設定。
欄位只在按「儲存」時送出，不學 `/admin/trial` 失焦即存（AUDIT TRIAL-02 記錄的誤觸問題）。

通用的 `PUT /settings/:key` 不檢查型別（TRIAL-02）。這次不改通用端點的結構，只在路由對 `contract.reminderDaysBefore`
套用 `parseContractReminderDays()`：必須是 1 到 365 的整數組成的非空陣列，去重、由大到小後存入；不合法回 400
`VALIDATION_ERROR`，不改存預設值。上限 365 是為了擋下打錯的值（例如多打一個 0），一年以上的提醒沒有意義。
前端以 `parseReminderDaysInput()` 套用同一套規則，即時顯示原因。讀取端與寫入端共用正規化，舊資料若不合法仍退回預設值。

## Risks / Trade-offs

- 平台帳號多時每個租戶每檔寄多封信；平台帳號數量少，可以接受。
- 已過期的合約不再提醒，只靠列表標示。是否到期後持續提醒或自動停用，留給產品決定。
