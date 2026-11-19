---
name: feature-platform-users
description: >
  open333CRM「平台帳號管理」功能顧問：平台後台營運方帳號的開通、停用、重寄開通信、強制改密碼、平台稽核。改到 /admin/platform-users、platform-user.service、PlatformUser、PlatformAuditLog，或改平台登入、平台 guard 之前使用。
---

# 平台帳號管理

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。平台帳號的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

平台後台營運方帳號（`platform_users`）的開通（系統產生臨時密碼、寄開通信）、列表與詳細頁、改姓名與 email、
停用與啟用（不能停用自己、不能讓啟用帳號歸零）、重寄開通信（會換掉密碼）、首次登入強制改密碼（`mustChangePassword`、`MUST_CHANGE_PASSWORD`）、
帳號操作紀錄（`platform_audit_logs`）。
相關的程式與資料：`/admin/platform-users`、`platform-user.service`、`platform-user-emails`、`PlatformUser`、`PlatformAuditLog`。
常見的說法：「平台帳號」「平台管理員」「開通平台帳號」「臨時密碼」「重寄開通信」「停用平台帳號」「平台稽核」「操作紀錄」。
改平台登入、平台 guard、平台稽核寫入或 email 寄信模式之前也使用，確認不破壞平台帳號。

## 先讀

先讀功能文件 `docs/ref/features/platform/PLATFORM-USERS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `PLATFORM-USERS.md` 的章節 |
| --- | --- |
| 找路由對應的服務函式、兩套帳號的分界 | 程式的入口 |
| 平台 guard、停用與強制改密碼的檢查 | 每個請求都重新檢查帳號 |
| 開通、臨時密碼、開通信、email 正規化 | 建立帳號時不輸入密碼 |
| 重寄開通信 | 重寄開通信會換掉密碼 |
| 停用、啟用、Serializable 交易 | 停用帳號的兩道防呆 |
| 操作紀錄、稽核的 payload、新增異動路由 | 查一個帳號做過什麼 |
| 改姓名或 email | 修改帳號 |
| 前端頁面、強制改密碼頁 | 畫面怎麼呼叫 API |

平台後台共通機制（稽核分工、資料模型）見 `docs/ref/features/platform/README.md`。登入、忘記密碼、改密碼見 `docs/ref/features/platform/AUTH.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的相關測試在 `apps/api/tests/unit/modules/platform/`（`platform-audit-routes`、`platform-auth-guard`、`platform-auth-disabled`），寫法可以照著參考。`platform-user.service.ts` 本身沒有單元或 feature 測試。

`PLATFORM-USERS.md` 裡標 `HC-PLATFORM-USERS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-USERS.md`；登入相關問題在 `docs/ref/features/health/PLATFORM-AUTH.md`
- 規格：`openspec/specs/platform-user-management/spec.md`。改密碼與忘記密碼在 `openspec/specs/platform-password-recovery/spec.md`，guard 在 `openspec/specs/platform-auth/spec.md`。
- 影響分析：`node scripts/feature-impact.mjs --domain platform-users`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `PLATFORM-USERS.md` 括號內的章節。

- 平台帳號與租戶成員（`agents`）是兩套帳號、兩套 JWT（`platformJwtSign`），互打一律 401。不要把 `platform_users` 接到租戶 RBAC。（程式的入口）
- 臨時密碼只出現在開通信裡。資料庫只有雜湊，稽核 payload 不能放明文密碼。（建立帳號時不輸入密碼）
- `mustChangePassword` 由 guard 每次請求從資料庫讀，不讀 JWT。`blockIfMustChangePassword` 只放過 `/auth/change-password`。改 guard 時兩者都要保留。（每個請求都重新檢查帳號）
- 停用必須即時生效：`authenticatePlatformSuperuser` 每次查 `isActive`。停用是 `isActive=false`，不刪除，稽核歷史保留。（每個請求都重新檢查帳號、停用帳號的兩道防呆）
- 「不能停用自己」在交易外先擋。「至少一個啟用帳號」的讀取、計數、更新必須在同一個 Serializable 交易裡。改成較弱的隔離等級時，要另外防止同時停用讓帳號歸零。（停用帳號的兩道防呆）
- 重寄開通信會換掉密碼，不是單純重寄信。已停用的帳號擋 400。（重寄開通信會換掉密碼）
- 稽核由路由寫（`writePlatformAudit`），服務不寫。新增異動路由要一起補稽核，`apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 的清單也要加。（查一個帳號做過什麼）
- email 一律 `trim().toLowerCase()`，路由的 `platformEmail` 與服務的 `normalizeEmail` 兩層都做。（建立帳號時不輸入密碼）

## 回歸清單

改到本領域時，至少重走下列項目。本機測試一律自建 `hc-` 前綴的平台帳號，**不要改 seed 的 `platform@open333crm.dev`**。UAT 的平台後台只讀。

1. 開通帳號，email 含大寫與空白 → 列表出現，狀態「待改密碼」→ 同 email 再開通回 409。
2. 以新帳號登入：
   - 本機 log 模式拿不到臨時密碼，用 DB 設定**自建**帳號的雜湊。
   - 登入後被導到 `?forced=1`，其他 API 回 403。
   - 改密碼之後到 `/admin/plans`。
3. 改另一個帳號的姓名與 email（含改成重複 email 回 409）→ 重新整理讀回一致。
4. 停用另一個帳號 → 對方舊 token 401、登入 401 → 停用自己 400 → 啟用回來可登入。
5. 重寄開通信 → 對方舊密碼 401、舊 token 403 `MUST_CHANGE_PASSWORD`；停用中的帳號 400。
6. 操作紀錄看得到以上每一筆，新到舊，顯示操作者。

自動測試：

- `pnpm --filter @open333crm/api test -- platform-audit-routes platform-auth-guard platform-auth-disabled`

## 常見 bug 從哪裡查

- 「對方說收不到開通信」：
  - 寄信失敗只寫 log（`apps/api/src/modules/platform/platform-user-emails.ts` 的 `safeSend`，HC-PLATFORM-USERS-02）。查 API log 的 `[PlatformUserEmail] send failed`。
  - 補救是重寄開通信，這會再換一次密碼。
- 「同事的密碼突然不能用、一登入就被要求改密碼」：有人按了重寄開通信（HC-PLATFORM-USERS-01）。查該帳號操作紀錄的「重寄開通信」。
- 「停用時跳出『資料處理失敗』」：同時有另一筆停用在跑，Serializable 衝突（HC-PLATFORM-USERS-03）。再按一次即可。
- 「停不掉最後一個帳號／停不掉自己」：`PLATFORM_LAST_USER_ACTIVE`、`CANNOT_DISABLE_SELF`，設計如此。
- 「一直被導到改密碼頁、沒有登出鈕」：
  - `localStorage` 的 `platformMustChangePassword` 旗標與資料庫的 `mustChangePassword` 都要看。
  - 強制頁沒有登出入口（HC-PLATFORM-USERS-04）。清掉 `platformToken` 才能回登入頁走忘記密碼。
- 「詳細頁一直載入中」：網址的 id 錯或帳號不存在，頁面沒處理錯誤（HC-PLATFORM-USERS-05）。
