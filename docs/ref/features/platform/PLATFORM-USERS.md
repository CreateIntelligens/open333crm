# 平台帳號管理

建立、修改與停用營運方自己的帳號。管的是 `platform_users`，不是租戶的成員。

- **資料來源**：`apps/api/src/modules/platform/platform-user.service.ts`、`platform-user-emails.ts`、`platform.routes.ts`、`apps/web/src/app/admin/platform-users/*`
- **核對日期**：2026-11-19

## 程式的入口

路由在 `apps/api/src/modules/platform/platform.routes.ts`，前綴是 `/api/v1/platform`。每條路由都掛 `authenticatePlatformSuperuser` 與 `blockIfMustChangePassword`。

| 操作 | 路由 | 服務函式 |
| --- | --- | --- |
| 列表 | `GET /platform-users` | `platform-user.service.ts` 的 `listPlatformUsers()` |
| 明細 | `GET /platform-users/:id` | `getPlatformUser()` |
| 開通 | `POST /platform-users` | `createPlatformUser()` |
| 改姓名或 email | `PATCH /platform-users/:id` | `updatePlatformUser()` |
| 停用或啟用 | `PATCH /platform-users/:id/active` | `setPlatformUserActive()` |
| 重寄開通信 | `POST /platform-users/:id/resend-welcome` | `resendPlatformUserWelcomeEmail()` |
| 操作紀錄 | `GET /platform-users/:id/audit-logs` | `getPlatformUserAuditLogs()` |
| 改自己的密碼 | `POST /auth/change-password` | `platform-password-recovery.service.ts` 的 `changeOwnPassword()` |

信件模板在 `platform-user-emails.ts`。登入、忘記密碼與改密碼見[平台帳號認證](./AUTH.md)。

平台帳號與租戶成員（`agents`）是兩套帳號，各用一套 JWT（`platformJwtSign`）。拿其中一邊的 token 打另一邊的 API，一律回 401。`platform_users` 不接租戶的 RBAC。

## 沒有角色分級

所有平台帳號的權限相同。JWT 只帶一種 `role`，值固定是 `PLATFORM_SUPERUSER`，平台側也沒有相當於租戶 RBAC 的權限表。能登入平台後台，就能做這個模組的每一件事，包含建立與停用其他平台帳號。平台端也沒有 MFA 或 passkey，見 `../../system/AUDIT.md` 的 AUTH-04。

## 每個請求都重新檢查帳號

`authenticatePlatformSuperuser` 每個請求都從資料庫讀帳號的 `isActive` 與 `mustChangePassword`，不讀 JWT 裡的值：

- 帳號停用之後，對方的下一個請求回 401 `PLATFORM_USER_DISABLED`。
- `mustChangePassword` 是 `true` 時，`blockIfMustChangePassword` 對其他路由回 403 `MUST_CHANGE_PASSWORD`，只放過 `POST /auth/change-password`。改密碼的路由只掛 `authenticatePlatformSuperuser`（`authOnlyGuard`）。

## 建立帳號時不輸入密碼

建立帳號只需要 email 與姓名。密碼由系統產生：

1. email 正規化後檢查全域唯一，重複回 409 `CONFLICT`。
2. `generateTempPassword()` 產生 14 碼的臨時密碼，雜湊後寫入，`mustChangePassword` 設成 `true`。
3. 寄開通信，信裡有姓名、明文臨時密碼與登入網址，但沒有帳號的 email。收件人要自己知道用哪個 email 登入。主規格要求開通信含 email（HC-PLATFORM-USERS-10）。

**臨時密碼只出現在那一封信裡。** 資料庫只有雜湊，稽核的 payload 也不可以放明文密碼，介面沒有任何地方能再看一次。而且建立帳號時的寄信是 fire-and-forget：`sendEmail` 失敗只被 `safeSend()` 寫進 log（`[PlatformUserEmail] send failed`），不影響建立結果，操作者仍然看到成功（HC-PLATFORM-USERS-02）。信沒寄到的唯一補救是重寄開通信。

email 在兩層都正規化成 `trim().toLowerCase()`：路由的 `platformEmail` 與服務的 `normalizeEmail()`。姓名照原樣存，不去除前後的空白。開通時姓名只要求至少 1 個字，修改時限 1–100 字；兩者都接受只有空白的姓名（HC-PLATFORM-USERS-07）。

## 重寄開通信會換掉密碼

`POST /platform-users/:id/resend-welcome` 不是把同一封信再寄一次，它會重新產生臨時密碼、覆寫雜湊、把 `mustChangePassword` 設回真。**舊的密碼立刻失效。** 對方若已經拿到前一封信但還沒登入，那封信就不能用了。平台管理員對已經在使用的帳號重寄開通信時，對方自己設定的密碼也會被換掉，對方手上的 token 立刻只能呼叫改密碼。管理員對自己的帳號重寄，結果相同（HC-PLATFORM-USERS-01）。重寄時寄信失敗只寫 log，API 仍回成功，與建立帳號時相同；這時舊密碼已被覆寫，信又沒寄到（HC-PLATFORM-USERS-02）。

已停用的帳號不能重寄，回 400 `PLATFORM_USER_DISABLED`。理由是換了密碼、寄了信，對方登入仍然會被 `isActive` 擋下，與其讓操作者誤以為補救完成，不如先擋。要重寄就先啟用帳號。

## 停用帳號的兩道防呆

停用是把 `isActive` 設成 `false`，不刪除帳號，所以稽核的歷史保留。沒有刪除帳號的 API。

