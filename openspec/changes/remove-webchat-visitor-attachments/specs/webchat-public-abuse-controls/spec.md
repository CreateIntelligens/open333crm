## REMOVED Requirements

### Requirement: 公開請求的大小限制
**Reason**: 訪客上傳路由停用（見 `webchat-widget` 的「Visitor upload routes are disabled」），上傳的類型與大小限制不再適用。需求改寫為「公開訊息請求的大小限制」。
**Migration**: 無。

### Requirement: 訊息與上傳請求的頻率限制
**Reason**: 訪客上傳路由停用，上傳的頻率限制不再適用。需求改寫為「訊息請求的頻率限制」。
**Migration**: 無。

## ADDED Requirements

### Requirement: 公開訊息請求的大小限制

API SHALL 在儲存訊息之前，拒絕超過下列限制的公開 WebChat 訊息請求：

- 文字訊息最多 4000 個字元。超過時回 400。
- 訊息請求的 body 最多 128 KB。超過時回 413。

這些限制適用於 `/api/v1/chatbox/*` 與 `/api/v1/webchat/:channelId/*` 的訊息路由。

#### Scenario: 文字訊息超過 4000 個字元
- **WHEN** 訪客送出 4001 個字元的文字訊息
- **THEN** API 回 400，不把訊息交給進站處理

#### Scenario: 訊息請求的 body 超過 128 KB
- **WHEN** 訪客送出 body 超過 128 KB 的訊息請求
- **THEN** API 回 413，不驗證工作階段，不把訊息交給進站處理

### Requirement: 訊息請求的頻率限制

API SHALL 計算公開的訊息請求次數。每個來源 IP、每個工作階段、每個渠道各有每分鐘的上限；每個工作階段、每個渠道另有每小時的上限。每小時的上限用來控制訪客能觸發多少自動化與 AI 工作。

超過上限時，API 回 429，錯誤碼是 `RATE_LIMITED`，帶 `Retry-After` 標頭，不把訊息交給進站處理。這些限制適用於 `/api/v1/chatbox/*` 與 `/api/v1/webchat/:channelId/*` 的訊息路由。

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
