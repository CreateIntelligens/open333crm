## ADDED Requirements

### Requirement: 試用租戶保留期屆滿軟刪

系統 MUST 提供排程，將「已停用（`isActive=false`）、`trialEndsAt` 已過且距今超過 `trial.dataRetentionDays` 天、且 `purgedAt` 為 null」的試用租戶標記為軟刪（設 `Tenant.purgedAt = now`）。軟刪 MUST 為標記行為——MUST NOT 執行任何 DELETE 或刪除該租戶的業務資料列。每次軟刪 MUST 寫入 `PlatformAuditLog`（系統動作，platformUserId 可為 null）。已軟刪（`purgedAt` 非 null）的租戶 MUST NOT 被重複軟刪（冪等）。

#### Scenario: 保留期屆滿的停用試用租戶被軟刪

- **GIVEN** 某試用租戶 `isActive=false`、`trialEndsAt` 為 40 天前、`trial.dataRetentionDays=30`、`purgedAt` 為 null
- **WHEN** 軟刪排程執行
- **THEN** 該租戶 `purgedAt` MUST 被設為現在時間，且 MUST 寫一筆 PlatformAuditLog；其業務資料（聯絡人、案件等）MUST 全部仍存在於 DB

#### Scenario: 保留期未屆滿不軟刪

- **GIVEN** 某停用試用租戶 `trialEndsAt` 為 10 天前、`dataRetentionDays=30`
- **WHEN** 排程執行
- **THEN** 該租戶 MUST NOT 被軟刪（`purgedAt` 維持 null）

#### Scenario: 仍啟用的租戶不軟刪

- **GIVEN** 某試用租戶 `isActive=true`（未到期或已延長）
- **WHEN** 排程執行
- **THEN** 該租戶 MUST NOT 被軟刪，無論 trialEndsAt 為何

#### Scenario: 已軟刪不重複處理

- **GIVEN** 某租戶 `purgedAt` 已有值
- **WHEN** 排程再次執行
- **THEN** 該租戶 MUST NOT 被再次軟刪或再寫稽核

### Requirement: 軟刪租戶無法存取且可復原

已軟刪（`purgedAt` 非 null）的租戶 MUST 無法登入與收訊（與停用一致）。平台方 MUST 能查看租戶的軟刪狀態，並 MUST 能「復原」軟刪（清 `purgedAt` 為 null）。復原 MUST NOT 自動恢復服務啟用（`isActive`）——是否重新啟用由平台方另行操作。復原 MUST 寫入 `PlatformAuditLog`。

#### Scenario: 軟刪租戶無法登入

- **GIVEN** 某租戶 `purgedAt` 非 null（必然已 `isActive=false`）
- **WHEN** 該租戶的 agent 嘗試登入
- **THEN** 系統 MUST 拒絕登入（比照 `TENANT_DISABLED`）

#### Scenario: 平台復原軟刪租戶

- **GIVEN** 某租戶 `purgedAt` 非 null
- **WHEN** 平台 superuser 執行「復原」
- **THEN** `purgedAt` MUST 被清為 null、MUST 寫稽核；`isActive` MUST 維持 false（不自動啟用），業務資料因未曾真刪而完整可用

#### Scenario: 平台後台顯示軟刪狀態

- **WHEN** 平台 superuser 檢視租戶列表／試用管理
- **THEN** 已軟刪的租戶 MUST 明確顯示為「已清除」狀態並提供復原操作
