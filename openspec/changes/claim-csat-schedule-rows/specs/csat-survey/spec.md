## Purpose

定義滿意度問卷（CSAT）的生命週期：工單解決後，系統寄出問卷請客人評分；問卷寄出後逾時沒有回覆，系統自動結案。

## ADDED Requirements

### Requirement: 每張工單最多寄出一份滿意度問卷

寄送滿意度問卷的排程 SHALL 在寄出問卷之前認領工單：只有工單屬於該租戶、狀態是 `RESOLVED`、而且還沒有寄出時間（`csatSentAt`），系統才寫入寄出時間並寄出問卷。認領失敗時，系統 SHALL NOT 在對話中建立問卷訊息，SHALL NOT 把問卷送到客人的渠道。排程的 job 重跑、兩期重疊，或排程讀取之後工單被修改時，這條規則都成立。

#### Scenario: 工單到了寄送時間，寄出一份問卷

- **WHEN** 寄送滿意度問卷的排程處理一張狀態是 `RESOLVED`、沒有 `csatSentAt`、有對話的工單
- **THEN** 系統寫入這張工單的 `csatSentAt`，在對話中建立一則問卷訊息，並把問卷送到客人的渠道

#### Scenario: 排程讀取之後，別次執行已經寄出問卷

- **WHEN** 排程讀到一張沒有 `csatSentAt` 的工單，但在認領之前，另一次執行已經寫入這張工單的 `csatSentAt`
- **THEN** 系統不在對話中建立問卷訊息，也不把問卷送到客人的渠道

#### Scenario: 排程讀取之後，客服重開了工單

- **WHEN** 排程讀到一張狀態是 `RESOLVED` 的工單，但在認領之前，客服把工單改成 `IN_PROGRESS`
- **THEN** 系統不寄出問卷，這張工單的 `csatSentAt` 維持空值

### Requirement: 問卷逾時結案不覆蓋已變更的工單

問卷逾時結案的排程 SHALL 在結案之前認領工單：只有工單屬於該租戶、狀態是 `RESOLVED`、而且客人還沒有回覆（`csatRespondedAt` 是空值），系統才把工單改成 `CLOSED`。認領失敗時，系統 SHALL NOT 改變工單，SHALL NOT 發布 `case.closed`，SHALL NOT 推送 `case.updated`，SHALL NOT 關閉工單底下的對話。

#### Scenario: 問卷逾時沒有回覆，工單結案

- **WHEN** 問卷逾時結案的排程處理一張狀態是 `RESOLVED`、問卷已逾時、沒有 `csatRespondedAt` 的工單
- **THEN** 系統把工單改成 `CLOSED` 並寫入 `closedAt`，發布一次 `case.closed`，並關閉工單底下還沒關閉的對話

#### Scenario: 排程讀取之後，客服重開了工單

- **WHEN** 排程讀到一張狀態是 `RESOLVED` 的工單，但在認領之前，客服把工單改成 `IN_PROGRESS`
- **THEN** 工單維持 `IN_PROGRESS`，系統不發布 `case.closed`，也不關閉工單底下的對話

#### Scenario: 排程讀取之後，客人回覆了評分

- **WHEN** 排程讀到一張沒有 `csatRespondedAt` 的工單，但在認領之前，客人的評分已經寫入 `csatRespondedAt`
- **THEN** 問卷逾時結案的排程不改變這張工單，也不發布 `case.closed`

#### Scenario: 排程讀取之後，別次執行已經結案

- **WHEN** 排程讀到一張狀態是 `RESOLVED` 的工單，但在認領之前，另一次執行已經把工單改成 `CLOSED`
- **THEN** 這次執行不發布 `case.closed`，也不關閉工單底下的對話
