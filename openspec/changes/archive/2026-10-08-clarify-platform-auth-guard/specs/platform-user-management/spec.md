## MODIFIED Requirements

### Requirement: 帳號標記須改密碼時，除改密碼外的平台功能一律受阻
`PlatformUser.mustChangePassword` 是 `true` 時，系統 SHALL 拒絕這個帳號呼叫自助改密碼（`POST /api/v1/platform/auth/change-password`）以外的所有平台 API，回 403 `MUST_CHANGE_PASSWORD`，直到改密碼成功、旗標清除為止。

系統每次請求都從資料庫讀取這個旗標，不讀 JWT。所以帳號被重新標記之後（例如平台重寄開通信），下一個請求就會被擋。

#### Scenario: 標記須改密碼的帳號嘗試存取其他平台功能
- **WHEN** `mustChangePassword` 是 `true` 的帳號以有效 JWT 呼叫改密碼以外的平台 API（例如取得方案列表）
- **THEN** 回 403 `MUST_CHANGE_PASSWORD`

#### Scenario: 標記須改密碼的帳號可呼叫改密碼 API
- **WHEN** `mustChangePassword` 是 `true` 的帳號以有效 JWT 呼叫自助改密碼 API，提交正確的舊密碼（臨時密碼）與符合強度要求的新密碼
- **THEN** 系統更新密碼，把 `mustChangePassword` 改成 `false`，這個帳號之後可以存取其他平台功能
