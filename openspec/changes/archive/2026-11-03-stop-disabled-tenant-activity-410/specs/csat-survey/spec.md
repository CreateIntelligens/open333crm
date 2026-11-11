## ADDED Requirements

### Requirement: 停用租戶不寄出滿意度問卷

寄送滿意度問卷的排程 SHALL 只處理啟用中租戶的工單。租戶停用（含試用到期自動停用）時，系統 SHALL NOT 寫入工單的 `csatSentAt`，SHALL NOT 在對話中建立問卷訊息，SHALL NOT 把問卷送到客人的渠道。

#### Scenario: 停用租戶的工單到了寄送時間

- **WHEN** 租戶已停用，寄送滿意度問卷的排程遇到該租戶一張狀態是 `RESOLVED`、沒有 `csatSentAt`、有對話、已過寄送時間的工單
- **THEN** 這張工單的 `csatSentAt` 維持空值，對話中沒有問卷訊息
