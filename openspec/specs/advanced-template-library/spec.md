## ADDED Requirements

### Requirement: Email 拖拉式編輯器資料模型
系統必須能儲存與渲染基於 Block-based JSON 的 Email 模板。該模型必須能導出為 MJML 格式。

#### Scenario: 渲染 Email 模板
- **WHEN** 系統執行 Email 發送任務
- **THEN** 系統讀取 Block JSON，轉換為 MJML，最終生成標準 HTML 並寄出

### Requirement: IM 互動流按鈕邏輯 (Interactive Button Logic)
LINE/FB 模板的按鈕必須支援「內建動作」。點擊按鈕除了開啟網頁外，還能直接觸發「打標籤」或「觸發下一個畫布節點」。

#### Scenario: 按鈕觸發標籤
- **WHEN** 用戶在 LINE 點擊「了解產品」按鈕
- **THEN** 系統立即在後台為該聯繫人加上 `interested_product` 標籤，並回覆下一則訊息

### Requirement: WhatsApp HSM 審核代辦
系統必須提供與 Meta Graph API 的對接，自動提交 WhatsApp 模板進行審核。

#### Scenario: 提交審核
- **WHEN** 管理員在後台完成 WhatsApp 模板編輯並點擊「提交審核」
- **THEN** 系統呼叫 Meta API 並將該模板狀態設為 `PENDING_REVIEW`
