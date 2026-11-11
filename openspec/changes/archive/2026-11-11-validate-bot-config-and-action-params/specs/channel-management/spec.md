## MODIFIED Requirements

### Requirement: Bot 最大回覆次數的範圍

建立渠道時，若 `settings.botConfig.maxBotReplies` 有值，系統 SHALL 只接受 1～50 的整數，否則回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不建立渠道。更新渠道時，送出的 `settings.botConfig` 與已存的不同時，系統 SHALL 以同一個範圍檢查，否則回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不修改渠道；送出的 `settings.botConfig` 與已存的相同時，系統 SHALL NOT 因已存的值不在範圍內而拒絕。

#### Scenario: 範圍內的值可以儲存
- **WHEN** 有 `channel.update` 的成員以 `settings.botConfig.maxBotReplies` 為 10 更新渠道
- **THEN** 系統回 HTTP 200

#### Scenario: 超出範圍的值被拒
- **WHEN** 成員以 `settings.botConfig.maxBotReplies` 為 9999 或 0 更新渠道
- **THEN** 系統回 HTTP 400，渠道的設定不變

#### Scenario: 建立渠道時超出範圍的值被拒
- **WHEN** 成員以 `settings.botConfig.maxBotReplies` 為 9999 建立渠道
- **THEN** 系統回 HTTP 400，不建立渠道

#### Scenario: 未改動的舊值不阻擋其他設定
- **WHEN** 渠道已存的 `settings.botConfig.maxBotReplies` 是 9999，成員送出相同的 `botConfig` 並修改 `settings.downstreamWebhook`
- **THEN** 系統回 HTTP 200，`downstreamWebhook` 更新，`botConfig` 不變

## ADDED Requirements

### Requirement: 機器人設定欄位的型別與範圍

建立渠道，或更新渠道且送出的 `settings.botConfig` 與已存的不同時，`settings.botConfig` SHALL 是物件或 `null`，有值的欄位 SHALL 符合：`botMode` 與 `handoffPromptStyle` 是選項之一、`handoffKeywords` 是不空白字串的陣列、`handoffMessage` 與 `offlineGreeting` 是字串、`handoffPromptEnabled` 是布林、`handoffButtonLabel` 是最多 20 字的字串。不符合時系統 SHALL 回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，`error.details.issues` 指出欄位，渠道不變。其他鍵 SHALL 原樣存放。

#### Scenario: 設定畫面送出的完整設定可以儲存
- **WHEN** 成員以設定畫面會送出的 `botConfig`（8 個欄位，`handoffMessage` 為空字串、`handoffKeywords` 為空陣列）更新渠道
- **THEN** 系統回 HTTP 200，`botConfig` 原樣存放

#### Scenario: 轉接關鍵字有空白字串被拒
- **WHEN** 成員以 `handoffKeywords` 為 `['真人', ' ']` 更新渠道
- **THEN** 系統回 HTTP 400，`error.details.issues` 的 `path` 是 `settings.botConfig.handoffKeywords.1`，渠道不變

#### Scenario: 型別錯誤的欄位被拒
- **WHEN** 成員以 `handoffPromptEnabled` 為字串 `"false"`、或 `handoffKeywords` 為字串 `"真人,客服"`、或 `botMode` 為 `"auto"` 建立或更新渠道
- **THEN** 系統回 HTTP 400，渠道不變

#### Scenario: 未改動的舊設定不阻擋其他設定
- **WHEN** 渠道已存的 `botConfig.handoffKeywords` 是 `['']`，成員送出相同的 `botConfig` 並修改其他設定
- **THEN** 系統回 HTTP 200
