## Why

登入頁想加入一個**夾娃娃機小遊戲**作為登入前的互動關卡：主要目的是品牌趣味與記憶點，次要目的是擋掉**天真的自動化腳本（如未特別處理的 Playwright 登入流程）**。naive 腳本只會填帳密、送出，不會操作夾娃娃機遊戲，因而被 gate 擋下。目前唯一防護是後端 `POST /auth/login` 的 IP rate limit（10 次／分鐘）。導入 [playcaptcha](https://github.com/mortspace/playcaptcha) 即可用最小成本達成此定位。

**威脅模型僅限於此**——不用抵擋刻意驅動鍵鼠的自動化、或直接呼叫 API 繞過前端的攻擊者；那些不在本功能的守備範圍。

## What Changes

- 在 `apps/web` 新增 `playcaptcha` 依賴，於登入頁（`apps/web/src/app/login/page.tsx`）整合 `ClawCaptcha` 元件。
- 登入表單新增 CAPTCHA 關卡：使用者需先完成夾娃娃機遊戲（`onVerify` 觸發）才能提交登入；未完成時提交按鈕維持 disabled。
- 將 playcaptcha 靜態資源（`toys/`、`playcaptcha.svg`）納入 `apps/web/public`，並於建置流程（sync script）中同步，確保 widget 可正確載入圖檔。
- 新增可設定的開關（透過既有 public runtime config），讓 demo／本地開發可停用 CAPTCHA，避免阻擋既有預填 demo 帳密的登入流程與 E2E 測試。
- 明確界定範圍與威脅模型：定位為**小遊戲 + 擋 naive Playwright**，非安全保證。playcaptcha 為純前端、無 server 端驗證 token，因此本變更**不改動** `POST /auth/login` API 契約；後端 rate limit 仍為擋暴力嘗試的權威防護。刻意驅動鍵鼠或直接打 API 的攻擊者不在防護範圍內。此定位會在 design 中說明。

## Capabilities

### New Capabilities
- `login-captcha`: 登入頁的前端人機驗證關卡 —— 使用 playcaptcha 夾娃娃機遊戲作為登入提交前的 gate，涵蓋啟用開關、可及性（鍵盤操作）、驗證通過後解鎖提交、以及 demo/測試繞過行為。

### Modified Capabilities
<!-- 無。auth-session 的 token/cookie 契約與 API 行為不變；playcaptcha 無 server 驗證，不影響既有登入需求。 -->

## Impact

- **前端**：`apps/web/src/app/login/page.tsx`（整合 widget 與提交 gate）、`apps/web/package.json`（新增 `playcaptcha` 依賴）、`apps/web/public/`（新增 `toys/`、`playcaptcha.svg` 靜態資源與 sync script）、public runtime config 讀取（CAPTCHA 開關）。
- **後端**：無變更（無新 API、無 schema 變更）。
- **資料庫**：無變更。
- **建置／部署**：需在 build 階段同步 playcaptcha assets 至 `public/`（比照現有 `sync:widget` 模式）；`playcaptcha/clawcaptcha.css` 需在登入頁載入。
- **測試**：既有登入 E2E／demo 流程需能在停用 CAPTCHA 的設定下通過。
