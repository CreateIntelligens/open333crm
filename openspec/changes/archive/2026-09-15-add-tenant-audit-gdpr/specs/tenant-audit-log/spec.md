## ADDED Requirements

### Requirement: 記錄租戶內敏感操作
系統 SHALL 為租戶內的敏感操作寫入一筆 `TenantAuditLog`，內容包含 `tenantId`、`actorId`（發起的 Agent，系統動作為 null）、`action`、`targetType`、`targetId`、`payload`（變更摘要）與 `createdAt`。稽核紀錄 SHALL 與平台層 `PlatformAuditLog` 分離，且每筆 MUST 綁定單一 `tenantId`。

需記錄的操作至少涵蓋：系統設定變更、成員與角色權限變更、聯絡人刪除/合併、案件刪除、渠道建立/刪除、行銷名單匯出，以及本能力自身的資料匯出與資料刪除請求。

#### Scenario: 刪除聯絡人時留痕
- **WHEN** 具權限的成員刪除或匿名化一個聯絡人
- **THEN** 系統寫入一筆 `TenantAuditLog`，`action` 為 `contact.delete`（或 `data.erasure.request`），`targetType=contact`、`targetId` 為該聯絡人 id、`actorId` 為操作者、`tenantId` 為當前租戶

#### Scenario: 修改角色權限時留痕
- **WHEN** 成員變更某角色的權限指派
- **THEN** 系統寫入一筆 `TenantAuditLog`，`action=role.permission.update`，`payload` 記錄變更摘要（受影響角色與權限異動），不含無關的敏感資料

#### Scenario: 系統動作以 null actor 記錄
- **WHEN** 由排程或系統背景流程觸發需稽核的動作
- **THEN** 系統寫入 `TenantAuditLog` 且 `actorId` 為 null，其餘欄位正常填寫

### Requirement: 稽核寫入為非阻斷側效
稽核寫入失敗 SHALL NOT 導致其所依附的主操作失敗。系統 MUST 將稽核寫入包在錯誤隔離中，寫入異常時僅記錄應用日誌，不回滾或中斷主操作。

#### Scenario: 稽核寫入失敗不影響主操作
- **WHEN** 主操作（如刪除聯絡人）成功，但稽核寫入因 DB 暫時故障而失敗
- **THEN** 主操作結果保留，系統記錄一筆錯誤日誌，且回傳給使用者的是主操作的成功結果

### Requirement: 租戶 ADMIN 可查詢稽核日誌
系統 SHALL 提供 API 讓具 `audit.view` 權限的成員查詢本租戶的 `TenantAuditLog`，支援分頁與依 `action`、`actorId`、日期區間篩選。查詢結果 MUST 僅包含當前租戶（`where` 帶 `tenantId`）的紀錄。

#### Scenario: 查詢本租戶稽核
- **WHEN** 具 `audit.view` 權限的成員請求稽核列表並帶 action 與日期篩選
- **THEN** 系統回傳僅屬於該成員所在租戶、符合篩選條件的分頁結果

#### Scenario: 無權限被拒
- **WHEN** 不具 `audit.view` 權限的成員請求稽核列表
- **THEN** 系統回傳 403 且不洩漏任何稽核內容

#### Scenario: 跨租戶隔離
- **WHEN** A 租戶成員查詢稽核
- **THEN** 系統回傳的紀錄不包含任何 B 租戶的 `TenantAuditLog`
