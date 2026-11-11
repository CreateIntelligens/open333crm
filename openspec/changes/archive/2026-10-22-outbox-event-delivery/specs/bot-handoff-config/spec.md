# Spec Delta

## ADDED Requirements

### Requirement: 自動轉接每次只發生一次

自動轉接人工時，系統 MUST 以條件更新把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`。只有更新到這筆對話的那一次處理，MUST 寫入系統訊息、送出轉接訊息，並在同一個交易發出 `conversation.handoff`。條件不成立時，系統 MUST NOT 送出轉接訊息，也 MUST NOT 發出 `conversation.handoff`。

#### Scenario: 同一則訊息處理兩次

- **WHEN** 客人的訊息觸發自動轉接，`message.received` 被處理兩次
- **THEN** 客人 MUST 只收到一則轉接訊息，系統 MUST 只發出一個 `conversation.handoff`

#### Scenario: 兩次處理同時進行

- **WHEN** 兩個處理同時判斷同一段 `BOT_HANDLED` 對話要轉接
- **THEN** 只有一個處理 MUST 送出轉接訊息並發出 `conversation.handoff`

#### Scenario: 寫入系統訊息失敗

- **WHEN** 自動轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 對話 MUST 仍是 `BOT_HANDLED`，系統 MUST NOT 送出轉接訊息
