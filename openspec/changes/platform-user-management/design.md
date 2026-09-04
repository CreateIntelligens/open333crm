## Context

`PlatformUser` model 已存在（`packages/database/prisma/schema.prisma`），欄位為 `id/email/name/passwordHash/isActive/lastLoginAt/createdAt/updatedAt`，關聯 `PlatformAuditLog`。平台認證走獨立 JWT namespace（`namespace: 'platform'`），guard 為 `authenticatePlatformSuperuser`，JWT payload 的 `role` 目前寫死 `'PLATFORM_SUPERUSER'`（DB 無 role 欄位）。現存唯一一筆平台帳號是手動 SQL 灌的 dev 帳號。

平台後台前端在 `apps/web/src/app/admin/`，已有 `plans/tenants/trial/usage/plan-changes` 等頁面可參照佈局與 `admin/lib/platform-api.ts` 的呼叫慣例。

租戶開通已有成熟模式可直接複用（`platform-tenant.service.ts` 的 `provisionTenantViaApi`）：表單輸入密碼 → `hashPassword` 存 → 寄信只含 `loginUrl` 不含密碼 → 密碼線下轉交。密碼重設機制目前系統完全沒有（租戶、平台皆無），需要新設計；`TrialSignup` 的 `verifyTokenHash`（sha256 雜湊 + 時效 + 單次使用）是唯一可參照的「時效 token」既有模式。

## Goals / Non-Goals

**Goals:**
- 平台管理員可在後台開通、列表、編輯、停用/啟用其他平台帳號
- 平台帳號可自助改密碼（已登入）與忘記密碼自助重設（未登入）
- 所有變更動作寫入 `PlatformAuditLog`，可在帳號詳細頁查詢
- 防呆：系統任何時候至少保留 1 個啟用中平台帳號；不可停用自己

**Non-Goals:**
- 不做平台帳號的角色/權限分級（沿用單一 `PLATFORM_SUPERUSER`，DB 不新增 role 欄位）
- 不做平台帳號的硬刪除（只有 `isActive` 軟停用）
- 不做租戶端（Agent）的密碼重設——本次僅涵蓋 `PlatformUser`，租戶端若要比照需另開 change
- 不做 SSO / MFA / OAuth 登入

## Decisions

**1. 角色沿用現況，不新增 role 欄位**
維持 JWT payload 寫死 `role: 'PLATFORM_SUPERUSER'`，`PlatformUser` schema 不變。理由：平台管理員人數少（1-2 人），提前做分級是過度設計；未來若真的要分級，`role` 欄位可用一個小型 migration 補上，不影響本次設計。

**2. 開通密碼改為系統隨機產生、寄信告知，首次登入強制改密碼**（2026-09-03 修訂，取代原「比照租戶開通、密碼線下轉交」決策）
開通表單只填 name/email，不再輸入密碼。後端以 `crypto.randomBytes` 產生一組高熵臨時密碼（英數混合，見下方實作細節），`hashPassword` 存入，**開通信直接帶明文臨時密碼**，並標記 `mustChangePassword: true`。新帳號用臨時密碼登入後，後端在 JWT payload 帶出 `mustChangePassword` 旗標，前端偵測到即強制導向改密碼頁，改密碼成功後才清除旗標、才能使用後台其他頁面。
- 為什麼改變原決策：使用者明確要求「系統寄信、對方登入後自行改密碼」的體驗，不想要「開通人手動輸入密碼再線下口頭轉交」的額外人工步驟。
- 原本否決「email 含密碼」的理由（外洩風險）仍然成立，但透過**臨時密碼 + 強制首次改密碼 + 短時效**的組合緩解：臨時密碼只在「未改密碼」這個短暫窗口內有效，一旦改密碼舊值立即失效；且僅供本人登入用，非長期使用的密碼。
- 與租戶開通流程（`provisionTenantViaApi`）分道而不強求一致：租戶開通對象是外部客戶、組織規模較大，密碼線下轉交更符合其操作習慣；平台帳號是內部少數管理員，系統寄送臨時密碼可接受，兩者情境不同，不必套同一模式。

