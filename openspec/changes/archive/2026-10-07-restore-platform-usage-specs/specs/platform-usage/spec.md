## ADDED Requirements

### Requirement: 平台用量查詢
平台 API SHALL 提供下列用量查詢，只有平台管理員可以呼叫（見 `platform-auth`）：

- `GET /api/v1/platform/usage/overview`：所有租戶的 token 總量、成本總額、呼叫次數、有用量的租戶數，以及依 provider 的分布。
- `GET /api/v1/platform/usage/tenants`：依 token 用量由多到少排列的前 50 個租戶，含租戶名稱與方案名稱。
- `GET /api/v1/platform/usage/tenants/:tenantId`：一個租戶每日的 token、成本與呼叫次數，以及依呼叫來源（`AiUsage.feature`）的分布。

查詢 SHALL 只計算成功的呼叫。查詢期間預設是最近 30 天，可以用 `from` 與 `to` 指定。成本在資料庫以 Decimal 加總，以字串回傳。

#### Scenario: 總覽只計算成功的呼叫
- **GIVEN** 查詢期間內有兩筆成功的呼叫與一筆失敗的呼叫
- **WHEN** 平台管理員查詢總覽
- **THEN** 呼叫次數是 2，token 總量與成本總額只含兩筆成功的呼叫

#### Scenario: 租戶依 token 用量排列
- **GIVEN** 查詢期間內，租戶 A 用了 500 tokens，租戶 B 用了 2000 tokens
- **WHEN** 平台管理員查詢租戶排行
- **THEN** 租戶 B 排在租戶 A 之前，每列含租戶名稱與方案名稱

#### Scenario: 單一租戶的每日用量與來源分布
- **GIVEN** 租戶在兩天內各有成功的呼叫，來源分別是 `kb-autoreply` 與 `summary`
- **WHEN** 平台管理員查詢這個租戶的用量
- **THEN** 回應的每日用量有兩天，來源分布含 `kb-autoreply` 與 `summary`

#### Scenario: 預設查詢最近 30 天
- **GIVEN** 租戶有一筆 40 天前的呼叫與一筆昨天的呼叫
- **WHEN** 平台管理員不指定期間，查詢這個租戶的用量
- **THEN** 回應只含昨天的呼叫
