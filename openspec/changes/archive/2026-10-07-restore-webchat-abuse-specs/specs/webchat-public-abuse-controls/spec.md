## ADDED Requirements

### Requirement: 舊的工作階段路由預設停用

`WEBCHAT_LEGACY_ROUTES_ENABLED` 不是 `true` 時，`POST /api/v1/webchat/:channelId/sessions` SHALL 回 410，錯誤碼是 `WEBCHAT_LEGACY_ROUTE_RETIRED`。這時路由不查詢渠道，也不建立工作階段。

這個變數是 `true` 時，路由 SHALL 以 `POST /api/v1/chatbox/sessions` 相同的流程建立 chatbox 工作階段（見 `webchat-secure-session`）。路由 SHALL NOT 使用請求帶來的 `visitorToken`。

#### Scenario: 以預設設定呼叫舊的工作階段路由
- **WHEN** 沒有設定 `WEBCHAT_LEGACY_ROUTES_ENABLED`，訪客呼叫 `POST /api/v1/webchat/:channelId/sessions`，body 帶 `visitorToken`
- **THEN** API 回 410 `WEBCHAT_LEGACY_ROUTE_RETIRED`，不查詢渠道，不建立工作階段

#### Scenario: 啟用舊的工作階段路由
- **WHEN** `WEBCHAT_LEGACY_ROUTES_ENABLED` 是 `true`，訪客呼叫 `POST /api/v1/webchat/:channelId/sessions`，body 帶 `visitorToken`
- **THEN** API 建立 chatbox 工作階段並回傳 `sessionId`，建立工作階段時不使用 body 的 `visitorToken`

### Requirement: 公開請求的大小限制

API SHALL 在儲存訊息或檔案之前，拒絕超過下列限制的公開 WebChat 請求：

- 文字訊息最多 4000 個字元。超過時回 400。
- 訊息請求的 body 最多 128 KB。超過時回 413。
- 上傳只接受 PNG、JPEG、MP4 與 MOV。圖片最多 20 MB，影片最多 25 MB。不符合時回 400 或 413。

這些限制適用於 `/api/v1/chatbox/*` 與 `/api/v1/webchat/:channelId/*` 的訊息與上傳路由。

#### Scenario: 文字訊息超過 4000 個字元
- **WHEN** 訪客送出 4001 個字元的文字訊息
- **THEN** API 回 400，不把訊息交給進站處理

#### Scenario: 訊息請求的 body 超過 128 KB
- **WHEN** 訪客送出 body 超過 128 KB 的訊息請求
- **THEN** API 回 413，不驗證工作階段，不把訊息交給進站處理

#### Scenario: 上傳的檔案類型不支援
- **WHEN** 訪客上傳 PNG、JPEG、MP4、MOV 以外的檔案
- **THEN** API 回 400，不儲存檔案

#### Scenario: 上傳的檔案超過大小上限
- **WHEN** 訪客上傳超過 20 MB 的圖片，或超過 25 MB 的影片
- **THEN** API 回 400 或 413，不儲存檔案

### Requirement: 工作階段的有效期限最長三天

公開 WebChat 工作階段的有效期限 SHALL NOT 超過三天：

- API 啟動時的環境變數驗證拒絕大於 4320 分鐘的 `CHATBOX_SESSION_TTL_MINUTES`，API 不啟動。
- 計算新工作階段的有效期限時，系統另外把有效期限限制在三天內。這是第二道檢查：環境變數驗證沒有執行時，例如程式直接呼叫計算函式，有效期限仍不超過三天。

#### Scenario: 設定的有效期限超過三天
- **WHEN** API 的環境變數 `CHATBOX_SESSION_TTL_MINUTES` 是 4321
- **THEN** 環境變數驗證失敗，錯誤訊息指出 `CHATBOX_SESSION_TTL_MINUTES`

#### Scenario: 建立工作階段時的有效期限
- **WHEN** 環境變數驗證沒有執行，`CHATBOX_SESSION_TTL_MINUTES` 是四天的分鐘數，系統計算新工作階段的有效期限
- **THEN** 有效期限是三天

### Requirement: 訊息與上傳請求的頻率限制

API SHALL 計算公開的訊息與上傳請求次數。每種請求的計數範圍如下：

- 訊息：每個來源 IP、每個工作階段、每個渠道各有每分鐘的上限；每個工作階段、每個渠道另有每小時的上限。每小時的上限用來控制訪客能觸發多少自動化與 AI 工作。
- 上傳：每個來源 IP、每個工作階段各有每分鐘的上限。訊息與上傳的來源 IP 上限分開計算。

