# partner-api-key Specification

## Purpose
規定租戶在設定頁管理 Partner API 金鑰的規則：建立金鑰時可以指定的有效期限，以及不合法的期限怎麼處理。

## Requirements

### Requirement: API 金鑰的有效天數

`POST /api/v1/settings/api-keys` 的 `expiresInDays` SHALL 只接受 1～365 的整數，金鑰在建立後的這個天數到期。請求沒有送 `expiresInDays`，或送 `null` 時，金鑰 SHALL 永不過期。其他值 SHALL 回 400 `VALIDATION_ERROR`，`error.details.issues` 指出 `expiresInDays`，系統 SHALL NOT 建立金鑰。

#### Scenario: 最大的有效天數可以建立
- **WHEN** 有 `settings.manage` 的成員建立金鑰，`expiresInDays` 是 365
- **THEN** 系統回 201，`expiresAt` 是建立時間的 365 天後

#### Scenario: 沒有指定有效天數時永不過期
- **WHEN** 有 `settings.manage` 的成員建立金鑰，沒有送 `expiresInDays`，或送 `null`
- **THEN** 系統回 201，`expiresAt` 是 `null`

#### Scenario: 有效天數超出範圍
- **WHEN** 有 `settings.manage` 的成員建立金鑰，`expiresInDays` 是 `0`、`366`、`3650000` 或 `1.5`
- **THEN** 系統回 400 `VALIDATION_ERROR`，`error.details.issues` 指出 `expiresInDays`，租戶沒有新的金鑰
