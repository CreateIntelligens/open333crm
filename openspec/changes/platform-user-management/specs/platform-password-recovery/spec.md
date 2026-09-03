## ADDED Requirements

### Requirement: 已登入平台管理員可自助改密碼
已登入的平台管理員 SHALL 能在提供正確舊密碼的前提下，將自己的密碼改為新密碼；系統 SHALL 驗證新密碼符合最低強度要求；成功後 SHALL 寫入 `PlatformAuditLog`。

#### Scenario: 成功改密碼
- **WHEN** 平台管理員提交正確的舊密碼與符合強度要求的新密碼
- **THEN** 系統更新 `passwordHash`，寫入一筆 `PlatformAuditLog`

#### Scenario: 舊密碼錯誤時拒絕
- **WHEN** 平台管理員提交的舊密碼與現有 `passwordHash` 不符
- **THEN** 系統回傳 401 錯誤，不變更密碼

#### Scenario: 新密碼強度不足時拒絕
- **WHEN** 平台管理員提交的新密碼長度小於系統最低要求
- **THEN** 系統回傳驗證錯誤，不變更密碼

### Requirement: 未登入使用者可申請忘記密碼重設信
未登入使用者 SHALL 能對任一 email 申請忘記密碼重設信；系統 SHALL 產生具時效性、單次使用的重設 token（以雜湊形式儲存，不存明文），並寄送含明文 token 連結的重設信；為防止帳號枚舉，SHALL 對「email 存在」與「email 不存在」回傳相同的成功回應。此端點 SHALL 施加 IP 層級的速率限制。

#### Scenario: 申請重設信（email 存在）
- **WHEN** 使用者對一個存在且啟用中的平台帳號 email 申請忘記密碼
- **THEN** 系統產生重設 token（雜湊存入 `resetTokenHash`，設定 `resetTokenExpiresAt`），寄送重設信，回傳通用成功回應

#### Scenario: 申請重設信（email 不存在）
- **WHEN** 使用者對一個不存在於任何 `PlatformUser` 的 email 申請忘記密碼
- **THEN** 系統不建立 token、不寄信，但仍回傳與 email 存在時相同的通用成功回應

#### Scenario: 停用帳號申請重設信
- **WHEN** 使用者對一個 `isActive: false` 的平台帳號 email 申請忘記密碼
- **THEN** 系統不建立 token、不寄信，回傳與其他情況相同的通用成功回應

#### Scenario: 超過速率限制時拒絕
- **WHEN** 同一來源 IP 在限制時間窗內的申請次數超過系統設定上限
- **THEN** 系統回傳速率限制錯誤，不處理該次申請

### Requirement: 使用者可用有效重設連結完成密碼重設
使用者 SHALL 能用重設信中的 token 設定新密碼；系統 SHALL 驗證 token 對應的雜湊值存在、未過期，驗證通過後 SHALL 更新密碼並立即使該 token 失效（單次使用），並 SHALL 寫入 `PlatformAuditLog`。逾期或已使用過的 token SHALL 被拒絕。

#### Scenario: 成功以有效 token 重設密碼
- **WHEN** 使用者在 token 有效期內，提交正確 token 與符合強度要求的新密碼
- **THEN** 系統更新 `passwordHash`，清空 `resetTokenHash` 與 `resetTokenExpiresAt`，寫入一筆 `PlatformAuditLog`

#### Scenario: Token 已過期時拒絕
- **WHEN** 使用者提交的 token 對應的 `resetTokenExpiresAt` 已早於目前時間
- **THEN** 系統回傳錯誤，不變更密碼

#### Scenario: Token 不存在或已被使用過時拒絕
- **WHEN** 使用者提交的 token 雜湊後與任何 `PlatformUser.resetTokenHash` 都不相符（含已使用過而被清空的情況）
- **THEN** 系統回傳錯誤，不變更密碼

#### Scenario: 新密碼強度不足時拒絕
- **WHEN** 使用者提交的 token 有效，但新密碼長度小於系統最低要求
- **THEN** 系統回傳驗證錯誤，不變更密碼，該 token SHALL 仍保持有效以供重新提交
