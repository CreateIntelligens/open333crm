## MODIFIED Requirements

### Requirement: 知識庫追問用完或 AI 失敗時轉接真人

知識庫自動回覆的追問次數已達 `clarifyMaxAttempts`，或追問的 LLM 呼叫失敗（含 `PLAN_LIMIT_EXCEEDED`）時，系統 SHALL 在寫入「已為您轉接客服人員」回覆的同一個交易，以條件更新把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`、寫入 `handoffReason` 與一則系統訊息、發出 `conversation.handoff`，並在 commit 後推播到渠道房間。追問次數 SHALL 歸零。條件不成立時，系統 SHALL NOT 寫入或送出這則回覆。

型號守門的回覆（`model_not_found`）SHALL 與追問共用追問次數，每則守門回覆加 1。命中型號守門時追問次數已達 `clarifyMaxAttempts`，系統 SHALL NOT 送出型號引導，SHALL 改走上述追問用完的轉接。

#### Scenario: 追問次數用完
- **WHEN** `clarifyMaxAttempts` 為 2，對話的追問次數為 2，客人傳送知識庫找不到答案的文字
- **THEN** 客人收到一則「已為您轉接客服人員」，對話為 `AGENT_HANDLED`、`handoffReason` 說明追問次數已達上限，對話有一則系統訊息，系統發出一個 `conversation.handoff`，`conversation.updated` 推播到渠道房間、不推到 tenant 房間，追問次數為 0

#### Scenario: LLM 呼叫失敗
- **WHEN** 追問的 LLM 呼叫丟出 `PLAN_LIMIT_EXCEEDED`（月額度用完）或其他錯誤
- **THEN** 客人收到「已為您轉接客服人員」，對話為 `AGENT_HANDLED`，月額度用完時 `handoffReason` 說明 AI 月額度已用完，系統發出一個 `conversation.handoff`

#### Scenario: 轉接後客人再傳訊息
- **WHEN** 對話因追問用完轉接之後，客人再傳一則文字
- **THEN** 客人 SHALL NOT 再收到「已為您轉接客服人員」或任何 KB 回覆，系統 SHALL NOT 再發出 `conversation.handoff`

#### Scenario: 同一則訊息處理兩次
- **WHEN** 觸發追問用完的 `message.received` 被處理兩次
- **THEN** 客人只收到一則轉接訊息，對話只有一則轉接系統訊息，系統只發出一個 `conversation.handoff`

#### Scenario: 寫入系統訊息失敗
- **WHEN** 轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 對話仍是 `BOT_HANDLED`，沒有機器人回覆、沒有 `conversation.handoff`，客人沒有收到轉接訊息，處理失敗並由佇列重試

#### Scenario: 還沒用完追問次數
- **WHEN** `clarifyMaxAttempts` 為 2，對話的追問次數為 1，客人傳送知識庫找不到答案的文字
- **THEN** 系統照常追問，追問次數變成 2，對話仍是 `BOT_HANDLED`

#### Scenario: 型號守門回覆累加追問次數
- **WHEN** 租戶型號白名單有 `TAC-11A`，`clarifyMaxAttempts` 為 2，對話的追問次數為 0，客人傳送「TAC-11P 怎麼清洗」且知識庫相似度低於 0.85
- **THEN** 機器人回覆類型為 `model_not_found`，追問次數變成 1，對話仍是 `BOT_HANDLED`

#### Scenario: 型號守門時追問次數已用完
- **WHEN** 租戶型號白名單有 `TAC-11A`，`clarifyMaxAttempts` 為 2，對話的追問次數為 2，客人傳送「TAC-11P 怎麼清洗」且知識庫相似度低於 0.85
- **THEN** 系統不呼叫 LLM，客人收到「已為您轉接客服人員」，回覆類型為 `clarify_handoff`，對話為 `AGENT_HANDLED`、`handoffReason` 說明追問次數已達上限，系統發出一個 `conversation.handoff`，追問次數為 0

#### Scenario: 客人一直提到查無的型號
- **WHEN** 租戶型號白名單有 `TAC-11A`，`clarifyMaxAttempts` 為 2，對話的追問次數為 0，客人連續傳送三則提到 `TAC-11P` 的訊息，知識庫相似度都低於 0.85
- **THEN** 前兩則的回覆類型為 `model_not_found`，第三則為 `clarify_handoff`，對話為 `AGENT_HANDLED`

## ADDED Requirements

### Requirement: 型號守門只攔截知識庫型號格式的型號

型號偵測 SHALL 區分大小寫：型號是 1 到 4 個大寫英文字母的前綴、`-`、再接大寫英數段（例如 `TAC-11P`、`TAC-06L-MCW`）。小寫或大小寫混合的詞（`Wi-Fi`、`e-mail`、`T-shirt`、`tac-11p`），以及大寫時也符合格式的常見英文詞（`WI-FI`、`E-MAIL`、`T-SHIRT`、`USB-C`、`TYPE-C`、`HDMI-2`、`CD-R`、`DVD-R`）SHALL NOT 當成型號。型號守門 SHALL 只攔截前綴出現在租戶型號白名單的型號；白名單是空的（知識庫沒有型號文章）時 SHALL NOT 攔截任何訊息。

#### Scenario: 一般英文詞不當成型號
- **WHEN** 租戶型號白名單有 `TAC-11A`，客人傳送「我家 Wi-Fi 連不上怎麼辦」「請問可以寄 e-mail 給你們嗎」「我想買 T-shirt」或「WI-FI 密碼要怎麼改」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`（照常追問），回覆的 metadata 沒有 `modelGuard`

#### Scenario: 小寫的型號格式不當成型號
- **WHEN** 租戶型號白名單有 `TAC-11A`，客人傳送「tac-11p 怎麼清洗」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`

#### Scenario: 查無的型號仍引導選型號
- **WHEN** 租戶型號白名單有 `TAC-11A`、`TAC-11KN`，客人傳送「TAC-11P 怎麼清洗」，知識庫相似度低於 0.85
- **THEN** 回覆類型為 `model_not_found`，`modelGuard.unknownModel` 為 `TAC-11P`，`modelGuard.relatedModels` 為 `TAC-11A`、`TAC-11KN`

#### Scenario: 知識庫沒有型號文章時不守門
- **WHEN** 租戶型號白名單是空的，客人傳送「TAC-11P 怎麼清洗」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`，回覆的 metadata 沒有 `modelGuard`

#### Scenario: 前綴不在白名單的編號不守門
- **WHEN** 租戶型號白名單只有 `TAC` 前綴的型號，客人傳送「我的訂單 AB-12345 還沒到」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`

#### Scenario: 型號偵測不命中一般英文詞
- **WHEN** 以 `Wi-Fi`、`e-mail`、`T-shirt`、`WI-FI`、`E-MAIL`、`T-SHIRT`、`USB-C`、`Type-C`、`HDMI-2`、`tac-11p` 呼叫型號偵測
- **THEN** 偵測結果是空的；以 `TAC-11P`、`TAC-06L-MCW`、`TAW-A080WM`、`TDH-168MC-NW`、`AC-9` 呼叫時各偵測到一個型號
