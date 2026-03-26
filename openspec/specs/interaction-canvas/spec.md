## ADDED Requirements

### Requirement: 節點執行引擎 (Node Execution Engine)
系統必須具備一套能解析 JSON 節點並按順序執行的引擎。引擎必須支援「等待 (Wait)」節點，且能處理非同步事件。

#### Scenario: 執行簡單的訊息發送流
- **WHEN** 聯繫人觸發流程且當前節點為「發送訊息」
- **THEN** 系統必須呼叫對應通路的 API 發送訊息，並將聯繫人狀態更新至下一個節點

### Requirement: 智慧時間窗口 (Smart Window Scheduling)
系統必須允許在發送訊息前檢查用戶的「智慧窗口」。若當前時間為深夜（預設 22:00~08:00），發送任務必須推遲至下一個活躍時段。

#### Scenario: 避開深夜發送
- **WHEN** 任務預定在凌晨 02:00 執行且開啟了智慧窗口
- **THEN** 系統必須將執行時間推遲至當天早上 09:00

### Requirement: API 資料抓取節點 (API Fetch Node)
系統必須支援在畫布中呼叫外部 HTTP API，並將回傳的 JSON 資料映射至流程變數中。

#### Scenario: 抓取折價券碼
- **WHEN** 流程執行到 API Fetch 節點
- **THEN** 系統發送 POST 請求至指定 URL，並將回傳的 `coupon_code` 存入 `{{ext.coupon_code}}` 變數中
