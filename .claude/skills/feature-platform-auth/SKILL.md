---
name: feature-platform-auth
description: >
  open333CRM「登入與身分驗證（租戶端＋平台後台）」功能顧問：租戶登入 /login（夾娃娃機 playcaptcha、記住我、
  Passkey、帳號鎖定、停用帳號或停用租戶擋登入）、access／refresh token 與自動換發、登出、
  平台後台登入 /admin/login（PLATFORM_JWT_SECRET）、平台忘記密碼與重設 /admin/forgot-password、/admin/reset-password、
  強制改密碼 /admin/change-password（mustChangePassword）、CLI 登入 open333 login 與 CLI token scope、
  /dashboard/settings/cli-sessions、速率限制與 request.ip（trust-proxy）。
  當有人說「登不進去」「被登出」「一直跳回登入頁」「帳號被鎖」「忘記密碼」「重設連結失效」「CLI token 沒權限」
  「平台後台打不開」，或要改 auth、platform-auth、platform-password-recovery、cli-session、agent-token、
  rate-limit、platform-api.ts、api.ts 攔截器時使用。
---

# 登入與身分驗證（租戶端＋平台後台）

## 先讀
- 平台帳號認證（以它為準）：`docs/ref/features/platform/AUTH.md`；平台後台共通機制：`docs/ref/features/platform/README.md`
- 租戶端各種憑證的簽發與失效時間：`docs/ref/modules/AUTHENTICATION.md`
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-AUTH.md`
- 租戶登入的後端程式（`auth.routes.ts`、`auth.service.ts`、`login-attempts.ts`、`passkey.service.ts`、`auth.plugin.ts`）歸「人員與權限」領域，問題也記在那邊：`.claude/skills/feature-members/SKILL.md`、`docs/ref/features/health/MEMBERS.md`。CLI token 的建立、撤銷路由在設定領域：`.claude/skills/feature-settings/SKILL.md`。
- 規格：`openspec/specs/platform-auth/spec.md`、`openspec/specs/platform-password-recovery/spec.md`、`openspec/specs/login-captcha/spec.md`、`openspec/specs/open333-cli-auth/spec.md`；租戶登入看 `openspec/specs/auth-session/spec.md`
- 安全相關的已知問題：`docs/ref/system/AUDIT.md` 的「帳號與登入」一節（AUTH-02、03、04、07、08、10，SEC-02、03、06）與 RBAC-02
- 影響分析：`node scripts/feature-impact.mjs --domain platform-auth`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 租戶密碼登入 | `/login`（`apps/web/src/app/login/page.tsx`）。`NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED` 不是 `false` 時先玩夾娃娃機才能按登入（UAT 開、本機關） | `POST /auth/login {email,password,rememberMe}` → `auth.service.ts` `login()` | 依 email 計數（Redis，15 分鐘 5 次）、成功清除；簽 access（15m）與 refresh（30d）token，refresh 寫 httpOnly cookie；勾「記住我」cookie 帶 Max-Age 30 天，否則是 session cookie | 公開。每 IP 每分鐘 10 次（429 `RATE_LIMITED`），第 6 次起 429 `ACCOUNT_LOCKED`；停用帳號 403 `ACCOUNT_DISABLED`、停用租戶 403 `TENANT_DISABLED`（都在密碼正確後才回） |
| 2 | Passkey 登入 | `/login`「使用 Passkey 登入」（只在 `/auth/passkeys/capability` 為 enabled 時顯示；**不受夾娃娃機限制**） | `POST /auth/passkeys/authentication/options {email?}` → `.../verify` | 帶 email 時回傳該成員的 credential 清單；不經帳號鎖定計數 | 公開，每 IP 每分鐘 10 次。API 沒設 `WEBAUTHN_RP_ID`／`WEBAUTHN_ORIGIN` 時停用（本機停用、UAT 啟用） |
| 3 | 頁面重整恢復登入、自動換發 | 任何 `/dashboard` 頁；`apps/web/src/providers/AuthProvider.tsx` 掛載時；`apps/web/src/lib/api.ts` 收到 401 時 | `POST /auth/refresh`（讀 cookie）→ 回查成員與租戶仍啟用 → 重簽兩個 token | 輪替 refresh cookie，保留原本的 rememberMe | refresh 失敗 → 整頁導向 `/login` |
| 4 | 登出 | 側欄底部「登出」 | `POST /auth/logout` | 只清 cookie。舊 refresh token 仍可換發（AUTH-08，本機實測） | — |
| 5 | Passkey 管理 | `/dashboard/settings/passkeys` | `GET/PATCH/DELETE /auth/passkeys`、`POST /auth/passkeys/register/*` | 刪除是 `revokedAt` 軟刪 | 只要登入；側欄不依權限隱藏 |
| 6 | CLI token（網頁產生） | `/dashboard/settings/cli-sessions`「產生 Token」 | `GET/POST/DELETE /settings/cli-sessions` | token 明文只顯示一次，資料庫存 bcrypt 雜湊；有效期 7／30／90／365 天；勾 MCP 加 `mcp:read`；列表列出**全租戶所有成員**的 CLI 連線（含 `open333 login` 建的） | `settings.manage` / **側欄不隱藏**，沒權限的人點進去看到載入錯誤 |
| 7 | CLI 登入 | 終端機 `open333 login`（`apps/cli/src/commands/login.ts`） | `POST /auth/cli/login` → 同一個 `login()` → `createCliSession()` | 與網頁登入共用失敗計數；token 存 OS keychain；scope 固定 `cli:status`、`cli:apis`、`cli:analytics:read`，30 天 | 任何成員都能登入，不看角色（RBAC-02）；CLI 端沒有 `logout` 指令 |
| 8 | 平台登入 | `/admin/login` | `POST /platform/auth/login` → `platform-auth.service.ts` `platformLogin()` | email 去空白轉小寫；更新 `lastLoginAt`；簽平台 JWT（2h），前端存 localStorage `platformToken`；`mustChangePassword` 為 true 時導向 `/admin/change-password?forced=1` | 公開，每 IP 每分鐘 10 次；**沒有帳號鎖定**（AUTH-04）；沒設 `PLATFORM_JWT_SECRET` 時 503 `PLATFORM_DISABLED` |
| 9 | 平台忘記密碼 | `/admin/login`「忘記密碼？」→ `/admin/forgot-password` | `POST /platform/auth/forgot-password` → `requestPasswordReset()` | 存在且啟用的帳號才產生 token（sha256 存庫、60 分鐘）並寄信；一律回 202 同一句話 | 公開，每 IP 每 10 分鐘 5 次。前端不論成功、429 或 400 都顯示「若此 Email 存在…」 |
| 10 | 平台重設密碼 | 信中連結 `/admin/reset-password?token=…` | `POST /platform/auth/reset-password` → `resetPasswordWithToken()` | 單次使用；同時清 `mustChangePassword`；**不寫稽核**（SEC-02），已發出的 token 不失效（AUTH-03） | 公開，每 IP 每 10 分鐘 10 次；410 `RESET_TOKEN_INVALID`／`RESET_TOKEN_EXPIRED`；密碼少於 8 字 400 且 token 仍有效 |
| 11 | 平台改密碼（含強制） | 平台側欄「修改密碼」；臨時密碼登入後被導到 `?forced=1`（不顯示側欄） | `POST /platform/auth/change-password`（`authOnlyGuard`，不擋 mustChangePassword） | 清 `mustChangePassword`；寫稽核 `platform_user.change_password` | 平台 JWT。**舊密碼打錯回 401，前端攔截器把它當成登入失效而登出**（HC-PLATFORM-AUTH-01） |
| 12 | 平台 guard | 所有 `/admin/*` 頁（`apps/web/src/app/admin/layout.tsx` 沒 token 就導回登入） | `authenticatePlatformSuperuser`：驗簽 → role → 回查帳號存在與 `isActive` → `blockIfMustChangePassword` | 每個請求多一次 DB 查詢 | 401 一律清 token 導回 `/admin/login`，不顯示原因（帳號被停用也一樣） |

**有後端、沒有前端入口**：`POST /auth/cli/logout`（CLI 沒有 logout 指令，只能從網頁撤銷）；平台沒有登出 API（只清 localStorage）；租戶端沒有忘記密碼（AUTH-01）。

**前端實際送出的值**：租戶登入 `{email, password, rememberMe:boolean}`（email 不轉小寫、不去空白，大小寫不同就 401，AUTH-10）；Passkey options 帶 `{email?, rememberMe}`；CLI 產生 token `{name: trim, mcpRead, expiresInDays: 7|30|90|365}`（不送 scopes）；平台登入、忘記密碼送原樣 email，後端 Zod 去空白轉小寫；平台改密碼、重設的新密碼前端 `minLength=8` 與後端一致。

## 不可破壞的規則
- 租戶與平台是兩條完全分開的認證：不同表（`agents`／`platform_users`）、不同 secret（`JWT_SECRET`／`PLATFORM_JWT_SECRET`）、不同前端 token 保存（記憶體＋httpOnly cookie／localStorage）。任何一邊的 token 打另一邊都必須 401。
- 客服 API 只收 `typ: 'access'`；`/auth/refresh` 只收 `typ: 'refresh'`（`apps/api/src/lib/agent-token.ts`）。新增簽 token 的地方要帶 `typ`。
- 防帳號枚舉：不存在的帳號也要跑一次 bcrypt（成本與正式雜湊相同），停用、停用租戶的 403 只在密碼正確之後回。改登入流程時用 `login-timing` 測試確認。
- 帳號鎖定是「先 +1 再驗密碼」，不能改成驗完才 +1（併發猜測會全部通過）。
- 速率限制以 `request.ip` 分組，`trust-proxy.ts` 只信任私有網段與本機代理。`@fastify/rate-limit` 在 `auth.routes.ts`、`platform.routes.ts` 各自註冊（`global: false`），把帶 `config.rateLimit` 的路由搬到別的檔案會**靜默失效**（SEC-03）。限流存在行程記憶體，多個 API 行程各算各的。
- 平台的 `authOnlyGuard` 只能給改密碼那一條路由用；其他平台路由一律用 `guard`（會擋 mustChangePassword）。
- 平台路由的 401 在前端代表「token 失效」：`platform-api.ts` 會清 token 並導回登入頁。業務錯誤不要回 401（改密碼的舊密碼錯誤就是反例）。
- 忘記密碼必須對任何 email 回相同的 202；新的公開端點要自己加 `config.rateLimit`。
- 停用：平台帳號即時生效；租戶成員與租戶在 refresh 時生效，access token 最多再用 15 分鐘；CLI token 擋停用成員但**不擋停用租戶**（AUTH-02）；Socket 不斷線。
- 夾娃娃機只是前端小遊戲（主規格 `login-captcha` 明文），後端不驗，不要把它當成安全控制。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-auth` 看最新版本。重點：
- **被依賴**：所有租戶頁（`api.ts` 換發）、所有 `/admin` 頁（`platform-api.ts`、`admin/layout.tsx`）、佇列監控（平台 JWT 換監控 cookie）、數據分析（CLI 報表）、收件匣（socket 只收 access token）。
- **依賴**：人員與權限（租戶登入程式、成員停用、角色）、平台帳號（建立、停用、重寄開通信、信件模板）、租戶管理（停用租戶）、設定（CLI 與 Passkey 管理頁）、通知（寄信模式）、治理（平台稽核）。

## 回歸清單
改到本領域時，至少重走：
1. `/login`：錯密碼顯示「電子郵件或密碼不正確」；同一 email 第 6 次 429；勾記住我登入 → cookie 30 天 → 重新整理仍登入 → 登出 → 回 `/login`，再開 `/dashboard/inbox` 被導回。
2. 停用成員與停用租戶：錯密碼 401、對密碼 403；refresh 401；CLI token（停用成員 401，停用租戶目前仍 200，AUTH-02）。
3. `/dashboard/settings/cli-sessions`：產生、明文只出現一次、重新整理後在列表、撤銷後消失；`open333 login` 建的連線也在列表。
4. `/admin/login`：錯密碼、正確登入到 `/admin/plans`、`mustChangePassword` 帳號被鎖在改密碼頁、改完回到 `/admin/plans`、登出。
5. 平台忘記密碼 → 本機 log 模式從 API log 取 `resetUrl` → 太短的密碼 400 → 同一連結重設成功 → 再用 410 → 過期 410 `RESET_TOKEN_EXPIRED`。
6. 速率限制：本機用 `X-Forwarded-For` 帶不同 IP 測（本機請求來自 loopback，會被當成受信任代理），不要用自己的 IP 灌爆，會讓共用環境的其他人登不進去。UAT 不測。
- 自動測試：`pnpm --filter @open333crm/api test -- tests/unit/modules/auth tests/unit/modules/platform/platform-auth tests/unit/lib/agent-token tests/unit/lib/trust-proxy`；`pnpm --filter @open333crm/web test -- auth-provider cli-session-management`；`pnpm --filter @open333crm/cli test`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/auth`。
- 平台忘記密碼、重設的服務（`platform-password-recovery.service.ts`）目前**沒有任何測試**，改它要先補。
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`。

## 常見 bug 從哪裡查
- 「一直跳回登入頁」：`apps/web/src/lib/api.ts` 的 401 攔截器，refresh 失敗就 `window.location = '/login'`；查 cookie 是否被擋（`SameSite=Strict`、正式環境 `Secure`），以及成員或租戶是否被停用（refresh 回 401）。
- 「平台後台打錯舊密碼就被登出」：已知問題 HC-PLATFORM-AUTH-01，`apps/web/src/app/admin/lib/platform-api.ts` 把所有 401 都當成 token 失效。
- 「帳號被鎖」：Redis key `login:fail:<sha256(email)>`，15 分鐘從第一次嘗試起算；Passkey 不受影響。有人故意鎖別人見 SEC-06。
- 「大寫 email 登不進去」：AUTH-10，租戶端 email 區分大小寫；平台端不分。
- 「平台後台 503」：API 沒設 `PLATFORM_JWT_SECRET`。
- 「沒收到重設信」：`EMAIL_DELIVERY_MODE` 是 `log` 時只寫進 API log（metadata 有 `resetUrl`）；帳號已停用時不寄但仍回 202。
- 「客服用 CLI 看得到全租戶報表」：RBAC-02，CLI token 只看 scope。
- 「登入頁預填了 admin@demo.com」：HC-PLATFORM-AUTH-02，`apps/web/src/app/login/page.tsx` 的初始值。
