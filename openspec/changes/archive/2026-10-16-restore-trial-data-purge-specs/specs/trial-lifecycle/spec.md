## MODIFIED Requirements

### Requirement: 到期自動停用（資料保留）
排程發現 `trialEndsAt < now` 且租戶仍 active 時，MUST 將 `Tenant.isActive` 設為 false、寄到期通知信、寫 PlatformAuditLog。停用後 MUST 套用既有停用行為：登入回 `TENANT_DISABLED`、inbound 訊息被丟棄。租戶資料 MUST 保留不刪除。保留期滿時，`trial-data-purge` 的排程只標記 `purgedAt`，同樣不刪除資料。

#### Scenario: 到期停用
- **GIVEN** 某試用租戶 trialEndsAt 已過
- **WHEN** 排程執行
- **THEN** 該租戶 isActive MUST 為 false，其成員登入 MUST 收到 TENANT_DISABLED
- **AND** 其渠道 inbound 訊息 MUST 被丟棄且資料完整保留
