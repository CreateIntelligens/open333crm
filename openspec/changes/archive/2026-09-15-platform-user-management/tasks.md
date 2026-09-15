## 1. Schema & Migration

- [x] 1.1 `packages/database/prisma/schema.prisma` 的 `PlatformUser` 新增 `resetTokenHash String?` 與 `resetTokenExpiresAt DateTime?`
- [x] 1.2 產生 migration（`pnpm --filter @open333crm/database exec prisma migrate dev`），確認正式 migration SQL 檔產出（不是只 db push）
- [x] 1.3 `pnpm --filter @open333crm/database exec prisma generate` 重新產生 client

## 2. 共用工具

- [x] 2.1 確認/補上密碼強度驗證 util（最低 8 碼；若專案已有共用 util 則複用，否則新增於 `apps/api/src/shared/utils/`）—沿用專案既有慣例：路由層 `z.string().min(8)`，不另立共用 util
- [x] 2.2 新增 reset token 產生/雜湊工具（隨機 bytes 產明文 token、sha256 雜湊，比照 `TrialSignup.verifyTokenHash` 模式）—實作於 `platform-password-recovery.service.ts` 內的 `newToken()`（與 `trial.service.ts` 同 pattern）

## 3. 平台帳號 CRUD（API）

- [x] 3.1 新增 `apps/api/src/modules/platform/platform-user.service.ts`：`listPlatformUsers`、`getPlatformUser(id)`、`createPlatformUser`（email 唯一性檢查、hashPassword、寄開通信、writePlatformAudit）
- [x] 3.2 `platform-user.service.ts` 新增 `updatePlatformUser`（改 name/email，email 唯一性檢查、writePlatformAudit）
- [x] 3.3 `platform-user.service.ts` 新增 `setPlatformUserActive`（停用/啟用；停用前檢查「至少保留 1 個啟用帳號」與「不可停用自己」；writePlatformAudit）
- [x] 3.4 `platform-user.service.ts` 新增 `resendPlatformUserWelcomeEmail`（不重設密碼，writePlatformAudit）
- [x] 3.5 `platform-user.service.ts` 新增 `getPlatformUserAuditLogs(id)`（查詢該帳號相關的 `PlatformAuditLog`，時間新到舊排序）
- [x] 3.6 在 `platform.routes.ts` 掛入路由：`GET /platform-users`、`GET /platform-users/:id`、`POST /platform-users`、`PATCH /platform-users/:id`、`PATCH /platform-users/:id/active`、`POST /platform-users/:id/resend-welcome`、`GET /platform-users/:id/audit-logs`，全部套 `authenticatePlatformSuperuser` guard
- [x] 3.7 API 回應統一排除 `passwordHash`、`resetTokenHash` 欄位—`PUBLIC_SELECT` 白名單控制

## 4. 密碼管理（API）

- [x] 4.1 新增 `apps/api/src/modules/platform/platform-password-recovery.service.ts`：`changeOwnPassword`（驗證舊密碼、更新 passwordHash、writePlatformAudit）—writePlatformAudit 在 route 層呼叫
- [x] 4.2 `platform-password-recovery.service.ts` 新增 `requestPasswordReset(email)`（防枚舉：無論帳號是否存在/啟用皆回相同結果；存在且啟用時才產生 token 並寄信）
- [x] 4.3 `platform-password-recovery.service.ts` 新增 `resetPasswordWithToken(token, newPassword)`（驗證 token 雜湊比對+未過期、更新密碼、清空 token 欄位；強度不足時保留 token 有效）
- [x] 4.4 在 `platform.routes.ts` 掛入路由：`POST /auth/change-password`（需 `authenticatePlatformSuperuser`）、`POST /auth/forgot-password`（公開）、`POST /auth/reset-password`（公開）
- [x] 4.5 公開路由（`forgot-password`、`reset-password`）加上 IP rate limit（比照 trial 模組的限流設定模式）

## 5. Email 模板

- [x] 5.1 新增平台帳號開通信模板（純 HTML inline-style，仿 `trial-emails.ts` 的 `MANUAL_PROVISIONED_HTML`），文案註明密碼由開通人員線下轉交
- [x] 5.2 新增平台帳號密碼重設信模板（純 HTML inline-style，仿 `VERIFY_HTML`），內含帶明文 token 的重設連結、有效期提示
- [x] 5.3 對應 `sendPlatformUserProvisionedEmail` / `sendPlatformPasswordResetEmail` 函式，走既有 `email.service.ts` 的 `safeSend`（失敗只 log 不拋錯）—新檔 `platform-user-emails.ts`

## 6. 前端 — 平台帳號管理

- [x] 6.1 `apps/web/src/app/admin/lib/platform-api.ts` 新增對應 API 呼叫函式（list/get/create/update/setActive/resendWelcome/getAuditLogs）—沿用專案既有慣例：頁面內直接呼叫 `platformApi.get/post/patch`，不另立 wrapper 函式層（tenants/plans 等既有頁面皆同此模式）
- [x] 6.2 新增 `apps/web/src/app/admin/platform-users/page.tsx`：帳號列表（email/name/isActive/lastLoginAt）+ 開通表單（Modal 或獨立頁）
- [x] 6.3 新增 `apps/web/src/app/admin/platform-users/[id]/page.tsx`：詳細資料、編輯 name/email、停用/啟用按鈕（含防呆錯誤訊息顯示）、重寄開通信按鈕、稽核記錄列表
- [x] 6.4 平台後台 nav 新增「平台帳號」入口（比照現有 tenants/plans 等項目）—另加「修改密碼」連結；layout 的登入守衛加入 forgot/reset-password 為公開頁

## 7. 前端 — 密碼管理

