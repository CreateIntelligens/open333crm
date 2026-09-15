## ADDED Requirements

### Requirement: 平台管理員可開通新平台帳號，系統自動產生臨時密碼並要求首次登入強制改密碼
已登入的平台管理員 SHALL 能在平台後台建立新的 `PlatformUser` 帳號，僅需輸入 email、name；系統 SHALL 驗證 email 全域唯一，SHALL 自動產生一組高熵臨時密碼並雜湊儲存，新帳號 SHALL 標記 `mustChangePassword: true`。成功建立後 SHALL 寄送開通信（含登入網址、email、明文臨時密碼），並 SHALL 寫入 `PlatformAuditLog`（稽核紀錄本身不含明文密碼）。

#### Scenario: 成功開通新平台帳號
- **WHEN** 平台管理員在開通表單提交合法的 email、name
- **THEN** 系統建立新的 `PlatformUser`（`isActive: true`、`mustChangePassword: true`）、產生臨時密碼並寄送開通信（含明文臨時密碼）、寫入一筆 `PlatformAuditLog`（payload 不含明文密碼），回傳新帳號基本資料

#### Scenario: Email 重複時拒絕開通
- **WHEN** 平台管理員提交的 email 已存在於現有 `PlatformUser`
- **THEN** 系統回傳 409 衝突錯誤，不建立新帳號、不寄信、不寫入稽核

### Requirement: 帳號標記須改密碼時，除改密碼外的平台功能一律受阻
`PlatformUser.mustChangePassword` 為 `true` 時，該帳號登入後取得的 JWT SHALL 攜帶此旗標；系統 SHALL 拒絕該帳號存取「自助改密碼」以外的所有平台 API，直到改密碼成功、旗標清除為止。

#### Scenario: 標記須改密碼的帳號嘗試存取其他平台功能
- **WHEN** `mustChangePassword: true` 的帳號使用有效 JWT 呼叫非改密碼類的平台 API（例如取得租戶列表）
- **THEN** 系統回傳錯誤，拒絕存取

#### Scenario: 標記須改密碼的帳號可呼叫改密碼 API
- **WHEN** `mustChangePassword: true` 的帳號使用有效 JWT 呼叫自助改密碼 API 並提交正確舊密碼（即臨時密碼）與符合強度要求的新密碼
- **THEN** 系統更新密碼、將 `mustChangePassword` 清除為 `false`，該帳號之後可正常存取所有平台功能

### Requirement: 平台管理員可查詢平台帳號列表與詳細資料
已登入的平台管理員 SHALL 能取得所有平台帳號的列表（含 email、name、isActive、lastLoginAt、createdAt），以及單一帳號的詳細資料。

#### Scenario: 取得平台帳號列表
- **WHEN** 平台管理員呼叫平台帳號列表 API
- **THEN** 系統回傳所有 `PlatformUser` 的基本資料（不含 `passwordHash`、`resetTokenHash`）

#### Scenario: 取得單一平台帳號詳細資料
- **WHEN** 平台管理員呼叫指定 id 的平台帳號詳細資料 API
- **THEN** 系統回傳該帳號基本資料，若 id 不存在則回傳 404

### Requirement: 平台管理員可編輯平台帳號資料
已登入的平台管理員 SHALL 能修改其他（或自己的）平台帳號的 name、email；修改 email 時 SHALL 驗證全域唯一；成功後 SHALL 寫入 `PlatformAuditLog`。

#### Scenario: 成功編輯帳號資料
- **WHEN** 平台管理員提交合法的新 name 或新 email（未與他人衝突）
- **THEN** 系統更新該帳號資料，寫入一筆 `PlatformAuditLog`

#### Scenario: 編輯為重複 email 時拒絕
- **WHEN** 平台管理員提交的新 email 已被其他 `PlatformUser` 使用
- **THEN** 系統回傳 409 衝突錯誤，不更新資料

### Requirement: 平台管理員可停用／啟用平台帳號，且系統保留至少一個啟用帳號
已登入的平台管理員 SHALL 能將其他平台帳號設為停用（`isActive: false`）或重新啟用；系統 SHALL 拒絕會導致「啟用中平台帳號歸零」的停用操作，且 SHALL 拒絕平台管理員停用自己的帳號。成功的停用/啟用 SHALL 寫入 `PlatformAuditLog`。停用帳號 SHALL 無法登入平台後台，但帳號資料與稽核歷史保留（不做硬刪除）。

#### Scenario: 成功停用其他帳號
- **WHEN** 平台管理員停用一個非自己、且停用後仍有其他啟用中帳號存在的平台帳號
- **THEN** 系統將該帳號 `isActive` 設為 `false`，寫入一筆 `PlatformAuditLog`，該帳號後續登入 SHALL 被拒絕

#### Scenario: 拒絕停用最後一個啟用中帳號
- **WHEN** 平台管理員嘗試停用系統中唯一一個 `isActive: true` 的平台帳號
- **THEN** 系統回傳錯誤，拒絕此操作，該帳號維持啟用狀態

#### Scenario: 拒絕停用自己
- **WHEN** 平台管理員嘗試停用自己目前登入所使用的帳號
- **THEN** 系統回傳錯誤，拒絕此操作

#### Scenario: 成功重新啟用帳號
- **WHEN** 平台管理員將一個 `isActive: false` 的帳號重新啟用
- **THEN** 系統將該帳號 `isActive` 設為 `true`，寫入一筆 `PlatformAuditLog`，該帳號恢復可登入

### Requirement: 平台管理員可重寄開通信
已登入的平台管理員 SHALL 能對指定平台帳號重新寄送開通信；系統 SHALL 產生一組新的臨時密碼取代舊值、將 `mustChangePassword` 設回 `true`，開通信 SHALL 帶新的明文臨時密碼，成功後 SHALL 寫入 `PlatformAuditLog`（payload 不含明文密碼）。

#### Scenario: 成功重寄開通信
- **WHEN** 平台管理員對一個已存在的平台帳號觸發重寄開通信
- **THEN** 系統產生新臨時密碼並更新 `passwordHash`、設 `mustChangePassword: true`、重新寄送開通信（含新的明文臨時密碼），寫入一筆 `PlatformAuditLog`

### Requirement: 平台帳號詳細頁可查詢該帳號相關的稽核記錄
平台管理員 SHALL 能在帳號詳細頁查詢與該帳號相關的 `PlatformAuditLog` 操作記錄（例如該帳號被開通、編輯、停用/啟用、改密碼的歷史）。

#### Scenario: 查詢帳號稽核記錄
- **WHEN** 平台管理員開啟指定平台帳號的詳細頁
- **THEN** 系統回傳與該帳號相關的稽核記錄列表，依時間新到舊排序
