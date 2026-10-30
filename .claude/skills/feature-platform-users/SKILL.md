---
name: feature-platform-users
description: >
  open333CRM「平台帳號管理」功能顧問：平台後台營運方帳號（platform_users）的開通（系統產生臨時密碼、寄開通信）、
  列表與詳細頁、改姓名與 email、停用／啟用（不能停用自己、不能讓啟用帳號歸零）、重寄開通信（會換掉密碼）、
  首次登入強制改密碼（mustChangePassword、MUST_CHANGE_PASSWORD）、帳號操作紀錄（platform_audit_logs）。
  當需求、bug 或新功能碰到「平台帳號」「平台管理員」「開通平台帳號」「臨時密碼」「重寄開通信」「停用平台帳號」
  「平台稽核」「操作紀錄」、/admin/platform-users、platform-user.service、platform-user-emails、PlatformUser、
  PlatformAuditLog 時使用。也在改平台登入、平台 guard、平台稽核寫入或 email 寄信模式前使用，確認不破壞平台帳號。
---

# 平台帳號管理

## 先讀
- 功能現況（以它為準）：`docs/ref/features/platform/PLATFORM-USERS.md`
  - 注意：其中「序列化衝突只在同時停用最後兩個帳號時發生」不完整，任何兩筆同時停用都可能有一邊失敗，見健檢 HC-PLATFORM-USERS-03。
- 平台後台共通機制（稽核分工、資料模型）：`docs/ref/features/platform/README.md`；登入、忘記密碼、改密碼：`docs/ref/features/platform/AUTH.md`
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-USERS.md`；登入相關問題在 `docs/ref/features/health/PLATFORM-AUTH.md`
- 規格：`openspec/specs/platform-user-management/spec.md`（改密碼與忘記密碼在 `openspec/specs/platform-password-recovery/spec.md`，guard 在 `openspec/specs/platform-auth/spec.md`）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-users`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）。平台沒有權限分級：能登入平台後台就能做下面每一件事（AUTH-04）。所有路由都掛 `authenticatePlatformSuperuser` + `blockIfMustChangePassword`。

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 帳號列表 | 側欄「平台帳號」`/admin/platform-users` | `GET /platform/platform-users` → `listPlatformUsers` | 無。只回 `PUBLIC_SELECT`（不含 `passwordHash`、`resetTokenHash`），建立時間新到舊，無分頁、無搜尋 | 平台 token；`mustChangePassword` 中 403 `MUST_CHANGE_PASSWORD` |
| 2 | 開通帳號 | 列表頁下方「開通新平台帳號」表單（姓名、Email） | `POST /platform/platform-users {email,name}` → `createPlatformUser` | email 去空白轉小寫、重複 409 `CONFLICT`；`generateTempPassword()` 14 碼寫雜湊、`mustChangePassword=true`；開通信**不等待**（`void`），失敗只寫 log；路由寫 `platform_user.provision`（payload 只有 email、name） | 同上 |
| 3 | 詳細頁 | 列表點姓名 → `/admin/platform-users/[id]` | `GET /platform-users/:id` + `GET /platform-users/:id/audit-logs` | 無。id 不是 uuid 回 400 `DATABASE_ERROR`、不存在 404，頁面兩者都卡在「載入中…」（HC-PLATFORM-USERS-05） | 同上 |
| 4 | 改姓名／email | 詳細頁「基本資料」→ 儲存 | `PATCH /platform-users/:id {name,email}`（前端固定兩欄都送、各自 trim）→ `updatePlatformUser` | email 重複 409；不通知原信箱、不影響對方 token（AUTH-04）；稽核 `platform_user.update` payload 是整個 body | 同上 |
| 5 | 停用／啟用 | 詳細頁「停用帳號」／「啟用帳號」（無確認框） | `PATCH /platform-users/:id/active {isActive}` → `setPlatformUserActive`（Serializable 交易） | 自己 400 `CANNOT_DISABLE_SELF`；啟用帳號歸零 400 `PLATFORM_LAST_USER_ACTIVE`；併發時可能 400 `DATABASE_ERROR`（HC-PLATFORM-USERS-03）；停用後對方 token 下一個請求就 401 `PLATFORM_USER_DISABLED`；稽核 enable／disable（無 payload） | 同上；自己的頁面也顯示停用鈕 |
| 6 | 重寄開通信 | 詳細頁「重寄開通信」（無確認框、任何啟用帳號都顯示，含自己） | `POST /platform-users/:id/resend-welcome` → `resendPlatformUserWelcomeEmail` | **換掉對方現在的密碼**並設 `mustChangePassword=true`，對方手上 token 立刻變成只能改密碼；停用帳號 400 `PLATFORM_USER_DISABLED`；寄信失敗仍回成功（HC-PLATFORM-USERS-01、02）；稽核 `platform_user.resend_welcome` | 同上 |
| 7 | 首次登入強制改密碼 | 登入回 `user.mustChangePassword=true` → `/admin/change-password?forced=1`（無側欄、無登出） | `POST /platform/auth/change-password {oldPassword,newPassword}`（`authOnlyGuard`）→ `changeOwnPassword` | 清旗標；稽核 `platform_user.change_password`；舊密碼錯回 401 會被前端登出（HC-PLATFORM-AUTH-01） | 平台 token；這條不擋 `mustChangePassword` |
| 8 | 操作紀錄 | 詳細頁下方「操作紀錄」表 | 同流程 3 的 audit-logs → `getPlatformUserAuditLogs` | 無。條件是「此帳號做的」或「targetType=platform_user 且 targetId=此帳號」，最多 200 筆、新到舊；畫面不顯示操作者與 payload（HC-PLATFORM-USERS-06） | 同上 |

