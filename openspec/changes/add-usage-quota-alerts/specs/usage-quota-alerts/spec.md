## ADDED Requirements

### Requirement: 跨越用量門檻時發送告警
系統 SHALL 在租戶當月 AI token 用量（僅計入 `keySource='platform'` 的成功呼叫）**剛跨越**設定門檻時，對該租戶所有啟用中（`isActive=true`）的 ADMIN 發送告警。門檻為當月有效上限（`getEffectiveLimit(..., 'monthlyTokens')`）的固定百分比：**warning = 80%**、**critical = 100%（已達上限／耗盡）**。「剛跨越」定義為累加前總量 `before` 與累加後總量 `after` 滿足 `before < 門檻token && after >= 門檻token`。

#### Scenario: 用量首次跨越 80%
- **WHEN** 某租戶當月 platform token 累加使總量從低於上限 80% 上升到大於等於 80%（且尚未達 100%）
- **THEN** 系統對該租戶所有啟用中 ADMIN 各發送一則 `usage_quota_warning` 站內通知與一封 warning email

#### Scenario: 用量跨越 100%（達上限）
- **WHEN** 某租戶當月 platform token 累加使總量從低於上限上升到大於等於上限（100%）
- **THEN** 系統對該租戶所有啟用中 ADMIN 各發送一則 `usage_quota_critical` 站內通知與一封 critical email

#### Scenario: 單次呼叫同時跨越 80% 與 100%
- **WHEN** 單次 token 累加使總量一次從低於 80% 跳到大於等於 100%
- **THEN** 系統同時發送 warning 與 critical 兩種告警（各一輪，各只一次）

### Requirement: 告警冪等（每租戶每月每門檻至多一次）
系統 SHALL 保證同一租戶、同一自然月（UTC，對齊計數器 `YYYY-MM`）、同一門檻（warning／critical）的告警**至多發送一次**。重複跨越、月中程序重啟、以及並發累加皆 MUST NOT 造成同門檻重複發送。冪等狀態 SHALL 於每月月初自動重置，使新月份可重新告警。

#### Scenario: 同月重複跨越同門檻不重發
- **WHEN** 某租戶當月已發過 warning 告警，之後又有多次累加使總量持續高於 80%
- **THEN** 系統 MUST NOT 再次發送該月的 warning 告警

#### Scenario: 並發累加同時跨越同門檻
- **WHEN** 兩個並發的 token 累加同時偵測到剛跨越同一門檻
- **THEN** 系統 SHALL 僅發送一次該門檻告警（原子搶佔冪等旗標，敗者不發）

#### Scenario: 進入新月份後重置
- **WHEN** 跨月後租戶在新月份再次跨越 80%
- **THEN** 系統 SHALL 於新月份重新發送一次 warning 告警（不受上月已發影響）

### Requirement: 告警範圍限制（platform-only、排除 BYOK 與無上限）
系統 SHALL 僅對「有有效 `monthlyTokens` 上限」且用量來自平台金鑰（`keySource='platform'`）的租戶觸發告警。對 BYOK 租戶（`keySource='byok'`，成本自付、不計額度）與**無上限**（`getEffectiveLimit` 回 `null`）的租戶，系統 MUST NOT 發送任何用量門檻告警。

#### Scenario: 無上限租戶不告警
- **WHEN** 某租戶的有效 `monthlyTokens` 上限為 null（無上限）且大量使用 AI
- **THEN** 系統 MUST NOT 發送任何用量門檻告警

#### Scenario: BYOK 用量不觸發告警
- **WHEN** 某租戶以自備金鑰（`keySource='byok'`）產生 AI 用量
- **THEN** 該用量不計入月額度計數器，系統 MUST NOT 因此觸發任何告警

### Requirement: 告警通知內容與管道
告警 SHALL 同時透過**站內通知（Notification）**與 **email** 送達。站內通知類型 SHALL 為 `usage_quota_warning`（80%）或 `usage_quota_critical`（100%），並包含可導向用量／方案頁的 `clickUrl`。Email SHALL 標示租戶站台名稱、當月已用與上限 token 概況、以及對應強調樣式（warning 琥珀色、critical 紅色）；critical email SHALL 說明 AI 自動回覆已暫停而真人回覆不受影響。所有嵌入 email 的使用者可控字串 SHALL 經 HTML 轉義。

#### Scenario: 站內與 email 同時送達每位 ADMIN
- **WHEN** 觸發任一門檻告警且該租戶有多位啟用中 ADMIN
- **THEN** 每位啟用中 ADMIN 皆收到一則對應類型的站內通知與一封對應主旨／樣式的 email

#### Scenario: critical email 說明服務影響
- **WHEN** 發送 critical（100%）email
- **THEN** email 內文 SHALL 告知 AI 自動回覆將暫停、真人客服不受影響，並提供升級／查看用量的行動指引

### Requirement: 告警不得影響 AI 回覆主流程
告警偵測與發送 SHALL 為非阻塞（fire-and-forget）。任何告警相關失敗（Redis 不可用、email 寄送失敗、通知入列失敗）MUST NOT 中斷或延遲 AI 回覆的產生，僅記錄日誌。既有 token 硬擋（`PLAN_LIMIT_EXCEEDED`）行為 MUST NOT 因本告警機制改變。

#### Scenario: Redis 不可用時跳過告警但不影響回覆
- **WHEN** token 累加時 Redis 不可用，無法可靠偵測門檻跨越
- **THEN** 系統跳過告警（僅記錄日誌），AI 回覆與 DB 兜底的硬擋判斷 SHALL 照常運作

#### Scenario: email 寄送失敗不拋出至回覆流程
- **WHEN** 告警 email 寄送失敗
- **THEN** 系統僅記錄錯誤日誌，AI 回覆流程 SHALL 不受影響、不拋出例外
