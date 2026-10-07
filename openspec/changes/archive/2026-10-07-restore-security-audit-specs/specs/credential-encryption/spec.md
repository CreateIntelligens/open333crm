## ADDED Requirements

### Requirement: 缺少加密金鑰時拒絕加解密

API 與 Workers SHALL 只用環境變數 `CREDENTIAL_ENCRYPTION_KEY` 加解密渠道憑證。金鑰至少 32 個字元。程式 SHALL NOT 在金鑰缺少或太短時改用其他金鑰。

- API 啟動時的環境變數驗證要求這個金鑰，缺少或太短時 API 不啟動。
- 加密或解密時金鑰缺少或太短，API 與 Workers 都拋出錯誤。

#### Scenario: API 啟動時缺少金鑰
- **WHEN** API 的環境變數沒有 `CREDENTIAL_ENCRYPTION_KEY`
- **THEN** 環境變數驗證失敗，錯誤訊息指出 `CREDENTIAL_ENCRYPTION_KEY`

#### Scenario: API 加密時金鑰缺少或太短
- **WHEN** `CREDENTIAL_ENCRYPTION_KEY` 沒有設定，或只有 9 個字元，API 加密渠道憑證
- **THEN** 加密拋出錯誤，錯誤訊息指出 `CREDENTIAL_ENCRYPTION_KEY` 至少要 32 個字元

#### Scenario: Workers 解密時金鑰缺少或太短
- **WHEN** `CREDENTIAL_ENCRYPTION_KEY` 沒有設定，或只有 9 個字元，Workers 解密渠道憑證
- **THEN** 解密拋出錯誤，錯誤訊息指出 `CREDENTIAL_ENCRYPTION_KEY` 至少要 32 個字元

#### Scenario: 有金鑰時加密後可以還原
- **WHEN** `CREDENTIAL_ENCRYPTION_KEY` 是 32 個字元以上，API 加密渠道憑證
- **THEN** API 與 Workers 用同一把金鑰都能解密出原本的憑證
