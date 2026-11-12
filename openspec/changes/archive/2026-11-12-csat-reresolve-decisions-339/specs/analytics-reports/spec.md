## ADDED Requirements

### Requirement: 滿意度分數只算客人自評
報表的 CSAT 平均分數與好評率 SHALL 只計算客人自評的工單（`csatRatedBy` 不是 `agent`；沒有來源的舊資料視為客人自評）。總覽（`GET /analytics/overview`，含 CLI 與 MCP）SHALL 另外回傳 `csatAgentRatedCount`（期間內客服代評的工單數）；`GET /analytics/csat` 的回覆數、平均、滿意率與低分工單只算客人自評，另外回傳 `agentRatedCount`；客服績效與我的績效的 CSAT 平均只算客人自評。報表頁的 CSAT 分數卡 SHALL 顯示客服代評的筆數。

#### Scenario: 總覽的平均不含客服代評
- **WHEN** 期間內有兩張客人自評 4 分與 2 分的工單、一張客服代評 5 分的工單
- **THEN** `GET /analytics/overview` 的 `csatAvg` 是 3，`csatPositiveRate` 是 50，`csatAgentRatedCount` 是 1

#### Scenario: 滿意度報告分開客服代評
- **WHEN** 期間內寄出問卷的工單有一張客人自評 1 分、一張客服代評 5 分、一張沒有評分
- **THEN** `GET /analytics/csat` 的 `totalResponded` 是 1、`avgScore` 是 1、`agentRatedCount` 是 1，`lowScoreCases` 只有客人自評的那張

#### Scenario: 客服績效的 CSAT 不含客服代評
- **WHEN** 一位客服負責兩張工單，一張客人自評 2 分、一張客服代評 5 分
- **THEN** `GET /analytics/agents` 這位客服的 `csatAvg` 是 2

#### Scenario: 報表頁顯示客服代評筆數
- **WHEN** 報表總覽回傳 `csatAvg` 是 4.5、`csatAgentRatedCount` 是 3
- **THEN** CSAT 分數卡顯示 4.5 與「客服代評 3 筆（不計入平均）」
