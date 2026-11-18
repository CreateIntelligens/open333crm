## ADDED Requirements

### Requirement: 留言自動私訊是方案功能
`comment_reply` SHALL 是方案可開關的 feature，`comment_reply.view` 與 `comment_reply.manage` 屬於它，平台在 `/admin/plans` 勾選。既有方案 SHALL 預設不含。方案不含時，留言自動私訊的路由 SHALL 回 403，背景的收件與送出 SHALL 依「不處理的留言不留紀錄」與「送出前重新檢查」處理。

#### Scenario: 部署後既有方案都不含
- **WHEN** 部署本功能後讀所有既有方案
- **THEN** 沒有任何方案的 features 含 `comment_reply`

#### Scenario: 方案不含時路由被擋
- **WHEN** 角色有 `comment_reply.view`、租戶方案不含 `comment_reply`，呼叫 `GET /api/v1/comment-replies/rules`
- **THEN** 回應 403，錯誤指出是方案未包含

#### Scenario: 平台勾選後可用
- **WHEN** 平台在方案勾選 `comment_reply`，該方案租戶的管理者呼叫 `GET /rules`
- **THEN** 回應 200

### Requirement: 平台設定留言自動私訊的方案上限
`/admin/plans` SHALL 顯示「留言規則數（啟用中）」與「每月留言私訊數」兩個上限欄位，對應 `maxCommentReplyRules` 與 `monthlyCommentReplies`；留空存成 null，表示無上限。

#### Scenario: 設定上限並讀回
- **WHEN** 平台管理員把方案的 `maxCommentReplyRules` 設為 10、`monthlyCommentReplies` 留空並儲存
- **THEN** 讀回方案的 `limits.maxCommentReplyRules` 是 10，`limits.monthlyCommentReplies` 是 null

### Requirement: 平台設定鍵有型別檢查
`PUT /api/v1/platform/settings/:key` 對 `commentReply.capabilities`、`commentReply.testPhase`、`commentReply.emergencyStop`、`commentReply.rateLimits`、`commentReply.logRetentionDays` SHALL 驗證型別與範圍（限速 1～30000、保存天數 30～730）；不合法時回 400 且不寫入。合法寫入 SHALL 記 `setting.update` 平台稽核。沒有設定的鍵 SHALL 用預設值：能力全關、測試階段開、未緊急停止、限速 700／700／300、保存 180 天。

#### Scenario: 寫入合法的能力開關
- **WHEN** 平台管理員以 `PUT /platform/settings/commentReply.capabilities` 送六個布林值
- **THEN** 回應 200，平台稽核有一筆 `setting.update`、`targetId` 是 `commentReply.capabilities`

#### Scenario: 寫入不合法的值
- **WHEN** 送 `commentReply.logRetentionDays` 為 `5`，或 `commentReply.capabilities` 少一個欄位
- **THEN** 回應 400，設定不變

#### Scenario: 沒有設定時的預設
- **WHEN** 平台從未設定任何 `commentReply.*` 鍵，租戶呼叫 readiness
- **THEN** 所有能力都是 false、`testPhase` 的 fb 與 ig 都是 true、`emergencyStopped` 是 false

### Requirement: 平台能力開關由前後端共同遵守
平台的能力開關（FB／IG 各自的私訊、貼文挑選、公開回覆）SHALL 同時決定前端顯示與後端行為：私訊能力關閉時，該平台的留言不建紀錄、已排隊的工作記 `SKIPPED`／`CAPABILITY_DISABLED`、不可建立該平台規則（403 `CAPABILITY_DISABLED`）；公開回覆能力關閉時，已開公開回覆的規則送出時公開回覆記 `SKIPPED`／`CAPABILITY_DISABLED`。

#### Scenario: IG 私訊尚未開放
- **WHEN** `igPrivateReply` 為 false，成員建立 IG 規則
- **THEN** 回應 403，`error.code` 是 `CAPABILITY_DISABLED`，`details.capability` 是 `igPrivateReply`

#### Scenario: 關閉私訊能力後的排隊工作
- **WHEN** FB 紀錄排隊期間平台把 `fbPrivateReply` 改為 false，之後工作執行
- **THEN** 不呼叫 Meta，紀錄是 `SKIPPED`、原因 `CAPABILITY_DISABLED`

#### Scenario: 關閉公開回覆能力後送出
- **WHEN** 規則已開公開回覆，平台把 `fbPublicReply` 改為 false，之後私訊成功
- **THEN** 沒有公開回覆呼叫，`publicReplyStatus` 是 `SKIPPED`、原因 `CAPABILITY_DISABLED`

#### Scenario: 前端隱藏未開放的能力
- **WHEN** readiness 回傳 `fbPostPicker` 為 false
- **THEN** 規則編輯頁沒有「從最近貼文挑選」，只能手動填貼文 ID

