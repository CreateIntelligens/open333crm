## ADDED Requirements

### Requirement: LINE channel 可設定單一下游 webhook 轉發
LINE channel SHALL 可在 `Channel.settings.downstreamWebhook` 設定**單一**下游轉發，欄位含 `enabled`（boolean）、`url`（string, https）、`mode`（`immediate` | `after`）、可選 `secret`。當 `enabled` 為 false 或未設定時，系統 MUST 維持現有行為、不進行任何轉發。設定更新路徑 MUST 以 schema 驗證：`url` MUST 為 `https`，`mode` MUST 為 `immediate` 或 `after`。

#### Scenario: 未設定時行為不變
- **WHEN** LINE channel 未設定 `downstreamWebhook` 或 `enabled=false`
- **THEN** webhook 依現有流程處理，且不發出任何下游請求

#### Scenario: 驗證無效設定
- **WHEN** admin 以非 https 的 `url` 或非法 `mode` 更新 `downstreamWebhook`
- **THEN** 更新被拒絕並回傳驗證錯誤，設定不被寫入

### Requirement: 轉發原始 payload 與 LINE 標頭
啟用時，系統 SHALL 將**原封不動的原始 request body（rawBody bytes）**轉發到設定的 `url`，且 MUST 保留原始 `Content-Type` 與 `x-line-signature` 標頭，使下游能以 LINE channel secret 自行驗證簽章。系統 MUST NOT 以重新序列化後的內容取代原始 body。

#### Scenario: 下游可驗證 LINE 簽章
- **WHEN** 一則通過驗證的 LINE webhook 被轉發到下游
- **THEN** 下游收到與 LINE 原始請求相同的 body bytes 與 `x-line-signature`，可用相同 secret 驗證通過

### Requirement: immediate 模式先轉發並短路後續處理
當 `mode` 為 `immediate` 時，系統 SHALL 在簽章驗證通過後先觸發背景轉發，然後**短路**——MUST NOT 執行 `parseWebhook` 或 `processInboundMessage`（不建立聯絡人/對話/訊息、不觸發 canvas/自動回覆等後續動作）。

#### Scenario: immediate 模式後續不動作
- **WHEN** LINE channel 設定 `mode=immediate` 且收到有效 webhook
- **THEN** 系統把原始 payload 背景轉發到下游，且**不執行**任何 CRM inbound 處理（無新訊息記錄、無 socket 事件）

### Requirement: after 模式先處理後轉發並續行
當 `mode` 為 `after` 時，系統 SHALL 照常執行既有 CRM inbound 處理，並在處理完成後觸發背景轉發（後續繼續動作）。轉發失敗 MUST NOT 影響已完成的 CRM 處理結果。

#### Scenario: after 模式續行且旁送下游
- **WHEN** LINE channel 設定 `mode=after` 且收到有效 webhook
- **THEN** 系統照常建立訊息並執行既有後續動作，且另外把原始 payload 背景轉發到下游

#### Scenario: after 模式下游失敗不影響 CRM
- **WHEN** `mode=after` 且下游轉發失敗
- **THEN** CRM 的 inbound 處理結果不受影響，失敗被忽略

### Requirement: 對 LINE 立即回應不受轉發影響
不論是否啟用下游轉發或採何模式，系統 MUST 對 LINE 立即回應 HTTP 200，且下游轉發 MUST 以背景（fire-and-forget）執行、不阻塞該回應。

#### Scenario: 轉發不阻塞 200
- **WHEN** 下游端點緩慢或逾時
- **THEN** LINE 仍即時收到 HTTP 200，轉發於背景重試/逾時處理

### Requirement: 僅轉發通過簽章驗證的請求
系統 MUST 僅在 LINE `x-line-signature` 簽章驗證通過後才進行下游轉發。簽章驗證失敗的請求 MUST NOT 被轉發。

#### Scenario: 簽章失敗不轉發
- **WHEN** 收到 `x-line-signature` 驗證失敗的請求
- **THEN** 系統拒絕該請求且不發出任何下游轉發

### Requirement: 下游轉發為背景 best-effort 且不追蹤結果
下游轉發 SHALL 以背景 fire-and-forget 執行，且 MUST NOT 讀取或依賴下游的回應內容與 HTTP 狀態、MUST NOT 因下游結果而重試或改變 CRM 流程。系統 SHALL 套用逾時（預設 10 秒）以避免資源懸掛。任何轉發相關日誌 MUST NOT 記錄 webhook body 內容。

#### Scenario: 忽略下游回應與失敗
- **WHEN** 下游回傳錯誤狀態、逾時或無回應
- **THEN** 系統不重試、不追蹤該結果，且不改變已決定的 CRM 行為（immediate 仍短路、after 仍已完成處理）

### Requirement: 防止下游回送造成無限轉發迴圈
因為系統轉發**原封 raw body 與有效 `x-line-signature`**，若下游將其回送至本 webhook 端點會再次通過簽章驗證並被重複轉發，形成無限迴圈與流量放大。系統 MUST 為每個 LINE 事件記錄冪等識別碼（優先 `webhookEventId`，退回 `replyToken`）於具 TTL 的共享儲存（Redis），並在一個 payload 的**所有事件皆為已見**時 MUST NOT 再次轉發（判定為回送）；至少一個事件為新事件時才轉發。此檢查於 `immediate` 與 `after` 兩模式的轉發前皆適用。

#### Scenario: 下游回送被丟棄
- **WHEN** 下游把先前已轉發過的相同 payload 回送到本 webhook 端點（其事件識別碼皆已記錄）
- **THEN** 系統不再轉發該 payload（記錄 loopback 日誌），無限迴圈中止

#### Scenario: 正常新事件仍轉發
- **WHEN** 收到含新 `webhookEventId` 的 LINE 事件
- **THEN** 系統記錄其識別碼並正常轉發

#### Scenario: 儲存不可用時不阻斷轉發
- **WHEN** 冪等儲存（Redis）暫時不可用
- **THEN** 系統記錄警告並仍進行轉發（fail-open，不因儲存故障使功能整體停擺）

### Requirement: 下游 URL 之 SSRF 防護
系統 MUST 僅允許具 admin 權限者設定下游 `url`，且在送出前 MUST 拒絕指向 loopback、私有、link-local 或其他保留位址的目標，並要求 `https`。

#### Scenario: 封鎖內網目標
- **WHEN** 下游 `url` 解析後指向內網/保留位址（如 127.0.0.1、10.0.0.0/8、169.254.0.0/16）
- **THEN** 系統不發出該請求並記錄一則封鎖日誌
