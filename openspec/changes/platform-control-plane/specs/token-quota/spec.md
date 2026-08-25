## ADDED Requirements

### Requirement: Token 月額度定義與覆寫
系統 SHALL 為每個租戶決定其 AI token 月額度：預設取自方案的 `Plan.limits.monthlyTokens`，並 MUST 允許平台於單一租戶上以 `tokenQuotaMonthly` 覆寫；當覆寫值為 null 時 MUST 回退使用方案預設值。

#### Scenario: 未覆寫時採用方案預設額度
- **GIVEN** 某租戶的 `tokenQuotaMonthly` 為 null
- **AND** 其方案 `Plan.limits.monthlyTokens` 為 1,000,000
- **WHEN** 系統解析該租戶的本月 token 額度
- **THEN** 回傳的有效額度 MUST 為 1,000,000

#### Scenario: 單租戶覆寫優先於方案預設
- **GIVEN** 某租戶的方案預設 `monthlyTokens` 為 1,000,000
- **AND** 平台已將該租戶 `tokenQuotaMonthly` 覆寫為 3,000,000
- **WHEN** 系統解析該租戶的本月 token 額度
- **THEN** 回傳的有效額度 MUST 為 3,000,000（覆寫值），而非方案預設值

#### Scenario: 平台調整覆寫值即時生效
- **GIVEN** 某租戶目前有效額度為 1,000,000
- **WHEN** 平台將該租戶 `tokenQuotaMonthly` 設為 2,000,000
- **THEN** 後續額度檢查 MUST 以 2,000,000 為上限
- **AND** 系統 MUST 同步校準 Redis 計數器對應的額度上限

### Requirement: Redis 即時月度用量計數器
系統 SHALL 以 Redis key `usage:tokens:{tenantId}:{yyyy-mm}` 作為租戶當月 token 用量的即時真相來源；key MUST 帶當前月份（yyyy-mm）以於自然月月初自動切換至新 key 達成重置，且該 key MUST 設定 TTL 作為兜底過期機制。

#### Scenario: 計數器 key 依當前月份組成
- **GIVEN** 租戶 ID 為 `t1` 且當前月份為 2026-08
- **WHEN** 系統存取該租戶本月用量計數器
- **THEN** 所使用的 Redis key MUST 為 `usage:tokens:t1:2026-08`

#### Scenario: 跨月自動重置為零
- **GIVEN** 租戶 `t1` 於 2026-08 的計數器值為 950,000
- **WHEN** 時間進入 2026-09 且系統讀取本月用量
- **THEN** 系統 MUST 改讀 key `usage:tokens:t1:2026-09`
- **AND** 該新 key 尚未累加時本月已用量 MUST 視為 0

#### Scenario: 計數器設定 TTL 兜底
- **WHEN** 系統首次對某月計數器 key 執行 INCRBY 建立該 key
- **THEN** 系統 MUST 為該 key 設定 TTL 作為兜底過期
- **AND** TTL MUST 足以涵蓋當月完整週期

### Requirement: AI 呼叫前額度硬擋
每次 AI 生成呼叫前，系統 SHALL 於共用入口（`llm.service.generateReply` 前）讀取 Redis 本月已用量並與有效額度比對；當已用量大於或等於額度時，系統 MUST 直接擋下且不呼叫 LLM，並回覆固定訊息「已達本月 AI 額度，請聯絡管理員加購」，同時記錄一筆被擋事件。

#### Scenario: 未達額度時正常呼叫 LLM
- **GIVEN** 租戶本月已用 token 為 400,000 且有效額度為 1,000,000
- **WHEN** 觸發一次 AI 生成呼叫
- **THEN** 系統 MUST 正常呼叫 LLM 產生回覆
- **AND** MUST 不回覆額度已滿的固定訊息

#### Scenario: 達到額度即硬擋且不呼叫 LLM
- **GIVEN** 租戶本月已用 token 為 1,000,000 且有效額度為 1,000,000
- **WHEN** 觸發一次 AI 生成呼叫
- **THEN** 系統 MUST 直接擋下且不呼叫 LLM
- **AND** MUST 回覆固定訊息「已達本月 AI 額度，請聯絡管理員加購」
- **AND** MUST 記錄一筆被擋事件供平台查詢誰卡額度

#### Scenario: 超過額度亦硬擋
- **GIVEN** 租戶本月已用 token 為 1,050,000 且有效額度為 1,000,000
- **WHEN** 觸發一次 AI 生成呼叫
- **THEN** 系統 MUST 直接擋下且不呼叫 LLM
- **AND** MUST 回覆固定的額度已滿提示訊息

#### Scenario: 硬擋涵蓋所有生成路徑
- **GIVEN** 租戶本月用量已達額度
- **WHEN** 經由 reply、summarize 或 kb-autoreply 任一路徑觸發 AI 生成
- **THEN** 每一條路徑 MUST 於共用入口一致被硬擋，不得繞過額度檢查

### Requirement: 硬擋涵蓋 Embedding（含 KB 搜尋）
達額度硬擋 MUST 涵蓋 embedding 呼叫（KB 向量搜尋所用），不只生成類。當租戶本月用量達額度時，embedding 呼叫亦 MUST 被擋。系統 MUST 在超量通知與租戶端明確告知「AI 與知識庫搜尋已暫停」，且真人客服流程（收件匣人工回覆）SHALL NOT 受此硬擋影響。

#### Scenario: 達額度時 embedding 一併被擋
- **GIVEN** 某租戶本月 token 用量已達額度且非 BYOK 例外
- **WHEN** 觸發一次 embedding 呼叫（如 KB 搜尋）
- **THEN** 系統 MUST 擋下該 embedding 呼叫，不呼叫模型