**3. 忘記密碼 token 機制新建，比照 `TrialSignup.verifyTokenHash` 模式**
`PlatformUser` 新增 `resetTokenHash`（sha256，不存明文 token）、`resetTokenExpiresAt`。流程：
- 申請重設 → 產生亂數 token → sha256 存 hash + 設過期時間（建議 1 小時，比 trial 驗證信的 24 小時更短，因為是帳號安全性操作）→ 寄信帶明文 token 連結
- 驗證/送出新密碼 → 用送入 token 算 sha256 比對 `resetTokenHash` 且未過期 → 通過後更新 `passwordHash`、**立即清空 `resetTokenHash`/`resetTokenExpiresAt`**（單次使用）
- 為防帳號枚舉：申請重設 API 對「email 不存在」與「email 存在」一律回相同回應（202），這點沿用 `trial-signup` 已驗證過的防枚舉模式

**4. 防呆規則在 service 層做，不在 DB constraint 做**
- 停用帳號前檢查：`prisma.platformUser.count({ where: { isActive: true } })`，若停用後將歸零則擋（`AppError PLATFORM_LAST_USER_ACTIVE`）
- 停用帳號前檢查：目標 id 不可等於 `request.platformUser.id`（來自 JWT），否則擋（`AppError CANNOT_DISABLE_SELF`）
- 理由：這是業務邏輯而非資料完整性約束，DB constraint 難以表達「至少 1 筆 isActive=true」這種跨列規則，service 層檢查配合稽核紀錄更直觀

**5. Email 模板沿用純 HTML inline-style，不用 MJML**
沿用 `trial-emails.ts` 已驗證的 `render()` + `escapeHtml()` + inline-style table 模式。理由：專案先前已踩過 MJML 可選依賴未安裝、fallback 把連結吃掉的坑（見 `project_platform_control_plane` memory），純 HTML 模板已是團隊確認可用的作法，沒有理由引入新風險。

**6. 忘記密碼申請/驗證為公開路由，需加 rate limit**
比照 `trial` 模組公開路由的 rate limit 設計（signup 5/10min、verify 10/min per IP），忘記密碼申請與驗證同樣需要限流，避免被用來刺探/暴力破解平台帳號。

## Risks / Trade-offs

- **[風險] 忘記密碼 token 走 email，若平台 SMTP 未設定（如目前 UAT 曾發生過 email 服務不可用），管理員會被鎖死** → 緩解：沿用現有 `safeSend` fire-and-forget + log 失敗的模式，同時保留「手動 SQL 改密碼」作為 SRE 最後手段（不在本次 UI 範圍內，但文件化在 runbook）
- **[風險] 開通信直接帶明文臨時密碼，email 信箱本身若遭入侵可直接取得臨時密碼** → 緩解：臨時密碼僅在「尚未改密碼」的短暫窗口內有效（`mustChangePassword` 未清除前無法使用其他功能）、改密碼後舊值立即失效；同時開通信仍不含其他敏感資訊，風險範圍侷限在單一帳號的短暫視窗
- **[風險] 系統開通仍需驗證密碼強度，避免產生的臨時密碼或後續自訂密碼過弱** → 緩解：後端加基本密碼強度驗證（沿用專案既有慣例：路由層 `z.string().min(8)`，比照 `provisionSchema.adminPassword`）；系統產生的臨時密碼固定走高熵演算法，天然滿足強度要求
- **[取捨] 不做角色分級代表未來若要開「唯讀客服帳號」需要另一次 schema 變更** → 可接受：目前規模不需要，過早設計分級會增加本次複雜度且未經驗證的需求可能設計錯

## Migration Plan

1. Prisma migration：`PlatformUser` 新增 `resetTokenHash String?` / `resetTokenExpiresAt DateTime?`（nullable，向下相容，不影響現有唯一一筆帳號）；另新增 `mustChangePassword Boolean @default(false)`（既有帳號預設 false，不受影響，僅新開通帳號會是 true）
2. 部署 API（新路由、新 service）與前端（新頁面）；因是純新增能力，無需 feature flag，上線即可用
3. Rollback：若需回退，migration 為新增欄位（nullable 或有 default），`prisma migrate` 可安全 down；API/前端回退為一般部署回退，無資料遺失風險（前提是尚未有帳號實際觸發忘記密碼流程產生 token）

## Open Questions

- 密碼強度規則的具體門檻（僅長度 ≥8，或加大小寫/數字要求？）留給 tasks 階段依現有 `hashPassword` 呼叫慣例決定，若專案別處已有共用密碼驗證 util 則直接複用
- 忘記密碼 token 有效期抓 1 小時是設計建議值，可在 tasks 實作時依 `PlatformSetting` 是否要做成可調參數再定案（目前傾向寫死常數，過度參數化非必要）
