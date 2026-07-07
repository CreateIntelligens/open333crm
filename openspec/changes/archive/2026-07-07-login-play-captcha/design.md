## Context

登入頁位於 `apps/web/src/app/login/page.tsx`（Next.js 15 App Router、React 19、shadcn/ui + Tailwind）。表單透過 `AuthProvider` 呼叫 `POST /auth/login`（axios，`apps/web/src/lib/api.ts`）。目前唯一防護是後端 `@fastify/rate-limit`（每 IP 10 次／分鐘），前端沒有任何人機驗證。

[playcaptcha](https://github.com/mortspace/playcaptcha) 是一個**純前端**的夾娃娃機造型 CAPTCHA：

- npm 套件 `playcaptcha`，匯出 React 元件 `ClawCaptcha`，CSS 為 `playcaptcha/clawcaptcha.css`。
- 使用方式：`<ClawCaptcha onVerify={() => unlock()} />`，玩家完成夾取指定玩具後觸發 `onVerify`。
- 需將 `assets/` 內的靜態資源複製到 public 目錄，元件預期 `/(assetBase)/toys/` 與 `/(assetBase)/playcaptcha.svg`。
- 支援鍵盤操作（方向鍵 + space/enter）與 `prefers-reduced-motion`。
- **沒有 server 端驗證流程**：沒有 verification token、沒有後端 endpoint，驗證僅存在於瀏覽器。

專案既有慣例：前端設定以 `NEXT_PUBLIC_*` 環境變數在 `apps/web/src/lib/constants.ts` 集中讀取；靜態資源以 `sync:widget` npm script 在 `dev`／`build` 前複製到 `public/`。

## Goals / Non-Goals

**定位與威脅模型：** 本功能是**登入前的夾娃娃機小遊戲**，以品牌趣味為主。安全上的目標僅為擋掉**天真的自動化腳本（例如未特別處理的 Playwright 登入流程）**——它們只會填帳密送出、不會操作遊戲，因而被 gate 擋下。**不在守備範圍**：刻意驅動鍵鼠模擬遊玩的自動化、或直接呼叫 `POST /auth/login` 繞過前端者。

**Goals:**
- 在登入提交前加入夾娃娃機小遊戲關卡，帶來品牌趣味並擋掉 naive Playwright 腳本。
- 低摩擦、可及性（鍵盤可完成）、可透過設定停用（demo／本地開發／E2E）。
- 對後端 API、DB、既有 `auth-session` 契約**零改動**。
- playcaptcha assets 自我託管（self-host），不依賴外部 CDN。

**Non-Goals:**
- Server 端 CAPTCHA token 驗證（playcaptcha 不提供，也非本次目標）。
- 取代後端 rate limit（後端仍為擋暴力嘗試的權威防護）。
- 抵擋刻意驅動鍵鼠模擬遊玩、或直接呼叫 API 繞過前端的攻擊者。
- 套用到其他流程（註冊、`/auth/refresh`、忘記密碼等）。

## Decisions

### D1. Widget 以 inline 方式嵌入登入卡片，透過 `captchaVerified` state 控制提交
在 `LoginForm` 內以 `useState` 追蹤 `captchaVerified`，`ClawCaptcha` 的 `onVerify` 將其設為 `true`。提交按鈕在未驗證時 `disabled`，且 `handleSubmit` 開頭再做一次 guard（防止 Enter 直接送出）。
- **替代方案**：(a) 以 Dialog 在表單前彈出 → 摩擦較高；(b) 連續失敗 N 次後才顯示 → 狀態複雜、對 novelty CAPTCHA 效益有限。選 inline 以求簡單且可預期。

### D2. 停用開關：`NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED`
於 `constants.ts` 匯出 `LOGIN_CAPTCHA_ENABLED`（預設 `true`；值為 `'false'` 時關閉）。關閉時不 render widget，`captchaVerified` 初始即 `true`，提交按鈕不受 gate。
- **理由**：登入頁預填 demo 帳密（`admin@demo.com`），且既有 E2E／demo 流程必須能通過；提供 build-time 開關讓這些情境繞過。
- **替代方案**：以後端旗標下發 → 需改 API，違反 zero-backend-change 目標，捨棄。

### D3. 靜態資源以 `sync:playcaptcha` script 複製到 `public/`
新增 npm script（比照 `sync:widget`）將 `node_modules/playcaptcha/assets/` 下的 `toys/`、`playcaptcha.svg` 複製到 `apps/web/public/`，並串接於 `dev`／`build` 前。
- **替代方案**：用 `assetBase` prop 指向外部 CDN → 與專案 self-host 慣例相悖、且離線不可用，捨棄。

### D4. CSS 於登入頁 client component 內 import
在登入頁 import `playcaptcha/clawcaptcha.css`，將樣式限縮於登入路由，而非全域 `layout`。`LoginForm` 已是 client component（`'use client'`），`ClawCaptcha` 使用瀏覽器 API 可正常渲染。

### D5. 目標玩具採隨機（`target` 不指定）
不指定 `target` prop，讓每次隨機選一個玩具，降低被固定腳本針對的可能。

## Risks / Trade-offs

- **[純前端、無 server 驗證 — 已知且可接受]** 決定性的 bot 仍可直接呼叫 `POST /auth/login` 繞過 widget，或以 Playwright 明確驅動鍵鼠模擬遊玩。依本功能威脅模型，這些**在守備範圍外、屬可接受**（定位為小遊戲 + 擋 naive 腳本）。→ Mitigation：保留後端 rate limit 作為擋暴力嘗試的權威防護；文件與 spec 明示此為「趣味 + 嚇阻」而非安全保證。若日後真需 server-verified 防護，再另案改採 Turnstile／hCaptcha。
- **[資源載入失敗導致無法登入]** 若 `toys/` 或 svg 遺失，遊戲無法完成 → 登入被卡死。→ Mitigation：`sync:playcaptcha` 納入 build 前置步驟並在 CI 驗證；停用開關可作為緊急旁路（設 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false` 重新部署）。
- **[驗證後輸錯密碼要不要重玩]** 決策：同一頁面 session 內驗證通過後，即使密碼錯誤仍維持 `captchaVerified=true`，避免因打錯字被迫重玩；整頁 reload 後需重新驗證。→ Trade-off：略降嚴格度，但大幅改善體驗。
- **[可及性]** 部分使用者操作遊戲困難。→ Mitigation：playcaptcha 內建鍵盤與 reduced-motion 支援；保留停用開關；確保 widget 有適當 label／focus。
- **[Bundle size]** widget JS/CSS 僅在登入路由載入（route-level import），對其他頁面無影響。
- **[E2E／CI]** 既有登入測試若被 gate 擋住會失敗。→ Mitigation：測試環境設 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false`。

## Migration Plan

1. `pnpm --filter @open333crm/web add playcaptcha`。
2. 新增 `sync:playcaptcha` script 並串入 `dev`／`build`；`.gitignore` 複製進 public 的資源（比照 widget）。
3. 於 `constants.ts` 新增 `LOGIN_CAPTCHA_ENABLED`；`.env.example` 補上 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED`。
4. 於登入頁整合 `ClawCaptcha` + 提交 gate + CSS import。
5. **Rollout**：預設啟用；緊急停用只需將 env 設 `false` 重新部署（build-time）。**Rollback**：移除元件或關閉旗標。無 DB migration。

## Open Questions

- 是否也要對「忘記密碼／重設密碼」流程加關卡？→ 本次僅登入。
- 是否日後升級為 server-verified CAPTCHA？→ 超出本次範圍。
