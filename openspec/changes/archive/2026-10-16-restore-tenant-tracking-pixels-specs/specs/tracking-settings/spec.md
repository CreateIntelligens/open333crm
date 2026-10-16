## ADDED Requirements

### Requirement: 讀取追蹤設定

`GET /api/v1/settings/tracking` SHALL 回傳目前租戶的 `gaId` 與 `metaPixelId`。沒有設定的欄位 SHALL 是 `null`。呼叫的成員 SHALL 有 `settings.manage`，沒有時系統回 HTTP 403。

#### Scenario: 讀取已設定的 ID
- **WHEN** 租戶設定了 `gaId` 為 `G-ABC123XYZ9`，`metaPixelId` 沒有設定，有 `settings.manage` 的成員送出 `GET /api/v1/settings/tracking`
- **THEN** 系統回 HTTP 200，`gaId` 是 `G-ABC123XYZ9`，`metaPixelId` 是 `null`

#### Scenario: 沒有 settings.manage 不能讀取
- **WHEN** 沒有 `settings.manage` 的成員送出 `GET /api/v1/settings/tracking`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `settings.manage`

### Requirement: 更新追蹤設定

`PUT /api/v1/settings/tracking` SHALL 同時取代 `gaId` 與 `metaPixelId`：request 沒有送的欄位 SHALL 存成 `null`。呼叫的成員 SHALL 有 `settings.manage`，沒有時系統回 HTTP 403，不修改設定。

更新成功時，系統 SHALL 寫一筆 `settings.update` 租戶稽核。稽核的 payload SHALL 只記錄兩個 ID 有沒有填，SHALL NOT 記錄 ID 的值。

#### Scenario: 沒有送的欄位被清除
- **WHEN** 租戶已設定兩個 ID，成員送出 `{ gaId: "G-NEW123XYZ9" }`
- **THEN** 系統回 HTTP 200，`gaId` 是 `G-NEW123XYZ9`，`metaPixelId` 是 `null`

#### Scenario: 稽核不記錄 ID 的值
- **WHEN** 成員送出 `{ gaId: "G-ABC123XYZ9", metaPixelId: null }`
- **THEN** 系統寫一筆 `settings.update` 稽核，payload 是 `{ section: "tracking", gaIdSet: true, metaPixelIdSet: false }`，不含 `G-ABC123XYZ9`

#### Scenario: 沒有 settings.manage 不能更新
- **WHEN** 沒有 `settings.manage` 的成員送出 `PUT /api/v1/settings/tracking`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `settings.manage`，已儲存的設定不變
