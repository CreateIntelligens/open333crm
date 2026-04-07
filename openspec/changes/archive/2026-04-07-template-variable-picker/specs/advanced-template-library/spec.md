## MODIFIED Requirements

### Requirement: IM 互動流按鈕邏輯 (Interactive Button Logic)
LINE/FB 模板的按鈕必須支援「內建動作」。點擊按鈕除了開啟網頁外，還能直接觸發「打標籤」或「觸發下一個畫布節點」。範本編輯器 SHALL 在 contentType 為 `text` 時提供 Variable Picker 入口（其他類型如 flex、quick_reply 不在此次範圍）。

#### Scenario: 按鈕觸發標籤
- **WHEN** 用戶在 LINE 點擊「了解產品」按鈕
- **THEN** 系統立即在後台為該聯繫人加上 `interested_product` 標籤，並回覆下一則訊息
