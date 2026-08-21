# trial-application

## ADDED Requirements

### Requirement: 公開申請入口與總開關
系統 SHALL 提供公開（無認證）端點 `POST /api/v1/trial/signups`（email、siteName、password），受逐路由 rate limit（5 次/10 分/IP）。平台參數 `trial.enabled` 為 false 時 MUST 回 403 `TRIAL_CLOSED` 不受理新申請，但 MUST NOT 影響已寄出驗證信的後續驗證。

#### Scenario: 總開關關閉
- **GIVEN** `trial.enabled=false`
- **WHEN** 提交新申請
- **THEN** 回 403 TRIAL_CLOSED 且不建立任何記錄

#### Scenario: 關閉後既有驗證信仍可完成開通
- **GIVEN** 某申請已寄出驗證信，之後平台把 `trial.enabled` 改為 false
- **WHEN** 申請人點驗證連結
- **THEN** 開通 MUST 照常完成

### Requirement: 防枚舉統一回應
`POST /signups` 不論 email 為全新、已申請過、或已是任一租戶的 Agent，MUST 回相同的 202 回應（「若此 email 可申請，驗證信已寄出」）。內部行為：全新 → 建 TrialSignup 並寄驗證信；pending 未過期 → 依節流規則重寄；已 provisioned 或已是 Agent → 靜默不寄。

#### Scenario: 已開通過的 email 再申請
- **GIVEN** 某 email 的 TrialSignup 已是 provisioned（含試用已到期）
- **WHEN** 用同一 email 再次申請
- **THEN** 回應 MUST 與全新申請相同（202），且 MUST NOT 建立新記錄、MUST NOT 寄信

### Requirement: 一個 email 只能申請一次（含別名變體）
TrialSignup MUST 以正規化 email（trim+lowercase；gmail.com/googlemail.com 另移除 `+tag` 與帳號中的點）作為唯一鍵。記錄 MUST NOT 因到期或停用被刪除——到期後同 email（含其別名變體）MUST 無法再次開通。

#### Scenario: gmail 別名重複申請
- **GIVEN** `user@gmail.com` 已申請過
- **WHEN** 以 `u.ser+demo@gmail.com` 申請
- **THEN** MUST 視為同一 email，不建立新記錄

### Requirement: 驗證 token 一次性與時效
驗證 token MUST 為 32-byte 隨機值，資料庫 MUST 只存其 sha256 雜湊；有效期取 `trial.verifyTokenTtlHours`（預設 24 小時）。重寄 MUST 產生新 token 並使舊 token 失效。重寄 MUST 受節流：距上次寄出 ≥60 秒、累計上限 5 次。

#### Scenario: 過期 token
- **WHEN** 以已過期的 token 呼叫 verify
- **THEN** 回 410 並提供重寄入口指引

#### Scenario: 重寄後舊連結失效
- **GIVEN** 申請人觸發重寄
- **WHEN** 點擊舊信中的連結
- **THEN** MUST 失效（410）

### Requirement: 驗證即開通（原子性）
`GET /api/v1/trial/verify?token=` MUST 在同一資料庫 transaction 內：條件式原子消耗 token（設為 null）→ 呼叫 `provisionTenant()` 建立 Tenant（planId=trial 方案、`trialEndsAt = now + trial.durationDays`）＋ system roles ＋ ADMIN agent（使用申請時的 passwordHash 與 lowercase email）→ 標記 provisioned。任一步失敗 MUST 整體回滾且 token 未被消耗（可重試）。已 provisioned 的 token 重複驗證 MUST 冪等回成功。開通成功後 SHALL 寄送開通完成信（transaction 外）。

#### Scenario: 開通成功
- **WHEN** 申請人在效期內點驗證連結
- **THEN** 新租戶與 admin 帳號 MUST 建立完成，回應含站台資訊與登入入口
- **AND** 該帳號以申請密碼登入後，可見功能 MUST 受 trial 方案 features 天花板限制

#### Scenario: 開通中途失敗可重試
- **GIVEN** transaction 內建立 agent 步驟失敗（非 email 衝突的暫時性錯誤）
- **WHEN** 申請人再次點同一驗證連結
- **THEN** 開通 MUST 重新執行並可成功（token 未被消耗）

#### Scenario: email 已被其他租戶建走
- **GIVEN** 申請到驗證期間，該 email 被某租戶建為 Agent
- **WHEN** 點驗證連結
- **THEN** 開通 MUST 失敗且回明確錯誤「此 email 已被使用」，TrialSignup 標為 failed