### Requirement: 測試階段旗標
平台的測試階段旗標（FB、IG 各一）SHALL 只影響顯示與錯誤對照：開啟時，該平台的平台模式渠道在列表頁與規則編輯頁顯示「測試階段」說明，權限類錯誤記為 `APP_NOT_APPROVED`；SHALL NOT 阻擋收件或送出。自備 App 或手動權杖的渠道 SHALL NOT 顯示測試階段，改顯示依自己 App 的審核狀態。

#### Scenario: 關閉測試階段
- **WHEN** 平台把 `testPhase.fb` 改為 false
- **THEN** readiness 回 `testPhase.fb` 為 false，頁面不顯示 FB 的測試階段卡

#### Scenario: 測試階段不擋送出
- **WHEN** `testPhase.fb` 為 true、`fbPrivateReply` 為 true，FB 留言命中規則
- **THEN** 系統呼叫 Meta 送出私訊

### Requirement: 緊急停止
平台開啟緊急停止時，系統 SHALL 在 60 秒內停止所有租戶的留言處理：留言不建紀錄、已排隊的工作記 `SKIPPED`／`EMERGENCY_STOPPED`、不呼叫 Meta；webhook 照常回 200，私訊收發不受影響。租戶頁面 SHALL 顯示平台暫停中並停用編輯。

#### Scenario: 緊急停止後的留言
- **WHEN** 平台開啟緊急停止，之後收到命中規則的留言
- **THEN** webhook 回 200，不產生紀錄

#### Scenario: 緊急停止時已排隊的工作
- **WHEN** 紀錄排隊期間平台開啟緊急停止，之後工作執行
- **THEN** 不呼叫 Meta，紀錄是 `SKIPPED`、原因 `EMERGENCY_STOPPED`

#### Scenario: 緊急停止不影響私訊
- **WHEN** 緊急停止期間顧客傳私訊給粉專
- **THEN** 私訊照常進收件匣

### Requirement: 平台留言自動私訊頁
平台後台 SHALL 有 `/admin/comment-reply` 頁，提供設定區（能力開關、測試階段、緊急停止、限速、保存天數，以表單儲存）與健康區。健康區 SHALL 由 `GET /api/v1/platform/comment-reply/health` 提供：每個開啟留言接收的渠道的租戶、渠道、連結模式、訂閱狀態與檢查時間、權杖狀態、最後收到留言時間、啟用規則數、24 小時送出／失敗／排隊數與最常見失敗原因；以及全平台 24 小時命中數、送出數、失敗率、佇列數量與最舊的處理中時間。這支 API SHALL NOT 呼叫 Meta。

#### Scenario: 健康表只列開啟接收的渠道
- **WHEN** 平台有 3 個 FB 渠道，其中 1 個開啟留言接收，平台管理員呼叫 health
- **THEN** 渠道清單只有那 1 個，且假 Graph API 沒有收到任何呼叫

#### Scenario: 非平台身分
- **WHEN** 以租戶成員的 token 呼叫 `GET /api/v1/platform/comment-reply/health`
- **THEN** 回應 401 或 403，不回傳資料

#### Scenario: 從頁面存設定
- **WHEN** 平台管理員在 `/admin/comment-reply` 打開 `fbPrivateReply` 並儲存
- **THEN** 前端以 `PUT /platform/settings/commentReply.capabilities` 送出六個布林值，重新載入後開關維持開啟

### Requirement: 留言自動私訊的維運告警
系統 SHALL 每 5 分鐘統計並發出維運告警：15 分鐘內同一渠道權杖失效或權限不足的失敗達 3 筆（另通知租戶管理員）；15 分鐘內同一渠道失敗達 20 筆且超過 50%（不含使用者端原因）；非排隊中的 `PENDING` 超過 30 分鐘；處理中的留言時間超過 6 天。同一告警依既有合併規則合併。

#### Scenario: 權杖連續失效
- **WHEN** 15 分鐘內同一渠道有 3 筆 `TOKEN_EXPIRED`
- **THEN** 發出 `comment-reply-auth:<channelId>` 告警，租戶管理員收到通知

#### Scenario: 卡住的處理中紀錄
- **WHEN** 有一筆 `PENDING` 紀錄超過 30 分鐘沒有進展，原因不是 `RATE_LIMIT_QUEUED`
- **THEN** 發出 `comment-reply-stuck` 告警

#### Scenario: 限流排隊不告警
- **WHEN** 只有原因 `RATE_LIMIT_QUEUED` 的 `PENDING` 紀錄超過 30 分鐘
- **THEN** 沒有 `comment-reply-stuck` 告警

### Requirement: 觸發紀錄的保存期限
系統 SHALL 每小時刪除建立時間早於平台設定保存天數（預設 180 天）的觸發紀錄，分批進行；刪除後對話的留言來源 SHALL 變為空。每月用量 SHALL 保留 25 個月。

#### Scenario: 超過保存天數的紀錄
- **WHEN** 保存天數是 180，有一筆 181 天前與一筆 179 天前的紀錄，清除執行
- **THEN** 181 天前的紀錄被刪除、它關聯的對話的來源是 null；179 天前的紀錄仍在