- [x] 7.1 新增改密碼頁（已登入平台管理員可用，需輸入舊密碼+新密碼）
- [x] 7.2 新增忘記密碼申請頁（公開，輸入 email，送出後顯示通用成功訊息）
- [x] 7.3 新增密碼重設頁（帶 token query param，輸入新密碼，成功後導向平台登入頁）

## 9. 追加變更（2026-09-03）：開通密碼改系統產生 + 首次登入強制改密碼

使用者確認開通密碼要改成「系統隨機產生、寄信告知、首次登入強制改密碼」，取代原本「開通人手動輸入密碼、信不含密碼」的設計。proposal/design/specs 已同步更新，以下為對應實作任務。

- [x] 9.1 `PlatformUser` schema 新增 `mustChangePassword Boolean @default(false)`，產生 migration 並套用（migration `20260903130000_add_platform_user_must_change_password`）
- [x] 9.2 新增臨時密碼產生工具（高熵英數混合，長度足夠；置於 `platform-user.service.ts` 或共用 util）—`shared/utils/temp-password.ts` 的 `generateTempPassword()`，14 碼、排除 0/O/1/l/I 易混淆字元
- [x] 9.3 `createPlatformUser` 改為：不收 password 參數、呼叫臨時密碼產生工具、hashPassword 存入、設 `mustChangePassword: true`、開通信改帶明文臨時密碼（不再是「不含密碼」版本）
- [x] 9.4 `resendPlatformUserWelcomeEmail` 改為：產生新臨時密碼覆蓋舊 `passwordHash`、設 `mustChangePassword: true`、開通信帶新臨時密碼
- [x] 9.5 `platform-user-emails.ts` 的 `PLATFORM_USER_PROVISIONED_HTML` 改為含明文臨時密碼欄位（`tempPassword`，`passwordBox` 等寬字體樣式凸顯），移除「密碼由開通人員線下轉交」文案，改為「請於登入後立即修改密碼」提示
- [x] 9.6 `changeOwnPassword` 成功後需清除 `mustChangePassword`（若為 true）—另外 `resetPasswordWithToken`（忘記密碼流程）也一併清除，確保任何改密碼路徑都能解除限制
- [x] 9.7 平台 JWT payload／`authenticatePlatformSuperuser` guard 需帶出並檢查 `mustChangePassword`：為 true 時，除 `/auth/change-password` 外的其他平台 API 一律拒絕（新錯誤碼如 `MUST_CHANGE_PASSWORD`）—guard 即時查 DB 取得最新值（非信任 JWT payload 快照），route 層加 `blockIfMustChangePassword` preHandler、`authOnlyGuard`（僅驗身分不擋）供 change-password 路由用
- [x] 9.8 平台登入 API 回傳需帶 `mustChangePassword`，供前端判斷是否強制導向改密碼頁
- [x] 9.9 前端：登入成功後偵測 `mustChangePassword`，強制導向 `/admin/change-password`（不可跳過，關閉正常 nav）；`platformApi` 攔截器對 `MUST_CHANGE_PASSWORD` 錯誤碼也導向該頁—用 localStorage flag `platformMustChangePassword` 供 layout 判斷是否隱藏側邊欄
- [x] 9.10 前端：開通表單移除密碼輸入欄位（改為系統產生，不需使用者填寫）
- [x] 9.11 更新 proposal/design/specs 對應段落（已完成，此項為確認 checklist）—openspec validate 通過
- [x] 9.12 typecheck 全綠（api + web）
- [x] 9.13 端到端手動驗證：開通新帳號 → 收到含臨時密碼的開通信 → 用臨時密碼登入 → 強制導向改密碼 → 改密碼成功 → 可正常使用後台其他功能；改密碼前嘗試呼叫其他 API 應被拒絕（API 直測全過，用已知密碼模擬臨時密碼登入情境）
- [x] 9.14 端到端手動驗證：重寄開通信會產生新臨時密碼且舊臨時密碼失效（驗證通過：resend-welcome 後 mustChangePassword 重設 true、舊密碼登入回 401）
- [x] 9.15 更新 `CHANGELOG.md` 與 memory 反映此次追加變更

## 8. 驗證與收尾

- [x] 8.1 typecheck 全綠（api + web）
- [x] 8.2 端到端手動驗證：開通新平台帳號 → 收到開通信 → 登入 → 自助改密碼（API 層直測，SMTP 寄信無報錯；密碼變更/舊密碼錯誤拒絕皆驗證通過）
- [x] 8.3 端到端手動驗證：忘記密碼 → 收到重設信 → 用 token 設新密碼 → 登入成功；逾期/已用過 token 驗證被拒（以已知 token/hash 對打入 DB 方式繞過信箱驗證流程，成功/逾期/重用三情境皆驗證通過）
- [x] 8.4 端到端手動驗證：停用非自己帳號成功；嘗試停用自己被拒；嘗試停用最後一個啟用帳號被拒（前兩者驗證通過；**設計備註**：最後一個啟用帳號的 count 防呆在目前流程下實際上不可達——呼叫者必須是已登入=active，停用「非自己」的帳號時 active 數至少為 2，故一定先撞到 self-guard；count-guard 是合理的縱深防禦保留，非 bug）
- [x] 8.5 確認所有寫入操作（開通/編輯/停用啟用/重寄信/改密碼/重設密碼）皆出現在 `PlatformAuditLog` 且可在帳號詳細頁查到（12 筆操作紀錄逐一核對 action 名稱與時間，全數正確）
- [x] 8.6 更新 `CHANGELOG.md`
- [x] 8.7 更新 memory：`project_platform_control_plane.md` 補上本次 change 完成狀態
