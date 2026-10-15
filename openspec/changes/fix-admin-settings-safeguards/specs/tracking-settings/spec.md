## ADDED Requirements

### Requirement: 追蹤 ID 的格式驗證

`PUT /api/v1/settings/tracking` SHALL 只接受下列格式，頭尾空白先去掉；空字串與 `null` 表示清除：

- `gaId`：`G-` 加 4～20 個大寫英文字母或數字。系統不接受小寫的 `g-`，也不接受其他小寫字母。原因是 gtag.js 只把大寫 `G-` 當成 GA4 ID，含小寫字母的 ID 不會追蹤。
- `metaPixelId`：5～20 位數字。

格式不符時，系統 SHALL 回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不修改已儲存的設定。

#### Scenario: 合格的 ID 可以儲存
- **WHEN** 有 `settings.manage` 的成員送出 `{ gaId: "G-ABC123XYZ9", metaPixelId: "123456789012345" }`
- **THEN** 系統回 HTTP 200，回應的 `gaId` 是 `G-ABC123XYZ9`、`metaPixelId` 是 `123456789012345`

#### Scenario: 含程式碼的 GA ID 被拒
- **WHEN** 成員送出 `gaId` 為 `G-1');alert(1);//`
- **THEN** 系統回 HTTP 400，已儲存的 `gaId` 不變

#### Scenario: 非數字的 Pixel ID 被拒
- **WHEN** 成員送出 `metaPixelId` 為 `123</script><script>alert(1)</script>`
- **THEN** 系統回 HTTP 400，已儲存的 `metaPixelId` 不變

#### Scenario: 含小寫字母的 GA ID 被拒
- **WHEN** 成員送出 `gaId` 為 `g-ABC123XYZ9` 或 `G-abc123xyz9`
- **THEN** 系統回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，已儲存的 `gaId` 不變

#### Scenario: 空字串清除設定
- **WHEN** 成員送出 `{ gaId: "", metaPixelId: null }`
- **THEN** 系統回 HTTP 200，兩個欄位都是 `null`

### Requirement: 追蹤 script 只輸出合格的 ID

短連結中轉頁產生追蹤 script 時，系統 SHALL 再檢查一次 ID 格式。格式不符的 ID（例如驗證上線前就存進資料庫的值）SHALL 不輸出任何 script。輸出的 ID SHALL 經過跳脫，不能結束字串或 `<script>` 標籤。

#### Scenario: 舊資料裡不合格的 ID 不輸出
- **WHEN** 資料庫裡的 `gaId` 是 `G-1');alert(1);//`，訪客開啟短連結中轉頁
- **THEN** 頁面不含 GA 的 script，也不含 `alert(1)`

#### Scenario: 合格的 ID 照常輸出
- **WHEN** `gaId` 是 `G-ABC123XYZ9`、`metaPixelId` 是 `123456789012345`
- **THEN** 頁面含 GA 與 Meta Pixel 的 script，且含這兩個 ID
