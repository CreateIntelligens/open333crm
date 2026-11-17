## ADDED Requirements

### Requirement: 工單路由驗證路徑參數
工單路由的路徑參數 `:id`、`:tagId`、`:conversationId` SHALL 是 UUID。路由 SHALL 在讀寫資料之前檢查這些參數。不是 UUID 時，路由 SHALL 回 400 `VALIDATION_ERROR`，`error.details.issues` SHALL 指出該參數，路由 MUST NOT 讀寫資料。

#### Scenario: 工單 id 格式錯誤
- **WHEN** 成員以不是 UUID 的值當作 `:id` 呼叫任一個工單端點
- **THEN** 系統回 400 `VALIDATION_ERROR`，`error.details.issues` 的 `path` 是 `id`

#### Scenario: 標籤或對話 id 格式錯誤
- **WHEN** 成員以合法的工單 id，搭配不是 UUID 的 `:tagId` 或 `:conversationId` 呼叫端點
- **THEN** 系統回 400 `VALIDATION_ERROR`，`error.details.issues` 的 `path` 是該參數
