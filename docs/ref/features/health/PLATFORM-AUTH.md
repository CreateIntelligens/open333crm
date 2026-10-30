# 登入與身分驗證（租戶端＋平台後台）健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e（本機 worktree 比 origin/main 落後 14 個 commit，都是粉絲門戶相關，與本領域無關）
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，`EMAIL_DELIVERY_MODE=log`，夾娃娃機關閉，Passkey 未設定）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認 tenantId；只讀）
- 範圍：`docs/ref/features/feature-map.json` 的 `platform-auth`；功能文件 `docs/ref/features/platform/AUTH.md`、`docs/ref/modules/AUTHENTICATION.md`。租戶登入的後端程式歸「人員與權限」領域（`docs/ref/features/health/MEMBERS.md`），本次仍逐條實際操作租戶登入流程，那邊已報的問題只引用

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 4 份 spec、21 個 requirement、54 個 scenario。缺實作 1 個（`platform-password-recovery`「重設成功寫稽核」，即 SEC-02）。缺測試：`platform-password-recovery` 的忘記密碼、重設 7 個 scenario 沒有任何測試；`login-captcha` 10 個 scenario 沒有測試；`open333-cli-auth` 的 CLI 端（keychain、status、npm 發佈）沒有測試。缺前端入口 1 項（CLI 沒有 `logout` 指令） |
| 自動測試 | unit：api 12 檔 54 通過、web 2 檔 9 通過、cli 2 檔 4 通過，無失敗、無 skip、無 `test.fail`。feature：`modules/auth` 1 檔 5 通過（確認只跑了本領域的檔案） |
| 實際操作 | 12 條流程。正常 8，異常 2，待真機驗 2（Passkey 註冊與登入；`open333 login` 指令本身） |

## 問題清單（依嚴重度）

