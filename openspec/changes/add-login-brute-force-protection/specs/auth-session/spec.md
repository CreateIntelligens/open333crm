## ADDED Requirements

### Requirement: 登入依來源 IP 限流
`POST /auth/login` SHALL 對同一來源 IP 每分鐘最多處理 10 次請求，超過時 SHALL 回傳 HTTP 429，錯誤碼 `RATE_LIMITED`，訊息為可讀的中文說明。

#### Scenario: 同一 IP 一分鐘內第 11 次登入
- **WHEN** 同一 IP 在一分鐘內第 11 次呼叫 `POST /auth/login`
- **THEN** 回傳 HTTP 429，`error.code` 為 `RATE_LIMITED`，`error.message` 為「操作太頻繁，請稍候再試」

### Requirement: request.ip 只採信受信任代理附加的位址
API SHALL 只信任私有網段與本機的代理：`request.ip` SHALL 為從連線來源往左略過受信任代理後的第一個位址；使用者自行帶入的 `X-Forwarded-For` 值 SHALL NOT 被採用。

#### Scenario: 經 nginx 與 Caddy 轉送
- **WHEN** 連線來自私有網段，`X-Forwarded-For` 為「1.1.1.1, 203.0.113.9, 172.18.0.1」（使用者偽造、nginx 附加真實 IP、Caddy 附加 docker 閘道）
- **THEN** `request.ip` 為 `203.0.113.9`

#### Scenario: 公網直接連到 API
- **WHEN** 連線來自公網位址 `198.51.100.7`，並帶 `X-Forwarded-For: 1.1.1.1`
- **THEN** `request.ip` 為 `198.51.100.7`

### Requirement: 登入失敗達上限時鎖定帳號
系統 SHALL 依 email（不分大小寫）計算登入失敗次數。第一次失敗起 15 分鐘內累計失敗 5 次後，該 email 的登入 SHALL 回傳 HTTP 429 `ACCOUNT_LOCKED`，不論密碼是否正確，直到該 15 分鐘區間結束。登入成功 SHALL 清除失敗次數。不存在的 email SHALL 以相同方式計算與鎖定。CLI 的密碼登入（`POST /auth/cli/login`）SHALL 與網頁登入共用同一個失敗計數。

#### Scenario: 連續失敗 5 次後鎖定
- **WHEN** 同一 email 在 15 分鐘內密碼錯誤 5 次，第 6 次送出正確密碼
- **THEN** 第 6 次回傳 HTTP 429，`error.code` 為 `ACCOUNT_LOCKED`，不簽發 token

#### Scenario: 鎖定期滿後可登入
- **WHEN** 鎖定的 email 在第一次失敗 15 分鐘後送出正確密碼
- **THEN** 登入成功

#### Scenario: 成功登入清除失敗次數
- **WHEN** 同一 email 失敗 4 次後登入成功，之後再失敗 4 次
- **THEN** 第 5 次嘗試（正確密碼）登入成功，不被鎖定

#### Scenario: 大小寫不同視為同一帳號
- **WHEN** 以 `Admin@x.dev` 失敗 3 次、`admin@x.dev` 失敗 2 次
- **THEN** 下一次登入回傳 `ACCOUNT_LOCKED`

#### Scenario: 不存在的 email 也會鎖定
- **WHEN** 不存在的 email 失敗 5 次後再嘗試
- **THEN** 回傳 HTTP 429 `ACCOUNT_LOCKED`，與存在的帳號相同

### Requirement: 停用帳號只在密碼正確時才告知
帳號已停用時，系統 SHALL 先驗證密碼；密碼錯誤 SHALL 回傳與一般錯誤相同的 401 `INVALID_CREDENTIALS`，密碼正確才回傳 403 `ACCOUNT_DISABLED`。

#### Scenario: 停用帳號、密碼錯誤
- **WHEN** 以停用帳號的 email 與錯誤密碼登入
- **THEN** 回傳 HTTP 401 `INVALID_CREDENTIALS`

#### Scenario: 停用帳號、密碼正確
- **WHEN** 以停用帳號的 email 與正確密碼登入
- **THEN** 回傳 HTTP 403 `ACCOUNT_DISABLED`
