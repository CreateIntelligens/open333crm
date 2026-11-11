## MODIFIED Requirements

### Requirement: 轉接後關鍵字規則照常回覆

命中能在該渠道回覆的 `keyword.matched` 規則的訊息，知識庫自動回覆 SHALL 讓步，這則訊息不算追問，也不觸發追問用完的轉接。對話轉接成 `AGENT_HANDLED` 之後，系統 SHALL 照常以這則訊息評估關鍵字規則並執行其動作；知識庫自動回覆與 agent 回覆 SHALL NOT 回覆 `AGENT_HANDLED` 的對話。知識庫自動回覆 SHALL 在寫入回覆的交易內，以條件更新確認對話仍是 `BOT_HANDLED`；條件不成立時，系統 SHALL NOT 寫入或送出這則回覆。

#### Scenario: 轉接後客人傳送關鍵字
- **WHEN** 對話因追問用完轉接成 `AGENT_HANDLED` 之後，客人傳送文字「營業時間」
- **THEN** 系統以「營業時間」送出這則訊息的關鍵字規則評估，知識庫自動回覆不再回覆

#### Scenario: 知識庫產生回覆期間客服接手
- **WHEN** 知識庫自動回覆已經確認對話是 `BOT_HANDLED`，在 LLM 回應之前，客服接手對話，對話改成 `AGENT_HANDLED`
- **THEN** 對話沒有這次的機器人回覆訊息，客人沒有收到回覆，對話的 `botRepliesCount` 不變

## ADDED Requirements

### Requirement: 知識庫自動回覆不在交易內等待外部呼叫

知識庫自動回覆 MUST NOT 在資料庫交易內呼叫 embedding 服務、LLM 或去識別化服務。讀取與寫入 SHALL 在綁定這個租戶的交易內執行，受 RLS 約束。

#### Scenario: 呼叫外部服務之前交易已經結束
- **WHEN** 知識庫自動回覆向量化客人的訊息、呼叫 LLM 產生回覆，並遮罩回覆
- **THEN** 每次呼叫開始之前，知識庫自動回覆開過的交易都已經結束

#### Scenario: 對話屬於其他租戶
- **WHEN** 以租戶 A 執行知識庫自動回覆，對話 id 是租戶 B 的 `BOT_HANDLED` 對話
- **THEN** 結果是略過（`not_bot_handled`），租戶 B 的對話沒有新的訊息
