## MODIFIED Requirements

### Requirement: 公開申請入口與總開關
系統 SHALL 提供公開（無認證）端點 `POST /api/v1/trial/signups`（email、siteName），受逐路由 rate limit（5 次/10 分/IP）。申請 MUST NOT 收取密碼：請求帶 `password` 時 MUST 忽略且 MUST NOT 儲存。平台參數 `trial.enabled` 為 false 時 MUST 回 403 `TRIAL_CLOSED` 不受理新申請，但 MUST NOT 影響已寄出驗證信的後續驗證。

#### Scenario: 總開關關閉
- **GIVEN** `trial.enabled=false`
- **WHEN** 提交新申請
- **THEN** 回 403 TRIAL_CLOSED 且不建立任何記錄

#### Scenario: 關閉後既有驗證信仍可完成開通
- **GIVEN** 某申請已寄出驗證信，之後平台把 `trial.enabled` 改為 false
- **WHEN** 申請人打開驗證連結並設定密碼
- **THEN** 開通 MUST 照常完成

#### Scenario: 申請時送出的密碼被忽略
- **WHEN** 申請的請求含 `password` 欄位
- **THEN** 回應 MUST 與不含 `password` 時相同（202），且該值 MUST NOT 被儲存或成為管理員密碼

### Requirement: 防枚舉統一回應
`POST /signups` 不論 email 為全新、已申請過、或已是任一租戶的 Agent，MUST 回相同的 202 回應（「若此 email 可申請，驗證信已寄出」）。內部行為：全新 → 建 TrialSignup 並寄驗證信；待驗證 → MUST NOT 修改申請資料（含站台名稱），只依重寄的節流規則重寄驗證信；已 provisioned 或已是 Agent → 靜默不寄。

#### Scenario: 已開通過的 email 再申請
- **GIVEN** 某 email 的 TrialSignup 已是 provisioned（含試用已到期）
- **WHEN** 用同一 email 再次申請
- **THEN** 回應 MUST 與全新申請相同（202），且 MUST NOT 建立新記錄、MUST NOT 寄信

#### Scenario: 待驗證時以不同站台名稱再申請
- **GIVEN** 某 email 的申請待驗證，站台名稱為「甲」
- **WHEN** 以同一 email、站台名稱「乙」再次申請
- **THEN** 回應 MUST 為 202，申請的站台名稱 MUST 仍為「甲」

#### Scenario: 待驗證時連續再申請受重寄節流
- **GIVEN** 某 email 的申請待驗證，剛寄出驗證信
- **WHEN** 60 秒內以同一 email 再申請多次
- **THEN** MUST NOT 寄出新的驗證信；累計寄送次數 MUST NOT 超過 5 次

### Requirement: 驗證 token 一次性與時效
驗證 token MUST 為 32-byte 隨機值，資料庫 MUST 只存其 sha256 雜湊；有效期取 `trial.verifyTokenTtlHours`（預設 24 小時）。查詢連結狀態 MUST NOT 消耗 token；只有設定密碼並開通成功時才消耗。重寄 MUST 產生新 token 並使舊 token 失效。重寄 MUST 受節流：距上次寄出 ≥60 秒、累計上限 5 次。

#### Scenario: 過期 token
- **WHEN** 以已過期的 token 查詢連結或送出密碼
- **THEN** 回 410 `TRIAL_TOKEN_EXPIRED` 並提供重寄入口指引，且 MUST NOT 開通

#### Scenario: 重寄後舊連結失效
- **GIVEN** 申請人觸發重寄
- **WHEN** 以舊信中的 token 查詢連結或送出密碼
- **THEN** MUST 失效（410 `TRIAL_TOKEN_INVALID`）

#### Scenario: 無效 token
- **WHEN** 以不存在的 token 查詢連結或送出密碼
- **THEN** 回 410 `TRIAL_TOKEN_INVALID`，且 MUST NOT 建立租戶

