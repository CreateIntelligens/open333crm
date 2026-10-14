## ADDED Requirements

### Requirement: AI 只在關鍵字規則能在該渠道回覆時讓步
收到文字訊息時，若同租戶有啟用中的 `keyword.matched` 規則命中這則訊息，而且該規則至少有一個能在這則訊息的渠道回覆的動作，系統 SHALL 不送出 agent 或 KB 自動回覆。能回覆的動作是 `send_message`，或素材渠道與對話渠道相同的 `send_material`；而且 workers 要能送到這個渠道（`AUTOMATION_DELIVERY_CHANNEL_TYPES`，目前是 LINE、FB、Instagram）。命中的規則都沒有能回覆的動作時，系統 SHALL 照常嘗試 AI 回覆。

#### Scenario: 規則的素材是這個渠道的
- **WHEN** IG 對話收到「你好」，命中的規則動作是 IG 素材的 `send_material`
- **THEN** 不送出 AI 回覆

#### Scenario: 規則的素材是別的渠道的
- **WHEN** IG 對話收到「你好」，命中的規則只有 LINE 素材的 `send_material`
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 規則傳送文字
- **WHEN** IG 對話收到「你好」，命中的規則動作是 `send_message`
- **THEN** 不送出 AI 回覆

#### Scenario: 規則不回覆顧客
- **WHEN** 訊息命中的規則只有 `add_tag`
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 沒有命中任何規則
- **WHEN** 訊息不含任何啟用中規則的關鍵字
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 網站聊天室的規則送不出去
- **WHEN** 網站聊天室的對話收到「你好」，命中的規則動作是 `send_message`
- **THEN** 系統照常嘗試 AI 回覆

### Requirement: 素材渠道不符時留下看得到的紀錄
執行 `send_material` 時，素材的渠道與對話的渠道不同，系統 SHALL 不送出素材，並在該對話寫入一則系統訊息，標示沒有送出，原因說明素材的渠道與對話不同。

#### Scenario: LINE 素材遇到 IG 對話
- **WHEN** 規則在 IG 對話執行 LINE 素材的 `send_material`
- **THEN** 不呼叫渠道外掛送出，對話多一則 `metadata.deliveryFailed` 為 true 的系統訊息，`deliveryError` 說明素材是 LINE 素材、這個對話是 Instagram
