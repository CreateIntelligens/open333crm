## ADDED Requirements

### Requirement: 未遮罩的進站訊息不交給 AI，轉接真人

`message.received` 的 `payload.privacyUnmasked` 是 `true`、對話是 `BOT_HANDLED`、訊息是文字，而且這則訊息原本會交給 agent 或知識庫自動回覆時，系統 SHALL NOT 呼叫 agent、知識庫自動回覆或 embedding，SHALL 以 `bot_reply` 認領後轉接真人：對話改成 `AGENT_HANDLED`，`handoffReason` 是「去識別化服務無法使用，這則訊息未遮罩、未交給 AI」，寫入一則不呼叫去識別化服務的系統訊息（`metadata.source` 是 `inbound_unmasked`），發出 `conversation.handoff`，commit 之後送出渠道的轉接訊息。情緒分析 SHALL 只用關鍵字判斷，不呼叫模型。「正常不回覆時不轉接」列出的情況 SHALL NOT 轉接。

#### Scenario: 未遮罩的訊息轉接真人

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人在 `BOT_HANDLED` 對話傳送「我的電話 0912345678」，系統處理這則訊息的 `message.received`
- **THEN** 對話是 `AGENT_HANDLED`，`handoffReason` 是「去識別化服務無法使用，這則訊息未遮罩、未交給 AI」，對話有一則 `metadata.source` 為 `inbound_unmasked` 的系統訊息，沒有機器人回覆，系統發出一個 `conversation.handoff`，客人收到一則轉接訊息，模型供應商與 embedding 服務都沒有被呼叫

#### Scenario: 未遮罩的訊息命中關鍵字規則

- **WHEN** `payload.privacyUnmasked` 是 `true`，客人傳送命中 `send_message` 關鍵字規則的文字
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`，模型供應商沒有被呼叫

#### Scenario: 未遮罩的訊息的情緒分析

- **WHEN** `payload.privacyUnmasked` 是 `true`，客人傳送「太爛了」
- **THEN** 這則訊息的 `metadata.sentiment.sentiment` 是 `negative`，模型供應商沒有被呼叫

### Requirement: 模型讀取的對話紀錄略過未遮罩的訊息

模型讀取訊息內容的函式 SHALL 略過 `metadata.privacy.mode` 為 `inbound_unmasked` 的訊息，包括 AI 建議回覆、對話摘要、agent 與知識庫自動回覆的歷史、其他渠道脈絡與新工單的自動分類。

#### Scenario: 對話紀錄有未遮罩的訊息

- **WHEN** 對話紀錄有一則 `metadata.privacy.mode` 為 `inbound_unmasked`、內容是「我的電話 0912345678」的進站訊息，以及一則有遮罩副本的進站訊息
- **THEN** 模型讀到的歷史只有遮罩副本那一則，不含「0912345678」

#### Scenario: 新工單最新的進站訊息未遮罩

- **WHEN** 新工單所屬對話最新的進站訊息是未遮罩的訊息
- **THEN** 系統不呼叫模型分類，工單的分類仍是空的

### Requirement: 程式固定的系統文字不呼叫去識別化服務

租戶開啟 AI 個資遮罩時，程式內固定、不含顧客輸入或名稱的系統訊息 SHALL 原文送出與保存，遮罩副本 SHALL 就是原文（`metadata.privacy.mode` 為 `system_fixed`），SHALL NOT 呼叫去識別化服務。這類訊息是：按鈕轉接人工的系統訊息、跨渠道綁定失敗的內部提示、滿意度調查、評分後的固定回覆、座席轉接時沒有填寫的預設轉接訊息。含顧客名稱的綁定訊息與含座席名稱的交回 Bot 訊息 SHALL 維持原本的遮罩方式。

#### Scenario: 去識別化服務無法使用時客人點按轉接人工

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人在 `BOT_HANDLED` 對話點按 `handoff_request` 按鈕
- **THEN** 對話是 `AGENT_HANDLED`，有一則內容為「使用者主動點按按鈕轉接人工客服」的系統訊息，`metadata.privacy.mode` 是 `system_fixed`，遮罩副本與內容相同

#### Scenario: 去識別化服務無法使用時滿意度調查照常送出

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，系統送出一張工單的滿意度調查
- **THEN** 問卷照常送出，對話有一則內容為「滿意度調查」的訊息，`metadata.privacy.mode` 是 `system_fixed`，遮罩副本與內容相同，系統沒有呼叫去識別化服務

#### Scenario: 去識別化服務無法使用時跨渠道綁定失敗

- **WHEN** 租戶開啟遮罩與跨渠道綁定，去識別化服務一直回 503，客人傳送「綁定帳號」
- **THEN** 綁定訊息沒有送出，對話有一則內容為「跨渠道綁定處理失敗，顧客的綁定請求沒有完成，請協助確認。」的內部提示，`metadata.privacy.mode` 是 `system_fixed`

#### Scenario: 座席轉接時沒有填寫轉接訊息

- **WHEN** 租戶開啟遮罩，座席轉接對話時沒有填寫轉接訊息
- **THEN** 系統訊息是「稍等，正在為您轉接客服人員」，遮罩副本與內容相同，系統沒有呼叫去識別化服務

### Requirement: 去識別化服務無法使用時自動轉接照常完成

租戶開啟 AI 個資遮罩，`message.received` 觸發自動轉接（轉接關鍵字、回覆次數上限或客人傳送圖片、檔案、影片），而去識別化服務在重試之後仍無法遮罩轉接的系統訊息時，系統 SHALL 照常轉接：捨棄對話摘要，系統訊息只寫「自動轉接人工客服：」加上轉接原因，以不呼叫去識別化服務的固定文字寫入（`metadata.privacy.mode` 為 `system_fixed`）。處理 SHALL NOT 因此失敗。

#### Scenario: 去識別化服務無法使用時客人要求轉接真人

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，渠道的轉接關鍵字有「真人」，客人在 `BOT_HANDLED` 對話傳送「我要找真人 0912345678」
- **THEN** 處理沒有失敗，對話是 `AGENT_HANDLED`，`handoffReason` 是「客戶要求轉接真人 (關鍵字: 真人)」，對話有一則內容為「自動轉接人工客服：客戶要求轉接真人 (關鍵字: 真人)」的系統訊息，`metadata.privacy.mode` 是 `system_fixed`，系統訊息不含「0912345678」，系統發出一個 `conversation.handoff`
