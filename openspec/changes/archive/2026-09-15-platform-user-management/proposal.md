## Why

平台控制平面（platform-control-plane）目前只有 1 個 dev 環境用手動 SQL 灌出來的 `PlatformUser` 帳號（`platform@open333crm.dev`），沒有任何後台介面可以開通、停用、管理平台管理員帳號。隨著平台方營運人力增加（例如需要多個平台管理員協作開通租戶、審核加購），必須有一個由既有平台管理員在後台直接「開通」新平台帳號的機制——不開放自行申請，帳號的存在本身就代表被授權。同時，目前系統完全沒有密碼重設機制（租戶端、平台端皆無），平台帳號一旦忘記密碼只能再次手動改 DB，這次一併補上。

## What Changes

- 新增平台帳號管理 API（`/platform/platform-users/*`），僅限已登入的平台管理員存取：
  - 開通新平台帳號（表單只需輸入 email/name，email 全域唯一；密碼由系統隨機產生，開通信直接告知該臨時密碼，並標記帳號須於首次登入後強制改密碼）
  - 列表 / 單筆查詢平台帳號
  - 編輯平台帳號資料（name/email）
  - 停用 / 啟用平台帳號（`isActive` 軟停用，不可硬刪除）
  - 重寄開通信（產生新的臨時密碼並重新標記須改密碼，不沿用舊臨時密碼）
  - 查詢單一平台帳號相關的 `PlatformAuditLog` 操作記錄
- 新增登入後自助改密碼 API（需驗證舊密碼；首次登入以臨時密碼改密碼後，`mustChangePassword` 旗標清除）
- 新增首次登入強制改密碼機制：帳號 `mustChangePassword=true` 時，除改密碼 API 外的平台 API 一律拒絕存取，直到改密碼完成
- 新增「忘記密碼」自助重設流程（申請重設信 → 帶時效 token 的連結 → 驗證後設新密碼），含對應 email 模板
- 新增防呆規則：系統至少保留 1 個啟用中平台帳號；平台管理員不可停用自己的帳號
- 開通、編輯、停用/啟用、改密碼、重設密碼皆寫入 `PlatformAuditLog`
- 新增平台後台前端頁面：`/admin/platform-users`（列表 + 開通表單）、`/admin/platform-users/[id]`（詳細頁 + 編輯 + 停用/啟用 + audit log）、忘記密碼頁、改密碼頁
- **BREAKING**：無。純新增能力，不影響既有 `PlatformUser` 登入、既有平台 API 行為

## Capabilities

### New Capabilities
- `platform-user-management`：平台管理員在後台開通/管理其他平台帳號的完整生命週期（開通、列表、編輯、停用/啟用、重寄開通信、稽核查詢）
- `platform-password-recovery`：平台帳號的自助改密碼與忘記密碼重設（token 時效、單次使用、驗證信）

### Modified Capabilities
（無既有 spec 行為變更；`PlatformUser` 目前尚無對應 spec 檔案）

## Impact

- **Schema**：`packages/database/prisma/schema.prisma` 的 `PlatformUser` model 新增 `resetTokenHash` / `resetTokenExpiresAt` 欄位（比照 `TrialSignup.verifyTokenHash` 模式）、新增 `mustChangePassword Boolean @default(false)` 欄位，需新 migration
- **API**：新增 `apps/api/src/modules/platform/platform-user.service.ts`、`platform-password-recovery.service.ts`，路由掛進既有 `platform.routes.ts`（沿用 `authenticatePlatformSuperuser` guard；忘記密碼申請/驗證為公開路由，需加 rate limit）；`authenticatePlatformSuperuser` guard 與平台 JWT payload 需帶出 `mustChangePassword`，供強制改密碼攔截判斷
- **Email**：`apps/api/src/modules/trial/trial-emails.ts`（或同層新檔）新增平台帳號開通信、密碼重設信模板，沿用純 HTML inline-style 模式（不用 MJML）
- **前端**：`apps/web/src/app/admin/platform-users/` 新增列表頁、詳細頁；新增忘記密碼、改密碼頁面；`apps/web/src/app/admin/lib/platform-api.ts` 新增對應呼叫函式
- **稽核**：沿用 `platform-audit.service.ts` 的 `writePlatformAudit`，無需新表
- **不影響**：租戶端帳號體系（Agent/Tenant）完全獨立，此變更僅涉及 `PlatformUser` 與平台後台
