## MODIFIED Requirements

### Requirement: 試用到期自動停用與資料保留

排程發現 `trialEndsAt < now` 且租戶仍 active 時，MUST 將 `Tenant.isActive` 設為 false、寄到期通知信、寫 `PlatformAuditLog`。停用後 MUST 套用既有停用行為：登入回 `TENANT_DISABLED`、inbound 訊息被丟棄。

到期停用後，租戶資料 MUST 先保留不刪除。當停用租戶的 `trialEndsAt` 距今超過 `trial.dataRetentionDays` 天時，MUST 由 `trial-data-purge` 能力以**軟刪（標記 `purgedAt`，不真刪資料）** 方式清除，且 MUST 可由平台方復原（詳見 `trial-data-purge` 規格）。`trial.dataRetentionDays` 由此真正生效，MUST NOT 僅儲存而不使用。

#### Scenario: 試用到期停用租戶

- **GIVEN** 某試用租戶 `trialEndsAt` 已過且仍 `isActive=true`
- **WHEN** 到期排程執行
- **THEN** 該租戶 MUST 被設 `isActive=false`、寄到期信、寫稽核；資料 MUST 保留

#### Scenario: 保留期屆滿後軟刪（dataRetentionDays 生效）

- **GIVEN** 某已停用試用租戶 `trialEndsAt` 距今已超過 `trial.dataRetentionDays` 天
- **WHEN** 軟刪排程執行
- **THEN** 該租戶 MUST 被軟刪（`purgedAt` 標記，資料不真刪、可復原），`trial.dataRetentionDays` MUST 實際影響此時機