P0：無。P1：無（RBAC-02 依 AUDIT 的嚴重度另列，見下表）。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-AUTH-01 | P2 | 平台「修改密碼」打錯目前密碼，後端回 401 `UNAUTHORIZED`「舊密碼不正確」，前端攔截器把所有 401 當成 token 失效：清掉 `platformToken`、整頁導回 `/admin/login`，錯誤訊息看不到。強制改密碼（`?forced=1`）時打錯臨時密碼也一樣被登出，要重新登入再來一次 | **實測（本機瀏覽器）**：自建平台帳號登入 → `/admin/change-password` → 目前密碼填錯、新密碼 `HcPlat-Pass-5` → 按「更新密碼」→ 網址變成 `/admin/login`，localStorage 沒有 `platformToken` | `apps/api/src/modules/platform/platform-password-recovery.service.ts:35`（業務錯誤用 401）；`apps/web/src/app/admin/lib/platform-api.ts:51-55` | 新 |
| RBAC-02 | 依 AUDIT | 任何成員用帳密 `POST /auth/cli/login` 拿到 `cli:analytics:read`，讀全租戶報表 | **實測（本機）**：自建 AGENT 角色成員，網頁 `GET /analytics/overview` 403，CLI token `GET /cli/analytics/overview` 200 | `apps/api/src/modules/auth/cli-session.service.ts:16` | RBAC-02（仍存在） |
| AUTH-02 | P2 | 停用租戶後，該租戶成員手上的 CLI token 仍可呼叫 API | **實測（本機）**：自建租戶 → 管理員 CLI 登入 → 平台停用租戶 → 密碼登入 403 `TENANT_DISABLED`、refresh 401，但 CLI token 打 `/auth/me` 與 `/cli/analytics/overview` 都 200 | `cli-session.service.ts:125-145`（沒檢查 `tenant.isActive`） | AUTH-02（仍存在） |
| AUTH-03 | P2 | 平台帳號改密碼、忘記密碼重設後，舊平台 JWT 仍可用 | **實測（本機）**：取得 token → 自助改密碼 → token 打 `/platform/plans` 200 → 走忘記密碼重設 → 仍 200 | `apps/api/src/plugins/auth.plugin.ts:157-180` | AUTH-03（仍存在） |
| AUTH-08 | P2 | 登出、自己改密碼後，舊 refresh token 仍可換發 | **實測（本機）**：登入 → `POST /auth/logout` → 用舊 cookie `POST /auth/refresh` 200；成員 `PATCH /agents/me/password` 後舊 refresh 200 | `apps/api/src/modules/auth/auth.routes.ts:597-642` | AUTH-08（仍存在） |
| SEC-02 | P2 | 平台登入、忘記密碼、重設密碼不寫 `platform_audit_logs`；重設違反主規格 | **實測（本機）**：自建平台帳號走完忘記密碼與重設 2 次、登入多次，稽核只有 `platform_user.provision`、`platform_user.change_password`、`platform_user.disable` | `apps/api/src/modules/platform/platform.routes.ts:115-152` | SEC-02（仍存在） |
| AUTH-10 | P3（AUDIT） | 租戶 email 區分大小寫 | **實測（本機瀏覽器）**：`/login` 以 `HC-platform-auth-tadmin@…` 加正確密碼登入，顯示「電子郵件或密碼不正確」。手機鍵盤常把第一個字母自動轉大寫，實際影響比 P3 大 | `auth.service.ts:44` | AUTH-10（仍存在；MEMBERS.md 已報） |
| HC-PLATFORM-AUTH-02 | P3 | 租戶登入頁預填 `admin@demo.com`／`admin123`，正式環境也一樣。這組是已作廢的舊示範帳號，使用者每次都要先清掉兩欄；密碼欄預先有 8 個點，看起來像瀏覽器記住了密碼 | **實測（UAT 只讀、本機）**：開 `/login`，email 欄為 `admin@demo.com`，密碼欄長度 8 | `apps/web/src/app/login/page.tsx:24-25`（`161f7c69` 加入） | 新 |
| HC-PLATFORM-AUTH-03 | P3 | Passkey 登入選項 `POST /auth/passkeys/authentication/options {email}` 對「啟用中且有 Passkey 的成員」回傳 `allowCredentials`（credential id 清單），不存在的 email 回空清單。不需登入就能確認某個 email 是不是有 Passkey 的成員、有幾把，與密碼登入的防枚舉設計不一致 | **實測（UAT，只讀，2 次請求）**：`admin@open333crm.dev` 回 2 筆，`hc-nobody-20261030@example.test` 回 0 筆 | `apps/api/src/modules/auth/auth.routes.ts:322-346` | 新（檔案歸 members） |
| HC-PLATFORM-AUTH-04 | P3 | 平台忘記密碼對存在的帳號多做「寫 token＋等寄信完成」，回應時間可以分辨帳號是否存在。另外每次申請都覆寫前一個 token，知道 email 的人可以一直讓對方手上的重設連結失效（受每 IP 每 10 分鐘 5 次限制） | **實測（本機，log 模式）**：存在的帳號 3.5–19 ms，不存在 1.6–2.1 ms（5 組都是 2 倍以上）。`resend` 模式要等 Resend 的 HTTP 回應，差距會更大（讀程式） | `platform-password-recovery.service.ts:45-63` | 新 |
| HC-PLATFORM-AUTH-05 | P3 | 平台忘記密碼頁不論結果都顯示「若此 Email 存在，重設信已寄出」：被速率限制擋下（429）或 email 格式錯（400）時，使用者以為信已寄出 | **實測（本機 API）**：同一 IP 第 6 次回 429；頁面程式在 `catch` 也設 `submitted=true` | `apps/web/src/app/admin/forgot-password/page.tsx:13-23` | 新 |
| HC-PLATFORM-AUTH-06 | P3 | 平台帳號被停用時，手上的 token 回 401 `PLATFORM_USER_DISABLED`，前端直接導回登入頁、不顯示原因；再登入只看到「帳號或密碼不正確」。被停用的人無從得知是帳號被停用 | **實測（本機瀏覽器）**：登入後在 DB 停用自建帳號 → 開 `/admin/tenants` → 回到登入頁，畫面沒有任何訊息 | `platform-api.ts:51-55` | 新 |
| HC-PLATFORM-AUTH-07 | P3 | 登入頁按「使用 Passkey 登入」而驗證失敗（401「Passkey 回應無效」）時，`api.ts` 的攔截器只排除 `/auth/login`、`/auth/refresh`，會先試 `/auth/refresh`，失敗後整頁導向 `/login`，錯誤訊息消失、夾娃娃機要重玩 | 讀程式（本機沒設定 WebAuthn，UAT 不做登入嘗試） | `apps/web/src/lib/api.ts:47-54, 80-85` | 新 |
| HC-PLATFORM-AUTH-08 | P3 | `open333 login` 先在伺服器建立 CLI session 再寫 keychain；keychain 不可用時指令失敗，但伺服器上的 session 已啟用 30 天，只能從網頁撤銷。CLI 也沒有 `logout` 指令，`POST /auth/cli/logout` 沒有呼叫端 | 讀程式 | `apps/cli/src/commands/login.ts:22-30`；`apps/cli/src/credential-store.ts:31-37` | 新 |
| HC-SETTINGS-02 | P2（設定領域） | 側欄「CLI 連線」不依 `settings.manage` 隱藏，seed 的 agent 打開看到載入錯誤 | **實測（本機 API）**：agent 打 `GET /settings/cli-sessions` 403 `requiredPermission: settings.manage` | `apps/web/src/components/layout/Sidebar.tsx:113` | 設定領域已報 |
| HC-PLATFORM-AUTH-09 | P3 | 文件過時：`docs/ref/features/platform/README.md` 的「目前的限制」寫平台模組「沒有任何測試」，現在已有 `platform-auth-guard`、`platform-auth-disabled`、`platform-audit-routes` 等測試；真正沒有測試的是 `platform-password-recovery.service.ts` | 讀程式 | `docs/ref/features/platform/README.md:122` | 新（文件） |

