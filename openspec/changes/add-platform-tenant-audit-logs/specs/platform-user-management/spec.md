## MODIFIED Requirements

### Requirement: 平台帳號詳細頁可查詢該帳號相關的稽核記錄
平台管理員 SHALL 能在帳號詳細頁查詢與該帳號相關的 `PlatformAuditLog` 操作記錄（例如該帳號被開通、編輯、停用/啟用、改密碼的歷史，以及該帳號執行過的操作）。每筆紀錄 SHALL 附上 `platform-audit-log` 定義的操作者與對象名稱，頁面 SHALL 以共用的動作中文名稱與對象顯示規則呈現。

#### Scenario: 查詢帳號稽核記錄
- **WHEN** 平台管理員開啟指定平台帳號的詳細頁
- **THEN** 系統回傳與該帳號相關的稽核記錄列表，依時間新到舊排序

#### Scenario: 帳號稽核記錄附上對象名稱
- **WHEN** 平台帳號執行過 `tenant.disable`，平台管理員查詢該帳號的稽核記錄
- **THEN** 該筆紀錄的 `targetLabel` 為被停用租戶的名稱，頁面的對象欄顯示租戶名稱並連到該租戶詳細頁