### Requirement: 驗證即開通（原子性）
`POST /api/v1/trial/verify`（token、password、siteName）MUST 在同一資料庫 transaction 內：條件式原子消耗 token → 呼叫 `provisionTenant()` 建立 Tenant（planId=trial 方案、`trialEndsAt = now + trial.durationDays`）＋ system roles ＋ ADMIN agent（密碼為這次送出的密碼、email 為申請的 lowercase email）→ 標記 provisioned。任一步失敗 MUST 整體回滾且 token 未被消耗（可重試）。同一 token 再次送出 MUST 只開通一次，並冪等回成功、MUST NOT 改變管理員密碼。開通成功後 SHALL 寄送開通完成信（transaction 外）。

#### Scenario: 開通成功
- **WHEN** 申請人在效期內打開驗證連結並送出密碼
- **THEN** 新租戶與 admin 帳號 MUST 建立完成，回應含站台資訊與登入入口
- **AND** 該帳號以驗證頁設定的密碼登入後，可見功能 MUST 受 trial 方案 features 天花板限制

#### Scenario: 開通中途失敗可重試
- **GIVEN** transaction 內建立 agent 步驟失敗（非 email 衝突的暫時性錯誤）
- **WHEN** 申請人再次以同一驗證連結送出密碼
- **THEN** 開通 MUST 重新執行並可成功（token 未被消耗）

#### Scenario: email 已被其他租戶建走
- **GIVEN** 申請到驗證期間，該 email 被某租戶建為 Agent
- **WHEN** 申請人送出密碼
- **THEN** 開通 MUST 失敗且回明確錯誤「此 email 已被使用」，TrialSignup 標為 failed

#### Scenario: 同一 token 送出兩次
- **GIVEN** 申請人已以某 token 設定密碼 A 並開通
- **WHEN** 以同一 token 再送出密碼 B（或兩次同時送出）
- **THEN** MUST 只建立一個租戶，回應標示已開通，管理員密碼 MUST 仍為 A

#### Scenario: 搶先申請的人無法決定管理員密碼
- **GIVEN** 他人先以某 email 申請（申請請求附帶密碼 X），之後本人以同一 email 再申請
- **WHEN** 本人打開信中連結並設定密碼 Y
- **THEN** 管理員帳號 MUST 以 Y 登入成功，MUST NOT 以 X 登入

## ADDED Requirements

### Requirement: 驗證頁確認連結並設定密碼
`GET /api/v1/trial/verify?token=` MUST 只回連結狀態（申請的 email、站台名稱、待驗證或已開通、登入入口），MUST NOT 消耗 token、MUST NOT 建立租戶。驗證頁 SHALL 先呼叫它，待驗證時顯示設定密碼的表單與可修改的站台名稱。`POST /verify` 的密碼 MUST 至少 8 碼、站台名稱 MUST 為 1–100 字（未送時沿用申請的名稱），不合規 MUST 回 400 且 MUST NOT 消耗 token。開通後的站台名稱 MUST 為這次送出的名稱。

#### Scenario: 查詢連結不消耗 token
- **WHEN** 以有效 token 查詢連結兩次
- **THEN** 兩次都 MUST 回待驗證與申請的站台名稱，且之後仍可用同一 token 開通

#### Scenario: 密碼太短
- **WHEN** 以有效 token 送出 7 碼的密碼
- **THEN** MUST 回 400，且 token MUST 仍可用於開通

#### Scenario: 驗證頁修改站台名稱
- **GIVEN** 申請的站台名稱為「甲」
- **WHEN** 送出密碼時站台名稱填「乙」
- **THEN** 開通的租戶名稱 MUST 為「乙」

#### Scenario: 改版前寄出的驗證連結
- **GIVEN** 改版前寄出、仍在效期內的驗證連結
- **WHEN** 申請人打開它
- **THEN** 驗證頁 MUST 顯示設定密碼的表單，開通的管理員密碼 MUST 為這次送出的密碼
