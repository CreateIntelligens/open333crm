## ADDED Requirements

### Requirement: 渠道列表讀取失敗時不顯示成沒有渠道
渠道管理頁讀取 `GET /api/v1/channels` 失敗時 SHALL 顯示錯誤，MUST NOT 顯示「沒有渠道」的空狀態與新增按鈕。回 403 時 SHALL 顯示「沒有權限」並說明需要「檢視渠道」權限與含渠道功能的方案，不顯示「重新載入」。其他錯誤 SHALL 顯示錯誤原因與「重新載入」按鈕。

#### Scenario: 沒有檢視權限時顯示無權限訊息
- **WHEN** 渠道列表回 403，`error.details.requiredPermission` 為 `channel.view`
- **THEN** 頁面顯示含「沒有權限」與「檢視渠道」的提示，不顯示「沒有渠道」與「新增您的第一個渠道」

#### Scenario: 列表讀取失敗時顯示錯誤與重新載入
- **WHEN** 渠道列表回 500，訊息為「系統發生錯誤，請稍後重試」
- **THEN** 頁面顯示這個訊息與「重新載入」按鈕，不顯示「沒有渠道」
- **AND** 按「重新載入」重新讀取列表

### Requirement: 沒有新增權限時不顯示新增渠道的操作
渠道管理頁 SHALL 只對有 `channel.create` 的成員顯示「新增渠道」「設定精靈」與 Facebook 連結按鈕。有效權限依方案天花板計算，方案不含 `channels` 時這些按鈕也不顯示。

#### Scenario: 沒有新增權限時不顯示新增按鈕
- **WHEN** 成員沒有 `channel.create`，租戶沒有渠道
- **THEN** 頁面顯示「沒有渠道」，但不顯示「新增渠道」與「設定精靈」按鈕
