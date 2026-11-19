---
name: feature-platform-auth
description: >
  open333CRM「登入與身分驗證」功能顧問：租戶與平台後台的登入、token 換發、忘記密碼、強制改密碼、CLI 登入與 token scope、速率限制。改到 auth、platform-auth、cli-session、rate-limit 模組，或 api.ts、platform-api.ts 攔截器之前使用。
---

# 登入與身分驗證（租戶端＋平台後台）

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。登入與身分驗證的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

租戶登入 `/login`（夾娃娃機 playcaptcha、記住我、Passkey、帳號鎖定、停用帳號或停用租戶擋登入）、access 與 refresh token 的自動換發、登出、
平台後台登入 `/admin/login`（`PLATFORM_JWT_SECRET`）、平台忘記密碼與重設（`/admin/forgot-password`、`/admin/reset-password`）、
強制改密碼 `/admin/change-password`（`mustChangePassword`）、CLI 登入 `open333 login` 與 CLI token scope、
`/dashboard/settings/cli-sessions`、速率限制與 `request.ip`（trust-proxy）。
常見問題：「登不進去」「被登出」「一直跳回登入頁」「帳號被鎖」「忘記密碼」「重設連結失效」「CLI token 沒權限」「平台後台打不開」。
改 auth、platform-auth、platform-password-recovery、cli-session、agent-token、rate-limit、`platform-api.ts`、`api.ts` 攔截器之前使用。

## 先讀

