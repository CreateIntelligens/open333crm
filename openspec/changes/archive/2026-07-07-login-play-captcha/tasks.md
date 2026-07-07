## 1. 依賴與靜態資源

- [x] 1.1 於 `apps/web` 安裝依賴：`pnpm --filter @open333crm/web add playcaptcha`
- [x] 1.2 在 `apps/web/package.json` 新增 `sync:playcaptcha` script，將 `node_modules/playcaptcha/assets/`（`toys/`、`playcaptcha.svg`）複製到 `apps/web/public/`（比照現有 `sync:widget`）
- [x] 1.3 將 `sync:playcaptcha` 串接到 `dev` 與 `build` script 前置步驟
- [x] 1.4 於 root `.gitignore` 忽略複製進 `public/` 的 playcaptcha 資源（比照 `apps/web/public/webchat/`）

## 2. 設定與環境變數

- [x] 2.1 在 `apps/web/src/lib/constants.ts` 新增 `LOGIN_CAPTCHA_ENABLED`，由 `process.env.NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED` 推導（預設 `true`，值為 `'false'` 時停用）
- [x] 2.2 在 `.env.web.example`（web）補上 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED`，並註記測試／demo 建議設為 `false`

## 3. 登入頁整合

- [x] 3.1 在登入頁 client component（`apps/web/src/app/login/page.tsx` 的 `LoginForm`）import `playcaptcha` 的 `ClawCaptcha` 與 `playcaptcha/clawcaptcha.css`（以 `next/dynamic` `ssr:false` 載入避免 SSR 錯誤）
- [x] 3.2 新增 `captchaVerified` state：`LOGIN_CAPTCHA_ENABLED=false` 時初始為 `true`，啟用時初始為 `false`
- [x] 3.3 當啟用時於登入卡片內渲染 `<ClawCaptcha onVerify={() => setCaptchaVerified(true)} />`（`target` 不指定，隨機玩具；置於 `form` 外避免遊戲按鈕誤觸提交）
- [x] 3.4 提交按鈕在 `!captchaVerified` 時 `disabled`；`handleSubmit` 開頭在未驗證時提早返回，不呼叫 `POST /auth/login`
- [x] 3.5 確認登入失敗（401）後不重置 `captchaVerified`（同一頁面 session 維持已驗證）
- [x] 3.6 確認 `POST /auth/login` 的 body 維持 `{ email, password, rememberMe }`，未新增任何 captcha 欄位

## 4. 驗證與收尾

- [ ] 4.1 （需人工）啟用 CAPTCHA 下：未完成遊戲時提交按鈕 disabled；完成夾娃娃機後可正常登入並導向 `/dashboard/inbox`（需 API + DB 實機操作 canvas 遊戲，無法自動化）
- [ ] 4.2 （需人工）以鍵盤（方向鍵 + space/enter）完成遊戲確認 `onVerify` 觸發；`prefers-reduced-motion` 下仍可完成
- [x] 4.3 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false` 時 widget 不渲染、`captchaVerified` 初始為 `true`、提交不受 gate（由 `constants.ts` gate 與 `page.tsx` 條件渲染邏輯確認）
- [x] 4.4 執行 `pnpm --filter @open333crm/web build`（含 `sync:playcaptcha`）：build 成功、資源複製並經 prod server 驗證 `/toys/*.png`、`/playcaptcha.svg` 皆回 200、`/login` 正常渲染
- [x] 4.5 以 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false` 作為測試環境繞過機制（已在 `.env.web.example` 註記）；repo 內無既有 E2E 套件需修改（`apps/web-e2e/` 為 gitignore 外部專案，其環境需自行帶入此旗標）
