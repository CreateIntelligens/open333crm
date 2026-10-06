## ADDED Requirements

### Requirement: 前端依權限顯示選單

前端 SHALL 在成員以密碼登入、以 Passkey 登入，以及恢復登入狀態之後，以 `GET /api/v1/auth/me/permissions` 載入成員的權限集合。載入失敗時，權限集合是空的。`usePermission(code)` 依這份集合回答成員是否有某個權限碼。

側邊選單 SHALL 隱藏成員沒有權限的項目。沒有連結的上層項目，在子項目全部隱藏時也隱藏。

這些控制只影響顯示。授權以後端的「權限檢查 guard」為準。

#### Scenario: 沒有權限時隱藏選單項目
- **WHEN** 成員沒有 `analytics.view`
- **THEN** 側邊選單不顯示「報表」

#### Scenario: 有權限時顯示選單項目
- **WHEN** 成員有 `analytics.view`
- **THEN** 側邊選單顯示「報表」

#### Scenario: 子項目全部隱藏時隱藏上層項目
- **WHEN** 成員有其他權限，但沒有 `settings.manage`
- **THEN** 側邊選單的「設定」之下不顯示「整合」，因為「整合」沒有連結，唯一的子項目「A2A」需要 `settings.manage`

#### Scenario: 以密碼登入後載入權限
- **WHEN** 成員以密碼登入，`GET /api/v1/auth/me/permissions` 回傳 `analytics.view`
- **THEN** `usePermission('analytics.view')` 是 `true`

#### Scenario: 以 Passkey 登入後載入權限
- **WHEN** 成員以 Passkey 登入，`GET /api/v1/auth/me/permissions` 回傳 `analytics.view`
- **THEN** `usePermission('analytics.view')` 是 `true`

#### Scenario: 權限載入失敗時權限集合是空的
- **WHEN** 恢復登入狀態成功，但 `GET /api/v1/auth/me/permissions` 失敗
- **THEN** `usePermission` 對任何權限碼都是 `false`