#### Scenario: 硬擋不影響真人人工回覆
- **GIVEN** 某租戶因達額度被硬擋（AI 與 embedding 皆停）
- **WHEN** 真人客服在收件匣手動回覆訊息
- **THEN** 人工回覆 MUST 正常運作，不受 AI 額度硬擋影響

### Requirement: 呼叫後累加用量計數
AI 生成呼叫成功後，系統 MUST 以本次 `totalTokens` 對 Redis 計數器執行 INCRBY 累加回本月用量，並同時寫入一列 AiUsage 作為持久對帳／統計／計費依據；Redis 為即時擋量真相、AiUsage 為持久對帳來源。

#### Scenario: 呼叫後累加 totalTokens
- **GIVEN** 租戶本月計數器目前為 400,000
- **WHEN** 一次 AI 呼叫完成且本次 `totalTokens` 為 1,500
- **THEN** 系統 MUST 對 Redis 計數器 INCRBY 1,500
- **AND** 累加後本月已用量 MUST 為 401,500

#### Scenario: 同時寫入 AiUsage 對帳列
- **WHEN** 一次 AI 呼叫完成並累加 Redis 計數器
- **THEN** 系統 MUST 同時寫入一列 AiUsage 記錄本次用量
- **AND** 該列 MUST 供事後對帳、統計與計費使用

#### Scenario: 被硬擋時不累加也不寫 AiUsage
- **GIVEN** 租戶本月用量已達額度導致呼叫被硬擋
- **WHEN** 該次 AI 生成因硬擋而未呼叫 LLM
- **THEN** 系統 MUST 不對 Redis 計數器 INCRBY
- **AND** MUST 不寫入代表實際 LLM 用量的 AiUsage 列

### Requirement: 分級用量預警
系統 SHALL 在租戶當月用量達額度 80% 時通知該租戶 admin「AI 額度已用 80%」，並在達 100% 時於硬擋的同時通知「已達額度，AI 已暫停，請加購」；所有通知 MUST 透過既有 notification 機制（站內鈴鐺／email）發送。

#### Scenario: 達 80% 觸發預警通知
- **GIVEN** 租戶有效額度為 1,000,000
- **WHEN** 本月累計用量首次達到或超過 800,000（80%）
- **THEN** 系統 MUST 透過既有 notification 機制通知該租戶 admin「AI 額度已用 80%」

#### Scenario: 達 100% 硬擋並發出暫停通知
- **GIVEN** 租戶有效額度為 1,000,000
- **WHEN** 本月累計用量達到 1,000,000（100%）
- **THEN** 系統 MUST 硬擋後續 AI 生成呼叫
- **AND** MUST 通知租戶 admin「已達額度，AI 已暫停，請加購」

#### Scenario: 預警不重複打擾
- **GIVEN** 租戶本月已於達 80% 時發過一次預警通知
- **WHEN** 用量在 80% 與 100% 之間持續累加但尚未達 100%
- **THEN** 系統 MUST 不重複發送 80% 預警通知

### Requirement: BYOK 租戶預設不受硬擋
對使用自帶金鑰（BYOK）且自付成本的租戶，系統 MUST 預設不套用平台 token 額度硬擋（因成本不歸平台）；惟系統 SHALL 提供可選開關，允許平台即使對 BYOK 租戶亦設定用量上限以防濫用。

#### Scenario: BYOK 租戶預設不被擋
- **GIVEN** 某租戶為 BYOK 且平台未開啟其用量上限開關
- **AND** 其當月用量已超過方案預設額度
- **WHEN** 觸發一次 AI 生成呼叫
- **THEN** 系統 MUST 正常呼叫 LLM，不因平台額度而硬擋

#### Scenario: 開啟 BYOK 上限開關後仍受擋
- **GIVEN** 某 BYOK 租戶已被平台開啟用量上限開關並設定上限
- **WHEN** 其當月用量達到該上限
- **THEN** 系統 MUST 對後續 AI 生成呼叫硬擋

#### Scenario: 平台額度租戶不受 BYOK 規則影響
- **GIVEN** 某租戶非 BYOK（使用平台金鑰）
- **AND** 其當月用量已達有效額度
- **WHEN** 觸發一次 AI 生成呼叫
- **THEN** 系統 MUST 依額度硬擋，不因 BYOK 例外而放行

### Requirement: 加購後即時恢復與額度校準
當平台核准加購／提高租戶 `tokenQuotaMonthly` 時，系統 MUST 校準 Redis 計數器對應的額度上限；若該租戶原本因達額度而被硬擋，系統 MUST 於額度提高後立即恢復其 AI 生成能力，無需等待月初重置。

#### Scenario: 加購後被擋租戶立即恢復
- **GIVEN** 租戶原有效額度 1,000,000 且本月已用 1,000,000 而處於被硬擋狀態
- **WHEN** 平台核准加購並將有效額度提高至 2,000,000
- **THEN** 系統 MUST 校準 Redis 計數器的額度上限為 2,000,000
- **AND** 後續 AI 生成呼叫 MUST 立即恢復正常，不再被硬擋

#### Scenario: 加購額度後預警閾值重新計算
- **GIVEN** 租戶有效額度由 1,000,000 提高為 2,000,000 且本月已用 1,000,000
- **WHEN** 系統重新評估用量占比
- **THEN** 已用占比 MUST 依新額度計為 50%
- **AND** MUST 不再處於 80% 或 100% 的預警／硬擋狀態
