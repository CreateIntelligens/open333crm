## ADDED Requirements

### Requirement: 依群組顯示角色的權限

角色設定頁 SHALL 列出租戶的角色。成員選取一個角色後，頁面以 `GET /api/v1/roles/:id/permissions` 載入這個角色的權限，並依權限矩陣的 `group` 分組顯示。每個群組顯示已勾選的權限數與群組的權限總數，並且可以折疊。載入失敗時，頁面 SHALL 顯示錯誤訊息與重試按鈕，並停用所有勾選格。

頁面 SHALL 只採用目前選取角色的回應。角色的權限載入完成前，所有勾選格停用。

#### Scenario: 選取角色後依群組顯示權限
- **WHEN** 「客服作業」群組有 `inbox.view` 與 `inbox.reply`，成員選取只有 `inbox.view` 的角色
- **THEN** 「客服作業」群組顯示這兩個權限，`inbox.view` 已勾選，`inbox.reply` 未勾選，群組顯示「已開 1/2」

#### Scenario: 折疊群組
- **WHEN** 成員點擊「客服作業」群組的標題
- **THEN** 頁面不再顯示這個群組的權限，群組的標題仍然顯示

#### Scenario: 角色的權限載入失敗
- **WHEN** `GET /api/v1/roles/:id/permissions` 失敗
- **THEN** 頁面顯示載入失敗的訊息與「重試」按鈕，所有勾選格都停用

#### Scenario: 權限載入完成前不能勾選
- **WHEN** 成員選取角色，`GET /api/v1/roles/:id/permissions` 還沒有回應
- **THEN** 所有勾選格都停用

#### Scenario: 快速切換角色時只採用目前角色的回應
- **WHEN** 成員選取角色 A，A 的權限還沒有回應時改選角色 B，B 的回應先到，A 的回應後到
- **THEN** 頁面顯示 B 的權限；成員勾選一個權限後按「儲存變更」，請求送到角色 B，`permissions` 是 B 的權限加上這個權限

### Requirement: 勾選時處理前置權限

成員勾選一個權限時，頁面 SHALL 一併勾選這個權限的前置權限（`dependsOn`）。前置權限原本沒有勾選、因此被一併勾選時，頁面在這個前置權限旁邊顯示「自動開啟」標籤，並說明是哪個權限需要這個前置權限。

成員取消勾選一個權限後，因這個權限而自動開啟的前置權限維持勾選，但不再顯示「自動開啟」標籤。

成員取消勾選一個權限時，如果其他已勾選的權限以它為前置權限，頁面 SHALL 先列出這些權限並要求確認。成員確認後，頁面一併取消勾選這些權限。成員不確認時，頁面不做任何變更。

群組的「全開」與「全關」SHALL 依同樣的規則處理前置權限與相依權限，包括其他群組的權限。

#### Scenario: 勾選權限時一併勾選前置權限
- **WHEN** `inbox.view` 與 `inbox.reply` 都未勾選，成員勾選 `inbox.reply`
- **THEN** `inbox.view` 也被勾選，旁邊顯示「自動開啟」標籤，標籤說明「回覆對話」需要它

#### Scenario: 前置權限原本已勾選時不顯示自動開啟
- **WHEN** `inbox.view` 已勾選，成員勾選 `inbox.reply`
- **THEN** `inbox.view` 旁邊不顯示「自動開啟」標籤

#### Scenario: 取消勾選需要它的權限後不再顯示自動開啟
- **WHEN** 成員勾選 `inbox.reply`，`inbox.view` 因此自動開啟，成員再取消勾選 `inbox.reply`
- **THEN** `inbox.view` 維持勾選，旁邊不顯示「自動開啟」標籤

#### Scenario: 取消勾選前置權限時確認相依的權限
- **WHEN** `inbox.view` 與 `inbox.reply` 都已勾選，成員取消勾選 `inbox.view`，並在確認訊息選擇確定
- **THEN** 確認訊息列出「回覆對話」，`inbox.view` 與 `inbox.reply` 都取消勾選

#### Scenario: 不確認時不變更
- **WHEN** `inbox.view` 與 `inbox.reply` 都已勾選，成員取消勾選 `inbox.view`，並在確認訊息選擇取消
- **THEN** `inbox.view` 與 `inbox.reply` 都維持勾選

#### Scenario: 群組全關時一併取消其他群組的相依權限
- **WHEN** 角色有 `contact.view`、`identity.review` 與 `data.erase`，成員按「聯絡人」群組的「全關」，並在確認訊息選擇確定
- **THEN** 確認訊息列出「審核識別建議」與「刪除聯絡人資料」，這三個權限都取消勾選

#### Scenario: 群組全開時一併勾選其他群組的前置權限
- **WHEN** 角色沒有任何權限，成員按「自動化」群組的「全開」
- **THEN** 「聯絡人」群組的 `contact.view` 也被勾選，旁邊顯示「自動開啟」標籤

### Requirement: 隱含權限只顯示說明

有隱含權限（`implies`）的權限 SHALL 在名稱旁顯示資訊圖示。圖示的說明列出隱含權限的名稱，並說明系統會自動處理。勾選這個權限時，頁面不勾選它的隱含權限，也不為隱含關係另外顯示勾選格。

