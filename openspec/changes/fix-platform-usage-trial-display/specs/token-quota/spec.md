## MODIFIED Requirements

### Requirement: 本月 AI 用量的計數
系統 SHALL 以 Redis 計數器記錄每個租戶本月的 AI token 用量。月份 SHALL 依台灣時間（`Asia/Taipei`）計算。計數器的 key 是 `aiquota:{tenantId}:{YYYY-MM}:tpe`，在台灣時間下個月 1 日 0 時過期。系統 SHALL NOT 讀取依 UTC 月份計算的舊計數器 `aiquota:{tenantId}:{YYYY-MM}`。

只有成功、而且 `keySource` 是 `platform` 的呼叫會累加，累加量是這次呼叫的 totalTokens。Ollama 的呼叫也是 `platform`，所以也會累加。

計數器不存在時，系統 SHALL 以本月（台灣時間 1 日 0 時起）`AiUsage` 中成功、`keySource` 是 `platform` 的 totalTokens 加總建立計數器。Redis 無法使用時，系統 SHALL 改用同一個加總判斷本月用量。

#### Scenario: 成功的呼叫累加用量
- **GIVEN** 租戶本月的計數器是 400000
- **WHEN** 一次使用平台金鑰的呼叫成功，totalTokens 是 1500
- **THEN** 計數器變成 401500

#### Scenario: 自備金鑰與失敗的呼叫不累加
- **WHEN** 一次使用租戶自備金鑰（`keySource` 是 `byok`）的呼叫成功，或一次使用平台金鑰的呼叫失敗
- **THEN** 計數器不變

#### Scenario: 計數器不存在時從 AiUsage 建立
- **GIVEN** Redis 沒有租戶本月的計數器
- **AND** 本月的 `AiUsage` 有一筆平台金鑰的成功呼叫 3000 tokens、一筆自備金鑰的成功呼叫 5000 tokens、一筆平台金鑰的失敗呼叫
- **WHEN** 系統讀取租戶本月的用量
- **THEN** 本月用量是 3000，Redis 的計數器也是 3000

#### Scenario: Redis 無法使用時改用資料庫的加總
- **GIVEN** Redis 無法連線，本月 `AiUsage` 中平台金鑰的成功呼叫加總是 3000
- **WHEN** 系統讀取租戶本月的用量
- **THEN** 本月用量是 3000

#### Scenario: 每個月重新計數
- **GIVEN** 租戶 2026-08 的計數器是 950000
- **WHEN** 時間進入台灣時間 2026-09-01 0 時（UTC 2026-08-31 16 時），系統讀取本月用量
- **THEN** 系統讀取 `aiquota:{tenantId}:2026-09:tpe`，不採用 2026-08 的計數

#### Scenario: 台灣月初凌晨的用量算在新月份
- **GIVEN** 現在是台灣時間 2026-09-01 01:00，Redis 沒有計數器
- **AND** `AiUsage` 有一筆台灣時間 2026-09-01 00:30 的平台金鑰成功呼叫 3000 tokens，一筆台灣時間 2026-08-31 23:00 的 9000 tokens
- **WHEN** 系統讀取租戶本月的用量
- **THEN** 本月用量是 3000，`aiquota:{tenantId}:2026-09:tpe` 是 3000

#### Scenario: 計數器在台灣下個月 1 日 0 時過期
- **WHEN** 系統在台灣時間 2026-09-30 23:00 建立計數器
- **THEN** 計數器在台灣時間 2026-10-01 0 時（UTC 2026-09-30 16 時）過期

#### Scenario: 改用台灣月份後從 AiUsage 重建計數器
- **GIVEN** Redis 有舊的 UTC 月份計數器 `aiquota:{tenantId}:2026-09` 是 1000，沒有 `aiquota:{tenantId}:2026-09:tpe`
- **AND** 台灣 2026-09 的 `AiUsage` 平台金鑰成功呼叫加總是 3000，其中 2000 在台灣時間 9 月 1 日 0 時到 8 時之間
- **WHEN** 系統讀取租戶本月的用量
- **THEN** 本月用量是 3000，不採用舊計數器的 1000