### 已知 AUDIT 項目的現況

| 項目 | 結論 |
| --- | --- |
| AUTH-02 | CLI token 部分**實測確認仍存在**；Socket 與 Partner API 金鑰本次沒測 |
| AUTH-03、AUTH-08、SEC-02 | **實測確認仍存在** |
| AUTH-04 | 平台登入沒有帳號鎖定：同一 IP 第 11 次才 429，帳號層級沒有限制（實測） |
| AUTH-07 | `JWT_EXPIRES_IN` 仍沒有讀取端（讀程式） |
| AUTH-10 | 仍存在（實測） |
| SEC-03 | 仍是各模組自行註冊。另外 `@fastify/rate-limit` 沒有傳 Redis store，計數存在 API 行程記憶體，多個 API 行程時每個行程各算各的（讀程式） |
| SEC-06 | 行為與 AUDIT 描述相同：不存在的 email 第 6 次 429 `ACCOUNT_LOCKED`、大寫 email 計入同一計數、CLI 登入共用計數（實測） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 租戶密碼登入 | 本機（API、瀏覽器）、UAT | 正常：勾記住我登入到 `/dashboard/inbox`，cookie httpOnly、SameSite=Strict、30 天；不勾時是 session cookie；重新整理仍登入。UAT 登入後 `/auth/me` 為 Demo 租戶，cookie 另帶 `Secure` | 錯密碼「電子郵件或密碼不正確」、不設 cookie；格式錯 400 有欄位訊息；鎖定的 email 畫面顯示「登入失敗次數過多，請 12 分鐘後再試」；同 IP 第 11 次 429 `RATE_LIMITED`（以 `X-Forwarded-For` 隔離 IP 測） | 停用成員：錯密碼 401、對密碼 403 `ACCOUNT_DISABLED`；停用租戶：錯 401、對 403 `TENANT_DISABLED` | 預填舊示範帳號（HC-PLATFORM-AUTH-02）；大寫 email 失敗（AUTH-10）。UAT 登入頁夾娃娃機有作用（未完成時按鈕 disabled、文字「請先完成小遊戲」） |
| 2 Passkey 登入 | UAT（只讀） | 未驗 | — | — | UAT 登入頁有「使用 Passkey 登入」，在夾娃娃機完成前也能按（規格只約束密碼表單）；options 端點洩漏是否有 Passkey（HC-PLATFORM-AUTH-03）。本機 capability 為 `enabled:false`。待真機驗 |
| 3 重整恢復與自動換發 | 本機 | 正常：refresh 回新 access、輪替 cookie 並保留 rememberMe（有／無 Max-Age 各驗一次） | 沒 cookie 401；把 access token 放進 cookie 401；refresh token 當 Bearer 401 | 停用成員或租戶後 refresh 401 | 停用後舊 access token 仍可用 15 分鐘，符合主規格 |
| 4 登出 | 本機（瀏覽器） | 正常：回 `/login`，cookie 清除；再開 `/dashboard/inbox` 被導回登入 | — | — | 舊 refresh token 仍有效（AUTH-08，實測） |
| 5 Passkey 管理 | 本機、UAT（只讀） | 本機顯示「Passkey 尚未啟用…」；UAT `GET /auth/passkeys` 列出 admin 的 Passkey | — | — | 註冊、改名、刪除待真機驗 |
| 6 CLI token（網頁） | 本機（瀏覽器）、UAT（只讀） | 正常：產生 → 明文 `cli_…` 只出現在對話框 → 重新整理後列表有 → 撤銷（確認框文字正確）→ 消失，DB `revokedAt` 有值；列表也列出 `open333 login` 建的連線 | — | agent 403 `settings.manage`（側欄不隱藏，HC-SETTINGS-02） | UAT 列表 5 筆，未改動 |
| 7 CLI 登入 | 本機（API） | 正常：`POST /auth/cli/login` 回 token 與三個預設 scope；`/auth/me`、`/cli/apis` 200；CLI token 打一般路由 401 | 鎖定中的 email 429（共用計數）；停用租戶 403 | AGENT 角色可讀 CLI 報表（RBAC-02） | `open333 login` 指令本身沒跑（不能 build CLI）；停用租戶後 CLI token 仍可用（AUTH-02） |
| 8 平台登入 | 本機（API、瀏覽器）、UAT（只開頁面） | 正常：`  PLATFORM@…  ` 去空白轉小寫可登入；登入到 `/admin/plans`；未登入開 `/admin/plans` 導回登入 | 錯密碼「帳號或密碼不正確」；同 IP 第 11 次 429；不存在與存在帳號回應時間相同（各 4 次約 85–97 ms） | 租戶 JWT 打平台 401、平台 JWT 打租戶 401、停用帳號 401 | UAT 平台後台已啟用（未登入打 `/platform/plans` 回 401，不是 503）；沒有在 UAT 登入平台後台 |
| 9 平台忘記密碼 | 本機 | 正常：202 同一句話；log 有 `resetUrl`；不存在、停用的帳號也 202 且不寄 | 格式錯 400；同 IP 第 6 次 429 | 公開 | 時間差（HC-PLATFORM-AUTH-04）；頁面一律顯示成功（HC-PLATFORM-AUTH-05） |
| 10 平台重設密碼 | 本機（API、瀏覽器） | 正常：重設成功並清 `mustChangePassword`，新密碼可登入 | 7 字 400 後同一連結仍可用；再用 410 `RESET_TOKEN_INVALID`；過期 410 `RESET_TOKEN_EXPIRED`；頁面無 token 顯示「缺少重設連結參數」、亂碼 token 顯示「重設連結無效或已使用」；同 IP 第 11 次 429 | 公開 | 不寫稽核（SEC-02）、舊 JWT 不失效（AUTH-03） |
| 11 平台改密碼（含強制） | 本機（API、瀏覽器） | 正常：改密碼成功並寫稽核；`mustChangePassword` 帳號登入後被導到 `?forced=1`、看不到側欄，直接開 `/admin/tenants` 也被導回；改完到 `/admin/plans`，DB 旗標清除 | 7 字 400；**舊密碼錯被登出**（HC-PLATFORM-AUTH-01） | 標記中的帳號打其他平台 API 403 `MUST_CHANGE_PASSWORD` | |
| 12 平台 guard 與登出 | 本機（瀏覽器） | 正常：登出清 localStorage 回登入頁 | — | 帳號停用後被導回登入頁，不顯示原因（HC-PLATFORM-AUTH-06） | |

