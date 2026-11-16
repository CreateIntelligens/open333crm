## ADDED Requirements

### Requirement: 聯絡人詳情顯示渠道封鎖狀態
聯絡人詳情頁的渠道身分清單 SHALL 在 `blockedAt` 有值的渠道身分上顯示「已封鎖官方帳號」；`blockedAt` 為 `null` 時 SHALL NOT 顯示。`GET /api/v1/contacts/:id` 回傳的每個渠道身分 SHALL 帶 `blockedAt`。

#### Scenario: 顧客封鎖了其中一個官方帳號
- **WHEN** 聯絡人有兩個 LINE 渠道身分，一個 `blockedAt` 有值、一個為 `null`，客服打開聯絡人詳情
- **THEN** 只有 `blockedAt` 有值的那一列顯示「已封鎖官方帳號」

#### Scenario: 顧客重新加入好友後不再顯示
- **WHEN** 顧客封鎖後重新加入好友（`blockedAt` 被清空），客服打開聯絡人詳情
- **THEN** 該渠道身分不顯示「已封鎖官方帳號」
