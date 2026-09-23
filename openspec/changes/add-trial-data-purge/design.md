## Context

現有試用生命週期（trial scheduler）：試用中 → `trialEndsAt` 到期 → `isActive=false`（停用：登入回 `TENANT_DISABLED`、inbound 訊息丟棄，但**資料完整保留**）。政策 `trial.dataRetentionDays` 已可設但無邏輯使用。

租戶狀態目前只有 `isActive`（true/false）。停用 = 可復原、資料在、只是登不進去。本 change 要在「停用」之後再加一層「保留期屆滿 → 軟刪」，且軟刪必須與停用是**不同語意**（停用是 trial 到期就發生；軟刪是停用後又過了保留期），因此需要獨立欄位，不能複用 `isActive`。

## Goals / Non-Goals

**Goals:**
- `trial.dataRetentionDays` 真正生效：試用租戶停用後超過保留天數即軟刪。
- 軟刪 = 標記（`purgedAt`），資料完整留在 DB、可復原。
- 平台方可查看軟刪狀態並復原。
- 軟刪租戶與停用一致無法登入/收訊。
- 對既有租戶零影響（`purgedAt` 為 null）。

**Non-Goals:**
- **不做硬刪**（真 DELETE 資料列或 cascade 刪除）——不可逆、風險高，本 change 明確排除；若日後要清 DB 空間另開 change。
- 不改動既有停用（`isActive`）行為與 trial 到期停用邏輯。
- 不做「自動硬刪的二階段」（軟刪 N 天後再硬刪）——同樣留待後續。
- 合約日期（contractStartDate/EndDate）不涉入——那是純記錄、無生命週期。

## Decisions

### 1. 用 `purgedAt DateTime?` 標記軟刪，與 isActive 分離
- `purgedAt = null`：未軟刪。`purgedAt = <時間>`：已於該時間軟刪。
- 為何獨立欄位而非 isActive：isActive 是「停用」（trial 到期即發生、也用於平台手動停用/啟用），語意不同；混用會讓「停用」與「已清除」無法區分、也無法記錄清除時間。
- 為何存時間戳而非 boolean：需要知道「何時清的」（稽核、復原判斷、未來若要二階段硬刪的計時基準）。

### 2. 軟刪掃描條件（trial scheduler 新增分支）
對每個租戶，當**全部成立**時軟刪：
- `trialEndsAt` 非 null（是試用租戶）
- `isActive = false`（已停用——即已過 trialEndsAt 被停用）
- `purgedAt = null`（尚未軟刪，冪等）
- `now - trialEndsAt >= dataRetentionDays 天`（保留期已屆滿）

動作：`purgedAt = now`，寫 PlatformAuditLog（platformUserId=null 表系統動作，比照現有到期停用稽核）。逐租戶 try/catch，單一失敗不影響其他。

### 3. 軟刪的存取語意 = 停用 + 隱藏
- 登入：軟刪租戶 MUST 與停用一樣被擋（`purgedAt` 非 null 或 isActive false 皆擋）。實作上因軟刪租戶必然已 `isActive=false`，現有登入擋停用的邏輯**已涵蓋**——不需改登入。但為語意清楚，可在登入錯誤訊息區分（選配，非必要）。
- 資料查詢：軟刪租戶的業務資料仍在 DB（軟刪只標記 Tenant），但因無人能登入該租戶、平台跨租戶查詢可選擇性排除 `purgedAt` 非 null 者。

### 4. 復原 = 清 `purgedAt`（+ 視需要恢復 isActive）
平台方可「復原」軟刪租戶：`purgedAt = null`。是否同時 `isActive=true` 由平台操作決定（復原資料 ≠ 自動恢復服務；預設只清 purgedAt，isActive 另由平台手動啟用或轉正式）。寫稽核。

### 5. dataRetentionDays 的計時基準 = trialEndsAt（非停用時間）
保留期從 `trialEndsAt`（到期日）起算，而非「停用執行時間」。因停用是 scheduler 每小時掃、執行時間≈到期時間，兩者差異小；用 trialEndsAt 更穩定可預測（不受 scheduler 執行延遲影響）。

## Risks / Trade-offs

- **軟刪 ≠ 真的省空間**：資料還在 DB，長期累積的軟刪租戶仍佔空間。這是軟刪換取「可復原」的刻意取捨；真正清空間需後續硬刪 change（本 change Non-Goal）。
- **誤軟刪風險**：掃描條件寫錯可能把不該清的租戶標記。緩解：條件嚴格（必須 isActive=false + trialEndsAt 過期 + 超過保留天數 + purgedAt null 四者皆備）、可復原、寫稽核、逐租戶 try/catch。因為是軟刪可復原，即使誤標也能救回。
- **保留期語意**：`dataRetentionDays` 從 trialEndsAt 算，若平台中途改 dataRetentionDays，會即時影響尚未軟刪的租戶的軟刪時機（縮短可能立刻觸發）。可接受（政策變更即時生效，符合其他 trial 政策的行為）。
- **與「復原後」的狀態**：復原只清 purgedAt、不自動啟用——避免「復原資料」被誤解為「恢復營運」。平台需另行決定是否啟用/轉正式。此取捨寫進 spec 避免混淆。
