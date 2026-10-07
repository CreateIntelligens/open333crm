# platform-auth Specification

## Purpose

定義平台管理員（superuser）的認證與授權：獨立的平台登入與 JWT、保護所有平台路由的 guard，以及平台寫入操作的稽核紀錄。平台帳號的管理見 `platform-user-management`，密碼見 `platform-password-recovery`。

## Requirements

### Requirement: 平台 superuser 獨立認證路徑
系統 SHALL 提供 `PlatformUser` 全域表（不帶 tenantId）與平台登入端點 `POST /api/v1/platform/auth/login`，簽發以獨立 `PLATFORM_JWT_SECRET` 簽名的平台 JWT（payload 含 `platformUserId`、`role: 'PLATFORM_SUPERUSER'`）。租戶 JWT 與平台 JWT MUST 使用不同 secret，互相驗證 MUST 失敗。

#### Scenario: 平台帳號登入成功
- **WHEN** 有效的 PlatformUser email/密碼呼叫平台登入
- **THEN** 回傳平台 JWT，payload 的 role MUST 為 `PLATFORM_SUPERUSER`

#### Scenario: 租戶 JWT 打平台 API
- **WHEN** 帶租戶簽發的 JWT 呼叫 `/api/v1/platform/*`
- **THEN** 驗證 MUST 失敗並回 401

### Requirement: requirePlatformSuperuser guard 保護全部平台路由
所有 `/api/v1/platform/*` 路由（登入除外）MUST 掛 `requirePlatformSuperuser()`，非平台 superuser 一律回 403/401。平台 superuser MUST NOT 因此獲得任何租戶 data-plane API 的存取權。

#### Scenario: 未帶 token 存取平台 API
- **WHEN** 無 Authorization 呼叫 `GET /api/v1/platform/plans`
- **THEN** 回 401

#### Scenario: 平台 JWT 打租戶 API
- **WHEN** 帶平台 JWT 呼叫租戶 API（如 `GET /api/v1/agents`）
- **THEN** 認證 MUST 失敗（平台 JWT 過不了租戶認證路徑）

### Requirement: 平台操作稽核
平台管理員執行下列寫入操作時，API MUST 寫入一筆 `PlatformAuditLog`，內容含 platformUserId、action、targetType、targetId、payload 摘要與 createdAt：

- 租戶：開通、修改名稱或方案、啟用或停用、修改成員的 email、重寄成員的開通信、修改合約日期。
- 試用：延長、轉為付費方案、復原已軟刪的租戶、把試用申請標為失敗。
- 方案：更新。方案申請：核准、駁回。
- 平台帳號：開通、修改、啟用或停用、重寄開通信、自助改密碼。
- 平台設定：更新。

payload MUST NOT 含密碼，也 MUST NOT 含平台設定的值。

#### Scenario: 改 plan 留稽核
- **WHEN** superuser 更新 trial plan 的 limits
- **THEN** MUST 新增一筆 PlatformAuditLog，action 含 plan 更新與目標 plan id

#### Scenario: 開通租戶的稽核不含管理員密碼
- **WHEN** 平台管理員以 `POST /api/v1/platform/tenants` 開通租戶，body 含管理員的密碼
- **THEN** API 寫入 action 為 `tenant.provision` 的稽核，payload 只含方案的 slug 與租戶名稱
- **AND** 稽核的內容不含管理員的密碼

#### Scenario: 更新平台設定的稽核不含設定值
- **WHEN** 平台管理員以 `PUT /api/v1/platform/settings/:key` 更新平台設定
- **THEN** API 寫入 action 為 `setting.update`、targetId 為設定 key 的稽核
- **AND** 稽核的內容不含設定的值