**有後端、沒有前端入口**：audit-logs 回傳的 `platformUserId`（操作者）與 `payload`；平台全域稽核查詢（不存在，PLAN-11、`docs/ref/features/platform/README.md`「沒有查詢介面」）。沒有刪除帳號的 API，也沒有角色或權限設定。

**前端實際送出的值**：開通 `{email, name}`（不 trim，後端 email 會正規化、name 原樣存）；編輯 `{name: trim, email: trim}` 兩欄一起送；停用 `{isActive: !user.isActive}`；重寄無 body。後端 name：開通 `min(1)`、編輯 `min(1).max(100)`，兩者都不 trim。

## 不可破壞的規則
- 平台帳號與租戶成員（`agents`）是兩套帳號、兩套 JWT（`platformJwtSign`），互打一律 401。不要把 `platform_users` 接到租戶 RBAC。
- 臨時密碼只出現在開通信裡。資料庫只有雜湊，稽核 payload 不能放明文密碼（規格要求）。
- `mustChangePassword` 由 guard **每次請求從資料庫讀**，不讀 JWT；`blockIfMustChangePassword` 只放過 `/auth/change-password`。改 guard 時兩者都要保留。
- 停用必須即時生效：`authenticatePlatformSuperuser` 每次查 `isActive`。停用是 `isActive=false`，不刪除，稽核歷史保留。
- 「不能停用自己」在交易外先擋；「至少一個啟用帳號」的讀取、計數、更新必須在同一個 Serializable 交易裡。改成較弱的隔離等級要另想辦法防同時停用歸零。
- 重寄開通信會換掉密碼，不是單純重寄信；已停用帳號擋 400。
- 稽核由路由寫（`writePlatformAudit`），服務不寫；新增異動路由要一起補稽核，`apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 的清單也要加。
- email 一律 `trim().toLowerCase()`（路由的 `platformEmail` 與服務的 `normalizeEmail` 兩層）。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-users` 看最新版本。重點：
- **依賴**：平台登入與 guard（`apps/api/src/plugins/auth.plugin.ts`、`apps/web/src/app/admin/lib/platform-api.ts`、改密碼頁，歸 platform-auth）；路由檔 `apps/api/src/modules/platform/platform.routes.ts` 與 `apps/api/src/modules/platform/platform-audit.service.ts`（歸 platform-tenants）；寄信 `apps/api/src/modules/email/email.service.ts`（歸 notifications）。
- **被依賴**：平台登入（mustChangePassword、停用、改 email 後忘記密碼寄到新信箱）；租戶管理、方案異動審核、試用管理的平台稽核只能從這裡的操作紀錄查；佇列監控 cookie 也讀 `isActive`。

## 回歸清單
改到本領域時，至少重走：
1. 開通帳號（email 大寫加空白）→ 列表出現、狀態「待改密碼」→ 同 email 再開通 409。
2. 以新帳號登入（本機 log 模式拿不到臨時密碼，用 DB 設定**自建**帳號的雜湊）→ 被導到 `?forced=1`、其他 API 403 → 改密碼 → 到 `/admin/plans`。
3. 改另一個帳號的姓名與 email（含改成重複 email 409）→ 重新整理讀回一致。
4. 停用另一個帳號 → 對方舊 token 401、登入 401 → 停用自己 400 → 啟用回來可登入。
5. 重寄開通信 → 對方舊密碼 401、舊 token 403 `MUST_CHANGE_PASSWORD`；停用中的帳號 400。
6. 操作紀錄看得到以上每一筆，新到舊。
- 自動測試：`pnpm --filter @open333crm/api test -- platform-audit-routes platform-auth-guard platform-auth-disabled`。`platform-user.service.ts` 本身沒有單元或 feature 測試。
- 本機測試一律自建 `hc-` 前綴的平台帳號，**不要改 seed 的 `platform@open333crm.dev`**；UAT 平台後台只讀。

## 常見 bug 從哪裡查
- 「對方說收不到開通信」：寄信失敗只寫 log（`apps/api/src/modules/platform/platform-user-emails.ts` 的 `safeSend`），查 API log 的 `[PlatformUserEmail] send failed`；補救是重寄開通信（會再換一次密碼）。
- 「同事的密碼突然不能用、一登入就被要求改密碼」：有人按了重寄開通信。查該帳號操作紀錄的「重寄開通信」。
- 「停用時跳出『資料處理失敗』」：同時有另一筆停用在跑，Serializable 衝突（HC-PLATFORM-USERS-03），再按一次即可。
- 「停不掉最後一個帳號／停不掉自己」：`PLATFORM_LAST_USER_ACTIVE`、`CANNOT_DISABLE_SELF`，設計如此。
- 「一直被導到改密碼頁、沒有登出鈕」：`localStorage` 的 `platformMustChangePassword` 旗標與資料庫 `mustChangePassword` 都要看；強制頁沒有登出入口（HC-PLATFORM-USERS-04），清掉 `platformToken` 才能回登入頁走忘記密碼。
- 「詳細頁一直載入中」：網址的 id 錯或帳號不存在，頁面沒處理錯誤（HC-PLATFORM-USERS-05）。
