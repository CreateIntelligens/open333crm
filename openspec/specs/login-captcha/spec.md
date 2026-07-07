## Purpose
定義登入頁的前端人機驗證關卡：以 playcaptcha 夾娃娃機小遊戲作為登入提交前的 gate，涵蓋啟用開關、可及性、驗證狀態保留、資源自我託管，以及與登入 API 契約的邊界。定位為小遊戲 + 擋 naive Playwright 腳本，非安全保證。

## Requirements

### Requirement: 登入提交前必須通過 playcaptcha 人機關卡
當 CAPTCHA 啟用時，登入頁（`apps/web/src/app/login/page.tsx`）SHALL 在使用者完成 playcaptcha `ClawCaptcha` 遊戲（`onVerify` 觸發）之前，阻止登入表單提交。提交按鈕在未驗證時 MUST 為 `disabled`，且提交處理函式 MUST 在未驗證時提早返回，不呼叫 `POST /auth/login`。

#### Scenario: 尚未通過驗證
- **WHEN** 使用者已填妥 email 與密碼，但尚未完成 `ClawCaptcha` 遊戲
- **THEN** 登入提交按鈕維持 disabled，且即使按下 Enter 也不會發出 `POST /auth/login` 請求

#### Scenario: 通過驗證後可提交
- **WHEN** 使用者完成 `ClawCaptcha` 遊戲並觸發 `onVerify`
- **THEN** 登入提交按鈕解除 disabled，使用者可提交表單並正常呼叫 `POST /auth/login`

### Requirement: CAPTCHA 可透過 runtime 設定停用
系統 SHALL 提供 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED` 設定（在 `apps/web/src/lib/constants.ts` 讀取，預設啟用）。當設為 `false` 時，登入頁 MUST NOT 渲染 `ClawCaptcha`，且提交不受人機關卡限制，以支援 demo、本地開發與 E2E 測試。

#### Scenario: 停用時可直接登入
- **WHEN** `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false`
- **THEN** 登入頁不顯示夾娃娃機 widget，使用者填妥帳密即可直接提交登入

#### Scenario: 預設啟用時強制關卡
- **WHEN** `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED` 未設定或為 `true`
- **THEN** 登入頁渲染 `ClawCaptcha`，並在通過驗證前阻擋提交

### Requirement: CAPTCHA 僅為前端小遊戲關卡，不改動登入 API 契約
本關卡定位為**登入前的夾娃娃機小遊戲**，威脅模型僅為擋掉天真的自動化腳本（例如未特別處理的 Playwright 登入流程），並非安全保證。playcaptcha 沒有 server 端驗證，因此本關卡 SHALL 僅存在於前端。`POST /auth/login` 的 request body MUST 維持不變（不新增 captcha token 欄位），後端行為與 `auth-session` 既有需求不受影響；後端 rate limit 仍為擋暴力嘗試的權威防護。刻意驅動鍵鼠模擬遊玩或直接呼叫 API 者不在本關卡守備範圍內。

#### Scenario: 登入請求維持原契約
- **WHEN** 通過 CAPTCHA 後提交登入
- **THEN** `POST /auth/login` 的 body 僅含 `email`、`password`、`rememberMe`，不含任何 captcha 欄位

### Requirement: CAPTCHA 關卡須可鍵盤操作且尊重 reduced motion
`ClawCaptcha` 的整合 SHALL 保留其可及性能力：使用者 MUST 能僅以鍵盤（方向鍵 + space/enter）完成遊戲，且 MUST 尊重 `prefers-reduced-motion` 設定。

#### Scenario: 純鍵盤完成驗證
- **WHEN** 使用者僅使用鍵盤操作 `ClawCaptcha`
- **THEN** 可完成夾取並觸發 `onVerify`，進而解鎖登入提交

#### Scenario: 尊重 reduced motion
- **WHEN** 使用者作業系統啟用 `prefers-reduced-motion`
- **THEN** widget 降低或關閉動畫，仍可完成驗證

### Requirement: 驗證狀態於單次頁面 session 內保留
在同一次頁面載入期間，一旦通過 CAPTCHA，驗證狀態 SHALL 維持有效直到整頁 reload。若登入因憑證錯誤而失敗，系統 MUST NOT 要求使用者重玩遊戲；整頁 reload 後 MUST 重新驗證。

#### Scenario: 密碼錯誤不需重玩
- **WHEN** 使用者已通過 CAPTCHA，但因密碼錯誤登入失敗（HTTP 401）
- **THEN** 驗證狀態維持有效，使用者修正密碼後可直接重試提交，無需重玩夾娃娃機

#### Scenario: 重新整理後需重新驗證
- **WHEN** 使用者重新整理登入頁
- **THEN** 需再次完成 `ClawCaptcha` 才能提交（在 CAPTCHA 啟用時）

### Requirement: playcaptcha 靜態資源自我託管
playcaptcha 所需的玩具圖與 logo（`toys/`、`playcaptcha.svg`）SHALL 由本應用的 `public/` 目錄提供，於 `dev`／`build` 前透過 sync script 從 `node_modules/playcaptcha/assets/` 複製，不得依賴外部 CDN。

#### Scenario: 從 public 目錄載入資源
- **WHEN** 登入頁渲染 `ClawCaptcha`
- **THEN** widget 從應用自身的 public 路徑載入玩具圖與 logo（非外部 CDN），且離線環境亦可運作