#### Scenario: 指派案件顯示隱含權限的說明
- **WHEN** 頁面顯示 `case.assign`，它隱含 `agent.view`
- **THEN** `case.assign` 的名稱旁有資訊圖示，說明是「啟用時一併需要「檢視成員」，系統自動處理」

#### Scenario: 勾選時不勾選隱含權限
- **WHEN** 角色沒有 `agent.view`，成員勾選 `case.assign`
- **THEN** `agent.view` 維持未勾選

### Requirement: admin 角色的內建鎖定

成員選取 admin 系統角色時，有 `adminLock` 的權限與這些權限的前置權限標示「內建鎖定」。這些權限已勾選時 SHALL 不能取消勾選，群組的「全關」SHALL 略過這些權限。這些權限未勾選時，成員 SHALL 可以勾選，群組的「全開」也會勾選這些權限。例如新增權限碼後，租戶的 admin 角色還沒有更新，就會缺少新的內建鎖定權限。

頁面不預先停用其他會被後端拒絕的變更，例如授予編輯者自己沒有的權限，或移除編輯者自己角色的 `role.manage`。後端拒絕時，頁面依「變更暫存到按下儲存」顯示錯誤。

#### Scenario: admin 角色的內建鎖定權限不能取消勾選
- **WHEN** 成員選取擁有所有權限的 admin 系統角色
- **THEN** `agent.manage`、`role.manage`、`agent.view` 與 `role.view` 的勾選格已勾選、停用，並標示「內建鎖定」

#### Scenario: admin 角色缺少內建鎖定的權限時可以補回
- **WHEN** 成員選取 admin 系統角色，這個角色沒有 `role.manage`
- **THEN** `role.manage` 的勾選格可以操作；成員勾選後，勾選格變成已勾選、停用

#### Scenario: 全關略過內建鎖定的權限
- **WHEN** 成員選取 admin 系統角色，按「人員與權限」群組的「全關」
- **THEN** `agent.manage`、`role.manage`、`agent.view` 與 `role.view` 維持勾選，這個群組的其他權限都取消勾選

#### Scenario: admin 以外的角色沒有內建鎖定
- **WHEN** 成員選取 admin 以外的角色
- **THEN** `role.manage` 的勾選格可以操作，不標示「內建鎖定」

### Requirement: 變更暫存到按下儲存

勾選與取消勾選 SHALL 只改變頁面上的草稿，不送出請求。有未儲存的變更時，頁面顯示變更的數量、「放棄」與「儲存變更」。

成員按「儲存變更」時，頁面以 `PUT /api/v1/roles/:id/permissions` 送出草稿的完整權限清單。成功時，頁面顯示「已儲存」。失敗時，頁面顯示後端回應的錯誤訊息，並保留草稿。

有未儲存的變更時，成員切換角色前 SHALL 先確認。

#### Scenario: 勾選不送出請求
- **WHEN** 成員勾選兩個未勾選、也沒有前置權限的權限
- **THEN** 頁面沒有送出 `PUT /api/v1/roles/:id/permissions`，並顯示「未儲存 2 項變更」

#### Scenario: 放棄變更
- **WHEN** 有未儲存的變更，成員按「放棄」
- **THEN** 勾選狀態回到載入時的狀態，未儲存變更的提示消失

#### Scenario: 儲存成功
- **WHEN** 角色有 `inbox.view`，成員勾選 `inbox.reply` 後按「儲存變更」，請求成功
- **THEN** 請求的 `permissions` 是 `inbox.view` 與 `inbox.reply`，頁面顯示「已儲存」

#### Scenario: 儲存失敗時保留草稿
- **WHEN** 成員按「儲存變更」，後端回 403，`error.message` 是「不可授予你自己沒有的權限」
- **THEN** 頁面顯示「不可授予你自己沒有的權限」，勾選狀態與未儲存變更的提示都保留

#### Scenario: 有未儲存的變更時切換角色
- **WHEN** 有未儲存的變更，成員點選另一個角色，並在確認訊息選擇取消
- **THEN** 頁面維持在原本的角色，草稿保留

### Requirement: 沒有 role.manage 時唯讀

成員沒有 `role.manage` 時，角色設定頁 SHALL 以唯讀顯示：所有勾選格停用，不顯示群組的「全開」「全關」、「新增角色」、改名與刪除，並說明這一頁是唯讀。

成員沒有 `role.view` 時，設定頁的「角色與權限」分頁 SHALL 顯示沒有權限的訊息，不顯示角色設定頁。

#### Scenario: 只有 role.view 時唯讀
- **WHEN** 成員有 `role.view`、沒有 `role.manage`，開啟角色設定頁
- **THEN** 所有勾選格都停用，頁面不顯示「全開」「全關」與「新增角色」，並說明這一頁是唯讀

#### Scenario: 沒有 role.view 時不顯示角色設定頁
- **WHEN** 成員沒有 `role.view`，開啟設定頁的「角色與權限」分頁
- **THEN** 頁面顯示「你沒有查看此設定的權限。」，不載入角色清單