先讀功能文件 `docs/ref/features/platform/AUTH.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | 章節 |
| --- | --- |
| 找路由對應的函式 | `AUTH.md`：程式的入口 |
| 平台登入、JWT | `AUTH.md`：登入一次會發生什麼、防帳號枚舉 |
| 平台帳號停用、`mustChangePassword`、`guard` 與 `authOnlyGuard` | `AUTH.md`：停用帳號多久生效、臨時密碼與兩組 guard |
| 平台忘記密碼與重設 | `AUTH.md`：忘記密碼的 token |
| 速率限制 | `AUTH.md`：速率限制 |
| 錯誤碼 | `AUTH.md`：錯誤碼 |
| 租戶密碼登入、帳號鎖定、Passkey、換發、CLI 登入 | `AUTH.md`：租戶端登入與 CLI 登入；`docs/ref/features/tenant/MEMBERS.md`：登入 |
| 各種 token 的簽發、驗證與失效時間 | `docs/ref/modules/AUTHENTICATION.md` |
| 前端頁面與攔截器 | `AUTH.md`：畫面怎麼呼叫 API |

平台後台共通機制見 `docs/ref/features/platform/README.md`。租戶登入的後端程式（`auth.routes.ts`、`auth.service.ts`、`login-attempts.ts`、`passkey.service.ts`、`auth.plugin.ts`）歸「人員與權限」領域，那邊的問題記在 `.claude/skills/feature-members/SKILL.md`、`docs/ref/features/health/MEMBERS.md`。CLI token 的建立與撤銷路由在設定領域：`.claude/skills/feature-settings/SKILL.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/auth/`、`apps/api/tests/unit/modules/platform/`（`platform-auth-*`）、`apps/api/tests/feature/modules/auth/`、`apps/web/tests/unit/providers/`、`apps/web/tests/unit/components/settings/`、`apps/cli/tests/unit/`，寫法可以照著參考。

`AUTH.md` 裡標 `HC-PLATFORM-AUTH-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-AUTH.md`
- 規格：`openspec/specs/platform-auth/spec.md`、`openspec/specs/platform-password-recovery/spec.md`、`openspec/specs/login-captcha/spec.md`、`openspec/specs/open333-cli-auth/spec.md`；租戶登入看 `openspec/specs/auth-session/spec.md`
- 安全相關的已知問題：`docs/ref/system/AUDIT.md` 的「帳號與登入」一節（AUTH-02、03、04、07、08、10，SEC-02、03、06）與 RBAC-02
- 影響分析：`node scripts/feature-impact.mjs --domain platform-auth`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在括號內的章節。沒寫文件名稱的章節在 `AUTH.md`。

- 租戶與平台是兩條分開的認證：不同的表、不同的 secret、不同的前端 token 保存。任何一邊的 token 打另一邊都必須回 401。（租戶端登入與 CLI 登入）
- 客服 API 只收 `typ: 'access'`，`/auth/refresh` 只收 `typ: 'refresh'`（`apps/api/src/lib/agent-token.ts`）。新增簽 token 的地方要帶 `typ`。（`AUTHENTICATION.md`：認證裝飾器）
- 防帳號枚舉：不存在的帳號也跑一次 bcrypt，停用帳號與停用租戶的 403 只在密碼正確之後回。改登入流程時用 `login-timing` 測試確認。（防帳號枚舉；密碼登入）
- 帳號鎖定是「先 +1 再驗密碼」，不能改成驗完才 +1。（密碼登入）
- 速率限制以 `request.ip` 分組，`trust-proxy.ts` 只信任私有網段與本機代理。帶 `config.rateLimit` 的路由不能搬到別的檔案（SEC-03）。（速率限制；密碼登入）
- 平台的 `authOnlyGuard` 只給改密碼那一條路由用。其他平台路由一律用 `guard`。（臨時密碼與兩組 guard）
- 平台路由的 401 在前端代表「token 失效」，`platform-api.ts` 會清 token 並導回登入頁。業務錯誤不要回 401。（錯誤碼；畫面怎麼呼叫 API）
- 忘記密碼必須對任何 email 回相同的 202。新的公開端點要自己加 `config.rateLimit`。（防帳號枚舉；速率限制）
- 停用的生效時間：平台帳號立即生效；租戶成員與租戶在換發時生效，access token 最多再用 15 分鐘；CLI token 擋停用成員，但不擋停用租戶（AUTH-02）；Socket 不斷線。（停用帳號多久生效；`AUTHENTICATION.md`：停用與撤銷什麼時候生效）
- 夾娃娃機只是前端小遊戲，後端不驗。不要把它當成安全控制。（夾娃娃機與 Passkey）

## 回歸清單

改到本領域時，至少重走：

1. `/login`：
   - 錯密碼顯示「電子郵件或密碼不正確」。同一個 email 第 6 次回 429。
   - 勾記住我登入 → cookie 30 天 → 重新整理仍登入 → 登出 → 回 `/login` → 再開 `/dashboard/inbox` 被導回。
2. 停用成員與停用租戶：
   - 錯密碼 401，對密碼 403。refresh 回 401。
   - CLI token：停用成員回 401；停用租戶仍回 200（AUTH-02）。
3. `/dashboard/settings/cli-sessions`：產生 → 明文只出現一次 → 重新整理後在列表 → 撤銷後消失。`open333 login` 建的連線也在列表。
4. `/admin/login`：錯密碼 → 正確登入到 `/admin/plans` → `mustChangePassword` 帳號被鎖在改密碼頁 → 改完回到 `/admin/plans` → 登出。
5. 平台忘記密碼：
   - 本機 log 模式從 API log 取 `resetUrl`。
   - 太短的密碼回 400 → 同一個連結重設成功 → 再用回 410 → 過期回 410 `RESET_TOKEN_EXPIRED`。
6. 速率限制：本機用 `X-Forwarded-For` 帶不同 IP 測。本機請求來自 loopback，會被當成受信任代理。不要用自己的 IP 灌爆，共用環境的其他人會登不進去。UAT 不測。

自動測試：

- `pnpm --filter @open333crm/api test -- tests/unit/modules/auth tests/unit/modules/platform/platform-auth tests/unit/lib/agent-token tests/unit/lib/trust-proxy`
- `pnpm --filter @open333crm/web test -- auth-provider cli-session-management`
- `pnpm --filter @open333crm/cli test`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/auth`
- 平台忘記密碼與重設的服務（`platform-password-recovery.service.ts`）**沒有任何測試**，改它要先補。
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`。

## 常見 bug 從哪裡查

- 「一直跳回登入頁」：
  - `apps/web/src/lib/api.ts` 的 401 攔截器在換發失敗時執行 `window.location = '/login'`。
  - 查 cookie 是否被擋（`SameSite=Strict`、正式環境 `Secure`）。
  - 查成員或租戶是否被停用（refresh 回 401）。
- 「平台後台打錯舊密碼就被登出」：HC-PLATFORM-AUTH-01。`apps/web/src/app/admin/lib/platform-api.ts` 把所有 401 都當成 token 失效。
- 「帳號被鎖」：Redis key `login:fail:<sha256(email)>`，15 分鐘從第一次嘗試起算。Passkey 不受影響。有人故意鎖別人，見 SEC-06。
- 「大寫 email 登不進去」：AUTH-10，租戶端 email 區分大小寫；平台端不分。
- 「平台後台 503」：API 沒設 `PLATFORM_JWT_SECRET`。
- 「沒收到重設信」：`EMAIL_DELIVERY_MODE` 是 `log` 時只寫進 API log（metadata 有 `resetUrl`）。帳號已停用時不寄，但仍回 202。
- 「客服用 CLI 看得到全租戶報表」：RBAC-02，CLI token 只看 scope。
- 「登入頁預填了 admin@demo.com」：HC-PLATFORM-AUTH-02，`apps/web/src/app/login/page.tsx` 的初始值。
