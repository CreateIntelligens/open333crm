## MODIFIED Requirements

### Requirement: 平台用量查詢
平台 API SHALL 提供下列用量查詢，只有平台管理員可以呼叫（見 `platform-auth`）：

- `GET /api/v1/platform/usage/overview`：所有租戶的 token 總量、成本總額、呼叫次數、有用量的租戶數，以及依 provider 的分布。
- `GET /api/v1/platform/usage/tenants`：依 token 用量由多到少排列的前 50 個租戶，含租戶名稱與方案名稱。
- `GET /api/v1/platform/usage/tenants/:tenantId`：一個租戶每日的 token、成本與呼叫次數（分日方式見「每日用量以台灣日期分日並補齊沒有用量的日子」），以及依呼叫來源（`AiUsage.feature`）的分布。

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
- **THEN** 回應的每日用量中有用量的日子是這兩天，來源分布含 `kb-autoreply` 與 `summary`

#### Scenario: 預設查詢最近 30 天
- **GIVEN** 租戶有一筆 40 天前的呼叫與一筆昨天的呼叫
- **WHEN** 平台管理員不指定期間，查詢這個租戶的用量
- **THEN** 回應的每日用量只有昨天有用量，40 天前的呼叫不在任何一天

## ADDED Requirements

### Requirement: 每日用量以台灣日期分日並補齊沒有用量的日子
單一租戶用量的每日用量（`trend`）SHALL 以台灣時間（`Asia/Taipei`）的日期分日，每筆的 `day` SHALL 是台灣日期（`YYYY-MM-DD`）。查詢期間內從 `from` 的台灣日期到 `to` 的台灣日期，每一天 SHALL 各有一筆，依日期由舊到新排列；沒有用量的日子 SHALL 回 `tokens: 0`、`costUsd: "0"`、`calls: 0`。期間超過 400 天時 SHALL 只列有用量的日子。期間的過濾 SHALL 與總覽、租戶排行相同，每日用量的加總等於同一期間這個租戶在排行中的用量。

#### Scenario: 每日用量補齊沒有用量的日子
- **GIVEN** 查詢期間是台灣時間 2001-01-01 00:00 到 2001-01-05 23:59，租戶只有 2001-01-02 與 2001-01-04 有呼叫
- **WHEN** 平台管理員查詢這個租戶的用量
- **THEN** 每日用量依序是 2001-01-01 到 2001-01-05 共 5 筆，2001-01-01、2001-01-03、2001-01-05 的 `tokens`、`calls` 是 0，`costUsd` 是 `"0"`

#### Scenario: 台灣凌晨的呼叫算在台灣當天
- **GIVEN** 租戶有一筆 UTC 2001-01-09 20:00（台灣 2001-01-10 04:00）的呼叫
- **WHEN** 平台管理員查詢這個租戶的用量
- **THEN** 這筆呼叫算在 `day` 是 `2001-01-10` 的那一天，`2001-01-09` 沒有用量

#### Scenario: 期間超過 400 天只列有用量的日子
- **GIVEN** 查詢期間超過 400 天，租戶只有兩天有呼叫
- **WHEN** 平台管理員查詢這個租戶的用量
- **THEN** 每日用量只有這兩天
