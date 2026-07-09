## ADDED Requirements

### Requirement: 任一 channel 可設定單一下游 webhook 轉發
任一 channel（不限 LINE）SHALL 可在 `Channel.settings.downstreamWebhook` 設定**單一**下游轉發，欄位含 `enabled`（boolean）、`url`（string, https）、`mode`（`immediate` | `after`），可選 `timeoutMs`。當 `enabled` 為 false 或未設定時，系統 MUST 維持現有行為、不進行任何轉發。設定更新路徑 MUST 以 schema 驗證：`url` MUST 為 `https`，`mode` MUST 為 `immediate` 或 `after`。

#### Scenario: 未設定時行為不變
- **WHEN** channel 未設定 `downstreamWebhook` 或 `enabled=false`
- **THEN** webhook 依現有流程處理，且不發出任何下游請求

#### Scenario: 任一 channel 皆可轉發
- **WHEN** 任一類型的 channel（LINE、FB、Telegram…）設定並啟用 `downstreamWebhook`
- **THEN** 該 channel 收到 webhook 時依設定進行下游轉發

#### Scenario: 驗證無效設定
- **WHEN** admin 以非 https 的 `url` 或非法 `mode` 更新 `downstreamWebhook`
- **THEN** 更新被拒絕並回傳驗證錯誤，設定不被寫入

### Requirement: 原封轉發原始 header 與 body
啟用時，系統 SHALL 將**原封不動的原始 request body（rawBody bytes）與原始 request 標頭**轉發到設定的 `url`。系統 MUST NOT 新增自訂標頭、MUST NOT 對內容加簽、MUST NOT 改寫 `Content-Type`、MUST NOT 以重新序列化後的內容取代原始 body；僅 MAY 移除必須由傳輸層重設的標頭（`host`、`content-length`）。如此下游可收到與來源平台相同的請求，並以原始簽章標頭自行驗證。

#### Scenario: 下游收到原封請求
- **WHEN** 一則通過驗證的 webhook 被轉發到下游
- **THEN** 下游收到與來源相同的 body bytes 與原始標頭（含原始簽章標頭與 `Content-Type`），且無任何本系統新增的標頭或簽章

### Requirement: immediate 模式先轉發並短路後續處理
當 `mode` 為 `immediate` 時，系統 SHALL 在簽章驗證通過後先觸發背景轉發，然後**短路**——MUST NOT 執行 `parseWebhook` 或 `processInboundMessage`（不建立聯絡人/對話/訊息、不觸發 canvas/自動回覆等後續動作）。

#### Scenario: immediate 模式後續不動作
- **WHEN** channel 設定 `mode=immediate` 且收到有效 webhook
- **THEN** 系統把原始 payload 背景轉發到下游，且**不執行**任何 inbound 處理（無新訊息記錄、無 socket 事件）

### Requirement: after 模式先處理後轉發並續行
當 `mode` 為 `after` 時，系統 SHALL 照常執行既有 inbound 處理，並在處理完成後觸發背景轉發（後續繼續動作）。轉發失敗 MUST NOT 影響已完成的處理結果。

#### Scenario: after 模式續行且旁送下游
- **WHEN** channel 設定 `mode=after` 且收到有效 webhook
- **THEN** 系統照常建立訊息並執行既有後續動作，且另外把原始 payload 背景轉發到下游

#### Scenario: after 模式下游失敗不影響處理
- **WHEN** `mode=after` 且下游轉發失敗
- **THEN** inbound 處理結果不受影響，失敗被忽略

### Requirement: 對來源平台立即回應不受轉發影響
不論是否啟用下游轉發或採何模式，系統 MUST 對來源平台維持既有的即時回應（webhook route 於處理前即回應），且下游轉發 MUST 以背景（fire-and-forget）執行、不阻塞該回應。

#### Scenario: 轉發不阻塞回應
- **WHEN** 下游端點緩慢或逾時
- **THEN** 來源平台仍即時收到既有回應，轉發於背景逾時處理

### Requirement: 僅轉發通過簽章驗證的請求
系統 MUST 僅在該 channel 的 webhook 簽章驗證通過後才進行下游轉發。簽章驗證失敗的請求 MUST NOT 被轉發。

#### Scenario: 簽章失敗不轉發
- **WHEN** 收到簽章驗證失敗的請求
- **THEN** 系統拒絕該請求且不發出任何下游轉發

### Requirement: 下游轉發為背景 best-effort 且不追蹤結果
下游轉發 SHALL 以背景 fire-and-forget 執行，且 MUST NOT 讀取或依賴下游的回應內容與 HTTP 狀態、MUST NOT 因下游結果而重試或改變處理流程。系統 SHALL 套用逾時（預設 10 秒）以避免資源懸掛。任何轉發相關日誌 MUST NOT 記錄 webhook body 內容。

#### Scenario: 忽略下游回應與失敗
- **WHEN** 下游回傳錯誤狀態、逾時或無回應
- **THEN** 系統不重試、不追蹤該結果，且不改變已決定的處理行為（immediate 仍短路、after 仍已完成處理）

### Requirement: 防止下游回送造成無限轉發迴圈
因為系統轉發**原封 raw body 與有效簽章標頭**，若下游將其回送至本 webhook 端點會再次通過簽章驗證並被重複轉發，形成無限迴圈與流量放大。系統 MUST 為每則 payload 記錄冪等識別碼於具 TTL 的共享儲存（Redis，TTL 一天）：LINE payload 以每事件 `webhookEventId`（退回 `replyToken`）為鍵，其他 channel／無事件者退回**原始 body bytes 之雜湊**。當一則 payload 的**所有識別碼皆為已見**時 MUST NOT 再次轉發（判定為回送）；至少一個為新識別碼時才轉發。此檢查於 `immediate` 與 `after` 兩模式的轉發前皆適用。

#### Scenario: 下游回送被丟棄（LINE 事件鍵）
- **WHEN** 下游把先前已轉發過的相同 LINE payload 回送到本端點（其事件識別碼皆已記錄）
- **THEN** 系統不再轉發該 payload（記錄 loopback 日誌），無限迴圈中止

#### Scenario: 非 LINE channel 以 body 雜湊擋回送
- **WHEN** 非 LINE channel 的相同 payload（無可解析事件 id）被下游原封回送
- **THEN** 系統以 body 雜湊判定為已見並不再轉發，迴圈中止

#### Scenario: 儲存不可用時不阻斷轉發
- **WHEN** 冪等儲存（Redis）暫時不可用
- **THEN** 系統記錄警告並仍進行轉發（fail-open，不因儲存故障使功能整體停擺）

### Requirement: 下游 URL 之 SSRF 防護
系統 MUST 僅允許具 admin 權限者設定下游 `url`，且在送出前 MUST 拒絕指向 loopback、私有、link-local 或其他保留位址的目標，並要求 `https`。

#### Scenario: 封鎖內網目標
- **WHEN** 下游 `url` 解析後指向內網/保留位址（如 127.0.0.1、10.0.0.0/8、169.254.0.0/16）
- **THEN** 系統不發出該請求並記錄一則封鎖日誌