測試用的身分：本機自建平台帳號 `hc-platform-auth-pu@example.test`、自建租戶「hc-platform-auth-停用測試」與其管理員、AGENT 成員；seed 的 platform、admin、supervisor、agent 只用來登入與讀取，沒有改密碼、角色或狀態。帳號鎖定一律用不存在的 `hc-platform-auth-lock-*` email 測。

## 完備度對照

以 scenario 名稱與內容比對 `apps/*/tests`。

| Spec | Requirement 數 | Scenario 數 | 缺測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| platform-auth | 5 | 16 | 0（guard、停用、503、稽核、佇列監控 cookie 都有同名測試） | 0 | 有 |
| platform-password-recovery | 3 | 11 | 7：忘記密碼 4 個、重設 3 個（過期、已用、強度不足）沒有任何測試；改密碼 3 個由 `platform-auth-guard.test.ts` 部分涵蓋 | 1：「重設成功寫入 `PlatformAuditLog`」（SEC-02） | 有 |
| login-captcha | 6 | 10 | 10：沒有任何測試 | 0（UAT 確認未通過時按鈕 disabled；鍵盤操作、reduced motion 未驗） | 有 |
| open333-cli-auth | 7 | 17 | 約 9：CLI 端的 keychain 失敗、`status` 三個情境、`apis` 指令、npm 發佈沒有測試；API 端（登入、撤銷、過期、scope）有 `cli-session-auth.test.ts` | 0 | CLI 沒有 `logout` 指令（HC-PLATFORM-AUTH-08） |