超過上限時，API 回 429，錯誤碼是 `RATE_LIMITED`，帶 `Retry-After` 標頭，不把訊息交給進站處理，也不儲存檔案。這些限制適用於 `/api/v1/chatbox/*` 與 `/api/v1/webchat/:channelId/*` 的訊息與上傳路由。

#### Scenario: 同一個來源 IP 的訊息超過每分鐘上限
- **WHEN** 同一個來源 IP 在一分鐘內，以不同的工作階段送出超過上限的訊息
- **THEN** 超過上限的請求得到 429 `RATE_LIMITED` 與 `Retry-After`，API 不驗證工作階段，不把訊息交給進站處理

#### Scenario: 同一個工作階段的訊息超過每分鐘上限
- **WHEN** 同一個 `sessionId` 在一分鐘內，從不同的來源 IP 送出超過上限的訊息請求，而且這些請求的工作階段驗證失敗
- **THEN** 超過上限的請求得到 429 `RATE_LIMITED`，API 不再驗證工作階段，也不把訊息交給進站處理

#### Scenario: 同一個渠道的訊息超過每分鐘上限
- **WHEN** 同一個渠道在一分鐘內，收到不同來源 IP、不同工作階段送出的訊息，總數超過上限
- **THEN** 超過上限的請求得到 429 `RATE_LIMITED`，API 不把訊息交給進站處理

#### Scenario: 同一個工作階段的訊息超過每小時上限
- **WHEN** 同一個工作階段在一小時內送出超過每小時上限的訊息，每分鐘都沒有超過每分鐘上限
- **THEN** 超過上限的請求得到 429 `RATE_LIMITED`，API 不把訊息交給進站處理，所以不觸發自動化或 AI

#### Scenario: 同一個渠道的訊息超過每小時上限
- **WHEN** 同一個渠道在一小時內收到超過每小時上限的訊息，每分鐘都沒有超過每分鐘上限
- **THEN** 超過上限的請求得到 429 `RATE_LIMITED`，API 不把訊息交給進站處理

#### Scenario: 上傳超過每分鐘上限
- **WHEN** 同一個來源 IP，或同一個工作階段，在一分鐘內上傳超過上限的檔案
- **THEN** 超過上限的請求得到 429 `RATE_LIMITED`，API 不儲存檔案

#### Scenario: 訊息達到來源 IP 的上限後仍可上傳
- **WHEN** 同一個來源 IP 在一分鐘內送出的訊息，已經超過上傳的每分鐘上限，但沒有超過訊息的每分鐘上限
- **THEN** 這個來源 IP 上傳檔案時，API 不因頻率限制拒絕

### Requirement: 建立工作階段與訪客 socket 連線的頻率限制

API SHALL 限制每個來源 IP 每分鐘建立工作階段的次數。這個限制適用於 `POST /api/v1/chatbox/sessions` 與舊的工作階段路由。超過上限時，API 回 429，帶 `Retry-After` 標頭，不建立工作階段、聯絡人或對話。

API SHALL 限制每個來源 IP 每分鐘連線 `/visitor` 命名空間的次數。超過上限時，API 拒絕連線，不驗證工作階段。

#### Scenario: 同一個來源 IP 建立工作階段超過上限
- **WHEN** 同一個來源 IP 在一分鐘內，呼叫 `POST /api/v1/chatbox/sessions` 的次數超過上限
- **THEN** 超過上限的請求得到 429 與 `Retry-After`，API 不建立工作階段

#### Scenario: 同一個來源 IP 的訪客 socket 連線超過上限
- **WHEN** 同一個來源 IP 在一分鐘內連線 `/visitor` 的次數超過上限
- **THEN** API 拒絕超過上限的連線，不驗證工作階段

### Requirement: 頻率限制的計數鍵與日誌不含原始的工作階段憑證

API SHALL 以 SHA-256 摘要作為頻率限制的計數鍵，計數鍵不包含原始的 `sessionId` 或來源 IP。

API 因頻率限制拒絕請求時，SHALL 寫一筆 warn 等級的日誌。日誌包含請求 ID 與計數鍵，不包含原始的 `sessionId` 或 claim token。

#### Scenario: 以工作階段計數
- **WHEN** API 以 `sessionId` 計算請求次數
- **THEN** 計數鍵是摘要，不包含 `sessionId`

#### Scenario: 請求因頻率限制被拒絕
- **WHEN** API 因工作階段的每分鐘上限，拒絕訪客的訊息請求
- **THEN** API 寫一筆 warn 日誌，包含請求 ID 與計數鍵，不包含這個請求的 `sessionId` 與 claim token
