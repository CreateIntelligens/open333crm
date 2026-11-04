## ADDED Requirements

### Requirement: AI 與知識庫回覆都因錯誤失敗時轉接真人

客人在 `BOT_HANDLED` 對話傳送文字訊息，agent 沒有送出回覆，而知識庫自動回覆因錯誤沒有送出回覆時（例如去識別化服務、embedding 服務或模型供應商失敗），系統 SHALL 轉接真人：以條件更新把對話改成 `AGENT_HANDLED`、寫入 `handoffReason` 與一則系統訊息、發出 `conversation.handoff`，commit 之後送出渠道的轉接訊息。`handoffReason` SHALL 依錯誤種類寫成客服看得懂的原因，SHALL NOT 包含錯誤內容。寫入系統訊息 SHALL NOT 呼叫去識別化服務。

#### Scenario: 去識別化服務失敗

- **WHEN** 租戶開啟 AI 個資遮罩，去識別化服務回 503，客人在 `BOT_HANDLED` 對話傳送「1+1等於幾」，agent 與知識庫自動回覆都因此失敗
- **THEN** 對話為 `AGENT_HANDLED`，`handoffReason` 為「AI 暫時無法回覆（去識別化服務無法使用）」，對話有一則系統訊息、沒有機器人回覆，系統發出一個 `conversation.handoff`，客人收到一則渠道的轉接訊息

#### Scenario: 其他錯誤

- **WHEN** 未開啟 AI 個資遮罩，agent 的模型供應商丟錯，知識庫的 embedding 服務回 500
- **THEN** 對話為 `AGENT_HANDLED`，`handoffReason` 為「AI 暫時無法回覆（AI 服務發生錯誤）」，`handoffReason` 與系統訊息不含 embedding 服務的錯誤內容

#### Scenario: agent 失敗但知識庫回覆成功

- **WHEN** agent 的模型供應商丟錯，知識庫自動回覆找到文章並送出回覆
- **THEN** 客人收到知識庫的回覆，對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`

### Requirement: 正常不回覆時不轉接

agent 與知識庫自動回覆因下列原因沒有回覆時，不是失敗，系統 SHALL NOT 因此轉接：能在該渠道回覆的關鍵字規則命中、渠道的 `botMode` 為 `off` 或 `keyword`、知識庫自動回覆停用、這則訊息已有機器人回覆、對話已不是 `BOT_HANDLED`。

#### Scenario: 關鍵字規則讓步

- **WHEN** 去識別化服務無法使用，客人傳送命中 `send_message` 關鍵字規則的文字「營業時間」
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`，客人沒有收到轉接訊息

#### Scenario: botMode 關閉

- **WHEN** 渠道的 `botMode` 為 `off`，去識別化服務無法使用，客人傳送文字
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`

#### Scenario: 知識庫自動回覆停用

- **WHEN** `KB_AUTO_REPLY_ENABLED` 為 false，agent 因去識別化服務無法使用而失敗
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`

#### Scenario: 這則訊息已有機器人回覆

- **WHEN** 這則入站訊息已有 `bot_reply` 認領紀錄，`message.received` 再被處理一次，去識別化服務無法使用
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`，客人沒有收到轉接訊息

### Requirement: AI 失敗的轉接每則訊息最多一次

AI 失敗的轉接 SHALL 以「`bot_reply` + 入站訊息 id」認領，認領與轉接寫在同一個交易。轉接的交易失敗時，處理 SHALL 失敗，由佇列重試；commit 之後送出轉接訊息失敗 SHALL 只記錄，不重試。系統 SHALL NOT 自動重新送出 AI 回覆。

#### Scenario: 同一則訊息處理兩次

- **WHEN** agent 與知識庫都失敗的 `message.received` 被處理兩次
- **THEN** 對話只有一則轉接系統訊息，系統只發出一個 `conversation.handoff`，客人只收到一則轉接訊息

#### Scenario: 寫入系統訊息失敗

- **WHEN** agent 與知識庫都失敗，轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 處理失敗，對話仍是 `BOT_HANDLED`，沒有 `conversation.handoff`，客人沒有收到轉接訊息；佇列重試時轉接一次
