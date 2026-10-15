## MODIFIED Requirements

### Requirement: AI 只在關鍵字規則能在該渠道回覆時讓步
收到文字訊息時，若同租戶有啟用中的 `keyword.matched` 規則命中這則訊息，而且該規則通過契約驗證、條件成立，並至少有一個能在這則訊息的渠道回覆的動作，系統 SHALL 不送出 agent 或 KB 自動回覆。能回覆的動作是 `send_message`，或素材渠道與對話渠道相同的 `send_material`；而且 workers 要能送到這個渠道（`AUTOMATION_DELIVERY_CHANNEL_TYPES`，目前是 LINE、FB、Instagram）。沒有這樣的規則時，系統 SHALL 照常嘗試 AI 回覆。有條件的規則無法評估時（沒有對話與聯絡人，或讀取條件資料失敗），系統 SHALL 視為條件不成立；沒有條件的規則 SHALL 視為成立，不讀取條件資料。

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

#### Scenario: 規則條件不成立
- **WHEN** LINE 對話收到「你好」，命中的規則動作是 `send_message`，條件是「對話渠道等於 Facebook」
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 規則條件成立
- **WHEN** LINE 對話收到「你好」，命中的規則動作是 `send_message`，條件是「對話渠道等於 LINE」
- **THEN** 不送出 AI 回覆

#### Scenario: 條件資料讀取失敗
- **WHEN** LINE 對話收到「你好」，命中的規則動作是 `send_message`，有條件，讀取條件資料失敗
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 沒有對話與聯絡人時的條件規則
- **WHEN** 收到「你好」，沒有對話與聯絡人，命中的規則動作是 `send_message`，條件是「對話渠道不等於 Facebook」
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 沒有條件的規則
- **WHEN** LINE 對話收到「你好」，命中的規則動作是 `send_message`，沒有條件
- **THEN** 不送出 AI 回覆，也不讀取條件資料

#### Scenario: 規則不合契約
- **WHEN** LINE 對話收到「你好」，命中的規則有 `send_message` 和契約沒有的動作 `auto_assign`
- **THEN** 系統照常嘗試 AI 回覆，因為 workers 會略過整條規則

## ADDED Requirements

### Requirement: 傳送通知的收件人
`notify` 動作 SHALL 有選填參數 `agentId`（編輯器標示「通知誰」，從客服名單挑選）。workers 執行時 SHALL 依序選第一個啟用中、同租戶的客服：`agentId` 指定的客服；觸發工單的負責人；觸發對話的負責客服。三者都沒有或都不合格時，SHALL 通知同租戶所有啟用中的主管與管理員，不可只寫 log 而不送。

#### Scenario: 指定客服
- **WHEN** 「聯絡人建立」規則的 `notify` 指定客服 A
- **THEN** 客服 A 收到通知

#### Scenario: 沒有指定，工單有負責人
- **WHEN** 「工單建立」規則的 `notify` 沒有指定客服，工單負責人是客服 B
- **THEN** 客服 B 收到通知

#### Scenario: 沒有指定，對話有負責客服
- **WHEN** 「收到訊息」規則的 `notify` 沒有指定客服，沒有工單，對話負責客服是客服 C
- **THEN** 客服 C 收到通知

#### Scenario: 沒有任何負責人
- **WHEN** 「短連結點擊」規則的 `notify` 沒有指定客服，也沒有工單與對話
- **THEN** 同租戶所有啟用中的主管與管理員收到通知

#### Scenario: 指定的客服已停用或屬於別的租戶
- **WHEN** `notify` 指定的客服已停用，或不屬於規則的租戶，而工單負責人是客服 B
- **THEN** 不通知指定的客服，改通知客服 B

#### Scenario: 工單負責人已停用或屬於別的租戶
- **WHEN** `notify` 沒有指定客服，工單負責人已停用或不屬於規則的租戶，對話負責客服是客服 C
- **THEN** 不通知工單負責人，改通知客服 C

#### Scenario: 對話負責客服已停用或屬於別的租戶
- **WHEN** `notify` 沒有指定客服，沒有工單，對話負責客服已停用或不屬於規則的租戶
- **THEN** 同租戶所有啟用中的主管與管理員收到通知

### Requirement: 傳送素材從素材庫挑選
規則編輯器的「傳送素材」SHALL 以下拉選單列出同租戶所有啟用中的素材，選項顯示素材名稱與渠道，存入選取素材的 ID。規則已存的素材不在清單時，SHALL 保留原值並標示「已停用或找不到的素材」。無法載入素材清單時（例如沒有素材檢視權限），SHALL 退回文字輸入並說明原因。

#### Scenario: 從清單選素材
- **WHEN** 管理員在「傳送素材」的下拉選單選「歡迎訊息（LINE）」
- **THEN** 動作的 `materialId` 是該素材的 ID

#### Scenario: 已存的素材被停用
- **WHEN** 規則的 `materialId` 指向已停用的素材
- **THEN** 下拉選單顯示「已停用或找不到的素材」並保留原值

#### Scenario: 沒有素材檢視權限
- **WHEN** 素材清單 API 回 403
- **THEN** 欄位改為文字輸入，並說明無法載入素材清單

### Requirement: 不合契約的規則不可啟用
把規則改為啟用時，即使這次沒有改觸發、條件或動作，API SHALL 以規則儲存後的觸發、條件與動作做契約驗證，不通過時回 400 並列出原因，不改變啟用狀態。停用規則 SHALL 不做契約驗證。

#### Scenario: 開啟含未知動作的規則
- **WHEN** 管理員在列表打開停用中、含動作 `auto_assign` 的規則
- **THEN** API 回 400，訊息含「第 2 個動作「auto_assign」不是系統提供的動作」，規則維持停用

#### Scenario: 停用不合契約的規則
- **WHEN** 管理員關閉啟用中、觸發事件是 `sentiment.negative` 的規則
- **THEN** 規則改為停用

#### Scenario: 開啟合法的規則
- **WHEN** 管理員打開停用中、通過契約驗證的規則
- **THEN** 規則改為啟用

### Requirement: 編輯器標示未知觸發事件
規則編輯器載入觸發事件不在契約內的規則時，觸發事件下拉 SHALL 顯示「未知觸發事件（<代碼>）」，不可顯示成其他事件，並 SHALL 提示這條規則不會執行、請改選觸發事件。

#### Scenario: 舊規則的觸發事件
- **WHEN** 管理員打開觸發事件是 `sentiment.negative` 的規則
- **THEN** 下拉顯示「未知觸發事件（sentiment.negative）」，並提示請改選
