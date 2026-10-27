## MODIFIED Requirements

### Requirement: AI 只在關鍵字規則能在該渠道回覆時讓步
收到文字訊息時，若同租戶有啟用中的 `keyword.matched` 規則命中這則訊息，而且該規則通過契約驗證、條件成立，並至少有一個能在這則訊息的渠道回覆的動作，系統 SHALL 不送出 agent 或 KB 自動回覆。能回覆的動作是 `send_message`、素材渠道與對話渠道相同的 `send_material`，或指定同租戶進行中優惠券的 `issue_coupon`；而且 workers 要能送到這個渠道（`AUTOMATION_DELIVERY_CHANNEL_TYPES`，目前是 LINE、FB、Instagram）。沒有這樣的規則時，系統 SHALL 照常嘗試 AI 回覆。有條件的規則無法評估時（沒有對話與聯絡人，或讀取條件資料失敗），系統 SHALL 視為條件不成立；沒有條件的規則 SHALL 視為成立，不讀取條件資料。

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

#### Scenario: 規則發送進行中的優惠券

- **WHEN** LINE 對話收到「領券」，命中的規則只有 `issue_coupon`，指定的券是進行中
- **THEN** 不送出 AI 回覆

#### Scenario: 規則的優惠券不是進行中

- **WHEN** LINE 對話收到「領券」，命中的規則只有 `issue_coupon`，指定的券已暫停
- **THEN** 系統照常嘗試 AI 回覆

#### Scenario: 網站聊天室的發券規則

- **WHEN** 網站聊天室的對話收到「領券」，命中的規則只有 `issue_coupon`
- **THEN** 系統照常嘗試 AI 回覆

## ADDED Requirements

### Requirement: 加入好友事件

LINE 顧客加入官方帳號為好友（`follow` 事件）時，系統 SHALL 發出自動化事件「加入好友」（`contact.followed`），範圍為租戶、聯絡人與對話，並帶該事件的回覆權杖與收到時間。規則編輯器 SHALL 在事件清單列出「加入好友」，可選「傳送訊息」「傳送素材」等需要對話的動作（發券在加好友禮頁設定）。

#### Scenario: 加好友觸發規則

- **GIVEN** 啟用中的規則事件為「加入好友」，動作為傳送訊息「歡迎加入」
- **WHEN** 顧客加入官方帳號為好友
- **THEN** 顧客以回覆方式收到「歡迎加入」

#### Scenario: 取消好友不觸發

- **WHEN** 顧客封鎖官方帳號（`unfollow` 事件）
- **THEN** 「加入好友」規則不觸發

#### Scenario: 加好友不觸發收到訊息的關鍵字規則

- **WHEN** 顧客加入官方帳號為好友
- **THEN** 關鍵字規則不因這個事件觸發

### Requirement: 記錄加入好友的次數

系統 SHALL 在每個 LINE 渠道身分記錄第一次與最後一次加入好友的時間及加入次數，並提供條件「第一次加入」（`follow.isFirst`）。本功能上線前已存在的 LINE 渠道身分 SHALL 視為已加入過（design D28）。

#### Scenario: 第一次加入

- **WHEN** 從未出現過的 LINE 顧客加入官方帳號為好友
- **THEN** 「第一次加入」為是，加入次數為 1

#### Scenario: 封鎖後再加入

- **GIVEN** 顧客上個月加入過官方帳號
- **WHEN** 顧客封鎖後再次加入
- **THEN** 「第一次加入」為否，加入次數為 2，最後一次加入時間更新

#### Scenario: 上線前就是好友的顧客

- **GIVEN** 顧客的 LINE 渠道身分在本功能上線前就存在
- **WHEN** 顧客封鎖後再次加入
- **THEN** 「第一次加入」為否

### Requirement: workers 的回覆動作在期限內以回覆方式送出

workers 執行由入站訊息或加入好友觸發的回覆動作（傳送訊息、傳送素材、發送優惠券）時，SHALL 取得事件的收到時間；LINE 在收到事件 30 秒內且有回覆權杖時以回覆方式送出，超過期限或回覆失敗時改用主動推送。

#### Scenario: 關鍵字規則在期限內回覆

- **GIVEN** 顧客在 LINE 傳送關鍵字，workers 在 3 秒後執行傳送素材
- **WHEN** 規則送出素材
- **THEN** 以回覆方式送出，不計入主動推送額度

#### Scenario: 回覆失敗改用主動推送

- **GIVEN** 回覆權杖已被同一則訊息的其他回覆用掉
- **WHEN** 規則送出訊息
- **THEN** 系統改以主動推送送出，顧客仍收到訊息

### Requirement: 關鍵字回覆頁保留規則上的其他動作與條件

「LINE 關鍵字回覆」頁儲存時 SHALL 只更換規則中的「傳送素材」「發送優惠券」動作與關鍵字設定，並確保有條件「對話渠道等於 LINE」；規則上的其他動作（例如加標籤）與其他條件 SHALL 保留原樣（design D25）。規則傳送的素材不是啟用中的 LINE 素材（其他渠道、已刪除或已停用）且沒有改選時，這一頁 SHALL 擋下儲存並顯示原因，列表也 SHALL 標示原因；不可加上 LINE 條件讓規則靜默失效。

#### Scenario: 編輯含其他動作的關鍵字回覆

- **GIVEN** 關鍵字規則的動作為傳送素材與加標籤「詢價」，另有條件「聯絡人標籤包含 VIP」
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則仍有加標籤「詢價」動作與「聯絡人標籤包含 VIP」條件，並多了條件「對話渠道等於 LINE」

#### Scenario: 傳送 Facebook 素材的規則不能在這頁存檔

- **GIVEN** 在一般自動化規則建立的關鍵字規則，傳送的是 Facebook 素材
- **WHEN** 管理員在 LINE 關鍵字回覆頁只改了關鍵字就儲存
- **THEN** 系統不儲存，顯示「這條規則傳送的是 Facebook 素材，請到自動化規則編輯」，規則沒有被加上 LINE 條件
- **AND** 列表的回覆素材欄標示「Facebook 素材，這頁不能編輯」並連到自動化規則編輯

#### Scenario: 素材已刪除或已停用的規則要改選素材才能存檔

- **GIVEN** 關鍵字規則傳送的素材已刪除或已停用
- **WHEN** 管理員沒有改選素材就儲存
- **THEN** 系統不儲存並說明原因；改選 LINE 素材或拿掉素材只發券後可以儲存

#### Scenario: 編輯含發券動作的關鍵字回覆

- **GIVEN** 關鍵字規則的動作為傳送素材與發送優惠券
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則仍有發送優惠券動作，`couponId` 不變