| 防呆 | 錯誤碼 | 理由 |
| --- | --- | --- |
| 不能停用自己 | 400 `CANNOT_DISABLE_SELF` | `callerId` 來自已驗證的 token，交易外先擋即可 |
| 不能讓啟用中的帳號歸零 | 400 `PLATFORM_LAST_USER_ACTIVE` | 帳號歸零就沒有人能登入平台後台，無法自救 |

第二道防呆的讀取、計數與更新包在同一個 `Serializable` 交易內，所以帳號不會因為同時停用而歸零。改成較弱的隔離等級時，要另外防止同時停用讓帳號歸零。代價是任何兩筆停用同時送出，不論剩下幾個帳號，都可能有一邊拿到序列化衝突。拿到衝突的請求不會重試，回 400 `DATABASE_ERROR`「資料處理失敗」，操作者要自己再按一次（HC-PLATFORM-USERS-03）。

停用已停用的帳號仍回 200，並再寫一筆 `platform_user.disable`（HC-PLATFORM-USERS-08）。

停用立即生效，連對方手上還沒過期的 token 也一起失效，見[平台帳號認證](./AUTH.md#停用帳號多久生效)。佇列監控的 cookie 也讀 `isActive`，停用的帳號同時失去監控入口。

## 查一個帳號做過什麼

`GET /platform-users/:id/audit-logs` 回傳的不只是這個帳號做的事，而是兩種紀錄的聯集：

- `platformUserId` 等於這個帳號，也就是他自己執行的操作。
- `targetType` 是 `platform_user` 且 `targetId` 等於這個帳號，也就是別人對他做的操作。

依時間新到舊排序，最多 200 筆，沒有分頁也沒有日期篩選。每筆附上操作者與對象的名稱（`describePlatformAuditLogs()`，與租戶的稽核查詢共用）。

稽核由路由寫（`writePlatformAudit()`），服務不寫。新增異動路由時要一起寫稽核，並加進 `apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 的清單。

| 操作 | `action` | payload |
| --- | --- | --- |
| 開通 | `platform_user.provision` | 只有 `email`、`name` |
| 改姓名或 email | `platform_user.update` | 整個請求的 body。畫面固定送姓名與 email 兩欄，所以只改姓名時 payload 也帶著沒變的 email（HC-PLATFORM-USERS-08） |
| 停用、啟用 | `platform_user.disable`、`platform_user.enable` | 沒有 payload |
| 重寄開通信 | `platform_user.resend_welcome` | — |
| 改自己的密碼 | `platform_user.change_password` | — |

## 修改帳號

`PATCH /platform-users/:id` 只能改姓名與 email，而且至少要給一個欄位。email 換成別人已在用的值回 409 `CONFLICT`。改 email 不會通知對方，也不會影響他手上的 token，因為 token 認的是帳號 id。搭配忘記密碼，同級帳號可以藉此接管另一個帳號，見 `../../system/AUDIT.md` 的 AUTH-04。

介面看不到密碼雜湊與重設 token，列表與明細都只回傳 `PUBLIC_SELECT` 的欄位（不含 `passwordHash`、`resetTokenHash`）。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 側欄「平台帳號」→ 列表 `/admin/platform-users` | `GET /platform-users` | 依建立時間新到舊，沒有分頁、沒有搜尋。`mustChangePassword` 的帳號顯示「待改密碼」 |
| 列表頁下方「開通新平台帳號」表單 | `POST /platform-users`，`{ email, name }` | 送出輸入的原值，不 trim。表單的 `required` 擋不住只有空白的姓名 |
| 點姓名 → 詳細頁 `/admin/platform-users/[id]` | `GET /platform-users/:id`、`GET /platform-users/:id/audit-logs` | id 不是 UUID 時 API 回 400 `DATABASE_ERROR`，不存在回 404。`load()` 沒有 `catch`，兩種情況畫面都一直停在「載入中…」（HC-PLATFORM-USERS-05） |
| 詳細頁「基本資料」→ 儲存 | `PATCH /platform-users/:id`，`{ name, email }` | 兩欄都送，各自 trim |
| 詳細頁「停用帳號」「啟用帳號」 | `PATCH /platform-users/:id/active`，`{ isActive }` | 沒有確認框。自己的詳細頁也顯示停用按鈕，按下才回「無法停用自己的帳號」（HC-PLATFORM-USERS-09） |
| 詳細頁「重寄開通信」 | `POST /platform-users/:id/resend-welcome`，沒有 body | 沒有確認框，任何啟用中的帳號都顯示，包含自己（HC-PLATFORM-USERS-01） |
| 詳細頁下方「操作紀錄」 | 同上的 `audit-logs` | 顯示操作、對象、操作者與時間，不顯示 payload（HC-PLATFORM-USERS-06）。動作的中文名稱來自 `apps/web/src/app/admin/lib/audit-log.ts` |
| 登入回 `user.mustChangePassword=true` → `/admin/change-password?forced=1` | `POST /auth/change-password`，`{ oldPassword, newPassword }` | 強制頁隱藏側欄，也就沒有「登出」，頁面上也沒有「忘記密碼」連結（HC-PLATFORM-USERS-04）。前端把旗標存在 `localStorage` 的 `platformMustChangePassword`。舊密碼錯回 401，前端的攔截器會把使用者登出（HC-PLATFORM-AUTH-01）。改完之後導到 `/admin/plans` |

平台沒有全域的稽核查詢頁。查詢介面見[平台後台](./README.md)。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
