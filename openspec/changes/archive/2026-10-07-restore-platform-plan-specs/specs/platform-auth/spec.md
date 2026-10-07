## MODIFIED Requirements

### Requirement: 平台操作稽核
平台管理員執行下列寫入操作時，API MUST 寫入一筆 `PlatformAuditLog`，內容含 platformUserId、action、targetType、targetId、payload 摘要與 createdAt：

- 租戶：開通、修改名稱或方案、啟用或停用、修改成員的 email、重寄成員的開通信、修改合約日期。
- 試用：延長、轉為付費方案、復原已軟刪的租戶、把試用申請標為失敗。
- 方案：更新。方案申請：核准、駁回。
- 平台帳號：開通、修改、啟用或停用、重寄開通信、自助改密碼。
- 平台設定：更新。

payload MUST NOT 含密碼，也 MUST NOT 含平台設定的值。

#### Scenario: 改 plan 留稽核
- **WHEN** superuser 更新 trial plan 的 limits
- **THEN** MUST 新增一筆 PlatformAuditLog，action 含 plan 更新與目標 plan id

#### Scenario: 開通租戶的稽核不含管理員密碼
- **WHEN** 平台管理員以 `POST /api/v1/platform/tenants` 開通租戶，body 含管理員的密碼
- **THEN** API 寫入 action 為 `tenant.provision` 的稽核，payload 只含方案的 slug 與租戶名稱
- **AND** 稽核的內容不含管理員的密碼

#### Scenario: 更新平台設定的稽核不含設定值
- **WHEN** 平台管理員以 `PUT /api/v1/platform/settings/:key` 更新平台設定
- **THEN** API 寫入 action 為 `setting.update`、targetId 為設定 key 的稽核
- **AND** 稽核的內容不含設定的值
