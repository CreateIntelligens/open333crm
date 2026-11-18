## ADDED Requirements

### Requirement: 留言規則啟用數硬擋
建立啟用中的留言規則、把停用規則改為啟用（含 `PATCH /rules/:id/active` 與 `PATCH /rules/:id`）之前，系統 MUST 檢查本租戶啟用中且未刪除的留言規則數是否已達有效 `maxCommentReplyRules`；已達上限 MUST 回 403 `PLAN_LIMIT_EXCEEDED`，`details` 帶 `limitKey`、`current`、`max`，規則不變。停用或已刪除的規則不計數；無上限時不檢查。方案降級後已啟用的規則 MUST 照常生效，列表帶 `OVER_PLAN_LIMIT` 警示。

#### Scenario: 建立第三條啟用規則
- **GIVEN** 有效 `maxCommentReplyRules` 是 2，已有 2 條啟用規則
- **WHEN** 建立第 3 條啟用規則
- **THEN** 回應 403 `PLAN_LIMIT_EXCEEDED`，`details` 是 `{ limitKey: 'maxCommentReplyRules', current: 2, max: 2 }`

#### Scenario: 以停用狀態建立
- **GIVEN** 有效 `maxCommentReplyRules` 是 2，已有 2 條啟用規則
- **WHEN** 建立第 3 條 `isActive: false` 的規則，之後以 `PATCH /rules/:id/active` 啟用它
- **THEN** 建立回應 201；啟用回應 403 `PLAN_LIMIT_EXCEEDED`

#### Scenario: 停用一條後再啟用
- **GIVEN** 有效 `maxCommentReplyRules` 是 2，已有 2 條啟用規則與 1 條停用規則
- **WHEN** 停用 1 條啟用規則，再啟用那條停用規則
- **THEN** 兩個請求都成功

#### Scenario: 方案沒有設定上限
- **GIVEN** 方案的 limits 沒有 `maxCommentReplyRules`，租戶也沒有覆寫
- **WHEN** 建立第 30 條啟用規則
- **THEN** 回應 201

#### Scenario: 降級後超過上限
- **GIVEN** 租戶有 5 條啟用規則，方案改為 `maxCommentReplyRules` 是 2
- **WHEN** 收到命中第 5 條規則的留言
- **THEN** 第 5 條規則照常命中，`GET /rules` 每條規則帶 `OVER_PLAN_LIMIT` 警示

### Requirement: 每月留言私訊數於送出前檢查
留言私訊呼叫 Meta 之前，系統 MUST 以台灣時間的當月計數原子地檢查並扣減有效 `monthlyCommentReplies`；已達上限時 MUST NOT 呼叫 Meta，紀錄為 `SKIPPED`、原因 `PLAN_QUOTA_EXCEEDED`、可重試。同一筆紀錄重試 MUST NOT 重複扣減；Meta 明確拒絕時 MUST 還回名額，結果不確定時不還。公開回覆不計入。無上限時仍累計用量。

#### Scenario: 本月已達上限
- **GIVEN** 有效 `monthlyCommentReplies` 是 3，本月已送出 3 則
- **WHEN** 第 4 筆紀錄的工作執行
- **THEN** 不呼叫 Meta，紀錄是 `SKIPPED`、原因 `PLAN_QUOTA_EXCEEDED`，`GET /logs` 看得到

#### Scenario: 並行不超賣
- **GIVEN** 有效 `monthlyCommentReplies` 是 3，本月 0 則
- **WHEN** 5 筆紀錄的工作同時執行
- **THEN** 恰好 3 筆 `SENT`、2 筆 `SKIPPED`，Meta 收到 3 次私訊

#### Scenario: Meta 明確拒絕不吃額度
- **GIVEN** 有效 `monthlyCommentReplies` 是 3，本月 0 則
- **WHEN** 一筆私訊 Meta 回 551
- **THEN** readiness 的 `quota.monthlyUsed` 是 0

#### Scenario: 跨月重新計算
- **WHEN** 台灣時間 11/30 23:59 送出 1 則，12/01 00:00 送出 1 則
- **THEN** 11 月與 12 月各計 1 則

#### Scenario: 升級後重試被上限略過的紀錄
- **GIVEN** 紀錄是 `SKIPPED`、原因 `PLAN_QUOTA_EXCEEDED`，留言未滿 7 天
- **WHEN** 方案提高上限後，有 manage 的成員重試這筆紀錄
- **THEN** 回應 202，紀錄最後是 `SENT`