租戶登入的主規格 `auth-session`（16 個 requirement、43 個 scenario）歸 members，對照見 `docs/ref/features/health/MEMBERS.md`。本次實測補充：登入 Set-Cookie、記住我、refresh 輪替、token 用途、帳號鎖定（含大小寫、CLI 共用）、IP 限流、停用帳號與停用租戶共 20 個 scenario 行為與規格一致；「停用租戶的長效憑證與既有連線失效」的 CLI 部分不符（AUTH-02）。

**有後端、沒有前端入口**：`POST /auth/cli/logout`（CLI 沒有指令）；平台沒有伺服器端登出；租戶端沒有忘記密碼（AUTH-01）。

**前端送出的值與後端 Zod**：租戶登入的 email 前端不 trim、不轉小寫，前後有空白回 400、大寫回 401；CLI 產生 token 送 `expiresInDays` 7／30／90／365，後端接受；平台各表單的密碼 `minLength=8` 與後端一致。沒有發現前端送出、後端拒絕的合法值。

## 待真機驗

- Passkey 註冊、登入、改名、刪除，以及驗證失敗時的畫面（HC-PLATFORM-AUTH-07）。本機 API 沒設 `WEBAUTHN_RP_ID`／`WEBAUTHN_ORIGIN`，又不能重啟服務。
- `open333 login`／`status`／`apis` 指令實際執行（需要 build CLI，本次禁止）。
- 夾娃娃機的鍵盤操作與 reduced motion（本機關閉；UAT 只看到關卡存在，不做登入）。
- 停用租戶時 Socket 連線不中斷、Partner API 金鑰仍可用（AUTH-02 的另外兩面）。
- 正式環境 `resend` 寄信模式下平台忘記密碼的回應時間差（HC-PLATFORM-AUTH-04），以及重設信實際送達。

## UAT 操作紀錄

只讀，沒有建立任何資料。以 `admin@open333crm.dev` 登入 1 次（`/auth/me` 確認 Demo 租戶），讀 `/auth/me/permissions`、`/settings/cli-sessions`、`/auth/passkeys`、`/auth/passkeys/capability`，換發 1 次 refresh；對 `/auth/passkeys/authentication/options` 送 2 次請求（只會在 Redis 建 2 分鐘到期的 challenge）；開 `/login`、`/admin/login`、`/admin/plans` 三頁，沒有送出表單。沒有登入平台後台、沒有觸發忘記密碼。

本機建立的資料（都帶 `hc-platform-auth-` 前綴，結束時已處理）：平台帳號 1 個（已停用）、租戶 1 個與其 2 位成員（租戶已停用，AGENT 成員已停用）、CLI session 3 筆（已撤銷）。seed 平台帳號 `platform@open333crm.dev` 沒有被修改。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-AUTH-01：平台改密碼的「舊密碼錯誤」用 401，前端會把使用者登出。修正方向：改回 400 或 422，或讓 `platform-api.ts` 只在 token 類錯誤碼時登出。
- HC-PLATFORM-AUTH-03：Passkey 登入選項依 email 回傳 credential 清單，可枚舉有 Passkey 的成員（可併入 AUTH-10 附近的「帳號與登入」一節）。
- HC-PLATFORM-AUTH-04：平台忘記密碼的回應時間可分辨帳號是否存在；每次申請覆寫舊 token。修正方向：寄信改成不等待（排入佇列），並考慮不覆寫未過期的 token。
- HC-PLATFORM-AUTH-02：正式環境的登入頁預填舊示範帳密。
- SEC-03 補一句：rate-limit 計數存在 API 行程記憶體，水平擴展時上限變成「每行程」。

## 文件過時之處

- `docs/ref/features/platform/README.md:122`「沒有任何測試」已過時，見 HC-PLATFORM-AUTH-09；應改成「`platform-password-recovery.service.ts` 沒有測試」。
- `docs/ref/features/platform/AUTH.md` 的核對日期是 2026-09-23，內容與本次實測一致（防枚舉、停用即時生效、速率限制數字、錯誤碼），只缺「改密碼舊密碼錯誤回 401 會造成前端登出」與「忘記密碼頁一律顯示成功」兩點。
- 本機 `EMAIL_DELIVERY_MODE=log` 只印信件 metadata，不印內文：平台忘記密碼的 `resetUrl` 在 metadata 裡拿得到；平台開通信的臨時密碼不在 metadata，本機無法用臨時密碼走首次登入（本次改以 DB 設 `mustChangePassword` 測強制改密碼）。
