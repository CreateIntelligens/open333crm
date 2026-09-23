# 平台後台（platform）

平台後台是營運方管理所有租戶的控制台。營運方在這裡開通租戶、調整方案、審核升級申請、追蹤跨租戶用量，並管理營運方自己的帳號。

`platform` 在檔案結構上是一個模組目錄，功能上卻是一組各自獨立的領域。服務層已經照領域拆開，一個領域一支服務；`platform.routes.ts` 沒有跟著拆，所有領域的路由都掛在同一個檔案。

- **資料來源**：`apps/api/src/modules/platform/*`、`apps/api/src/plugins/auth.plugin.ts`、`apps/web/src/app/admin/*`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-09-23

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 平台後台與租戶後台如何隔離？ | [與租戶後台的隔離](#與租戶後台的隔離) |
| 每個領域負責什麼？有哪些業務規則？ | [各領域的職責](#各領域的職責) |
| 改一個方案會影響什麼？為什麼要失效快取？ | [方案異動的連鎖效果](#方案異動的連鎖效果) |
| 平台操作的稽核怎麼寫？ | [稽核](#稽核) |
| 這個模組用哪些資料表？ | [資料模型](#資料模型) |
| 現在哪些部分有問題？ | [目前的限制](#目前的限制) |

模組屬於哪個後台、掛在哪個路由前綴、對應哪個 `/admin` 頁面，見[模組總覽](./OVERVIEW.md)的平台後台一節。

## 與租戶後台的隔離

兩個後台沒有共用的認證路徑。

| | 平台後台 | 租戶後台 |
| --- | --- | --- |
| 資料表 | `platform_users` | `agents` |
| JWT secret | `PLATFORM_JWT_SECRET` | `JWT_SECRET` |
| 認證裝飾器 | `authenticatePlatformSuperuser` | `authenticate` |
| 請求身分 | `request.platformUser` | `request.agent` |
| 前端 token | localStorage 的獨立 key，由 `apps/web/src/app/admin/lib/platform-api.ts` 管理 | 另一個 key，由 `apps/web/src/lib/api.ts` 管理 |

未設定 `PLATFORM_JWT_SECRET` 時，`POST /api/v1/platform/auth/login` 回 503 `PLATFORM_DISABLED`。整個控制台因此可以在不需要的環境關閉。

平台層的資料表沒有 RLS，因此這個模組全程使用 `fastify.prismaAdmin`（`app_admin` 連線，BYPASSRLS）。兩支租戶隔離檢查腳本以 `/modules\/platform\//` 為白名單，以目錄為單位。

## 各領域的職責

### 平台帳號認證

服務：`platform-auth.service.ts`、`platform-password-recovery.service.ts`

`platformLogin()` 有兩道防帳號枚舉的設計：

- 帳號不存在時仍對一個假雜湊執行一次 `verifyPassword()`，抹平回應時間差。
- 帳號不存在、已停用、密碼錯誤三種情況回同一個 401 `UNAUTHORIZED`。

忘記密碼的流程同樣防枚舉：`requestPasswordReset()` 無論信箱存在與否都回成功，只有存在且啟用中的帳號才真的產生 token 並寄信。

重設 token 的規則：

- 32 bytes 隨機值，資料庫只存 `sha256` 雜湊，明文只出現在信裡。
- 有效 60 分鐘。
- 單次使用，重設成功後立即清空 token 欄位。
- 新密碼強度不足時保留 token 有效，讓使用者重新提交。

`mustChangePassword` 標記臨時密碼。系統產生臨時密碼時設為真，使用者改密碼成功後清除。

`platform.routes.ts` 因此有兩組 guard：`guard` 含 `blockIfMustChangePassword`，`authOnlyGuard` 不含。除了 `POST /auth/change-password` 用 `authOnlyGuard` 之外，其餘已登入的路由都用 `guard`。這個差別是必要的——未改密碼的使用者必須還能呼叫改密碼那一條。

### 平台帳號管理

服務：`platform-user.service.ts`、`platform-user-emails.ts`

建立、停用、修改營運方帳號，以及重寄開通信。`GET /platform-users/:id/audit-logs` 查該帳號的操作紀錄。

### 租戶管理

服務：`platform-tenant.service.ts`

`provisionTenant()` 是開通的核心，依序建立三樣東西：`Tenant`、系統角色、管理員 `Agent`。

這個函式收呼叫端提供的 transaction client，因此兩條開通路徑共用同一份邏輯：

| 路徑 | 呼叫者 | 差異 |
| --- | --- | --- |
| 平台手動開通 | `provisionTenantViaApi()`，平台路由呼叫 | 自行開 transaction |
| 試用自動開通 | `trial` 模組的 `trial.service.ts` | 與 token 消耗在同一個 transaction 內 |

密碼由呼叫端決定傳明文（函式內部 hash）或已 hash 的值。試用流程在申請時就已 bcrypt，開通時直接搬過來。

### 方案與上限

服務：`plan.service.ts`、`plan-limits.service.ts`

`Plan` 定義四種東西：`features`（功能模組清單）、`limits`（數值上限）、`allowedChannelTypes`、`permissionOverrides`。

**`plan-limits.service.ts` 不屬於平台後台。** 沒有任何平台路由呼叫這支服務。它的工作是解析單一租戶的有效上限，呼叫者都在租戶側：`agent.service.ts`、`channel.service.ts` 與 `trial/token-quota.service.ts`。計算方式是：

```text
有效上限 = Tenant.limitOverrides[key] ?? Plan.limits[key]
```

回傳 `null` 代表無上限。三種情況都會得到 `null`：

- `limitOverrides` 或 `limits` 裡該 key 的值本身是 null。
- 租戶沒有綁定方案。
- 方案沒有定義這個 key。

### 方案異動審核

服務：`plan-change.service.ts`

租戶在租戶後台的 `/api/v1/plan-change` 提出申請，需要 `settings.manage` 權限。平台在這個領域審核。兩種申請型別的核准行為不同：

| 型別 | 核准後的動作 |
| --- | --- |
| `upgrade` | 改 `tenant.planId` |
| `token_topup` | 把加購量加進 `tenant.limitOverrides.monthlyTokens`，疊在方案額度之上 |

`token_topup` 有一道保護：目前有效額度已經是無上限時，核准會被擋下並回 400 `TOPUP_UNLIMITED`。若不擋，管理員會以為加購生效，實際上沒有任何效果。

申請狀態不是 `pending` 時，核准與駁回都回 400。

### 試用管理

服務：`trial-admin.service.ts`

對外的申請與信箱驗證在 `trial` 模組，平台只做審核與生命週期操作。

`extendTrial()` 從「現有到期日」與「今天」取較晚者起算，避免對尚未到期的租戶延長反而縮短期限。延長同時做兩件事：把 `isActive` 設為真（已到期停用的租戶因此恢復），並清空 `trialRemindersSent`，讓新週期重新發提醒。

`convertToPaid()` 改 `planId` 並把 `trialEndsAt` 清成 null。清空代表脫離試用，不再受到期排程管轄。目標方案是 `trial` 時擋下。

`restorePurgedTenant()` 清除 `purgedAt`，但不動 `isActive`，租戶維持停用狀態。業務資料本來就是軟刪，復原只是讓平台方重新看到它不是「已清除」。

`updateTenantContract()` 只是記錄，不觸發任何自動生命週期行為。兩個日期都是選用的：傳 `undefined` 不動該欄、傳 `null` 清除、傳日期設值。更新後兩者都有值時，迄日必須不早於起日，否則回 422 `CONTRACT_DATE_INVALID`。這個檢查會合併資料庫現值比對，因此只傳其中一個日期也擋得住。

### 用量統計

服務：`platform-usage.service.ts`

資料來源是 `AiUsage`。三個規則：

- 只計 `success = true` 的呼叫。失敗的呼叫計入次數，但不計 token 與成本。
- `costUsd` 一律在後端以 Decimal 加總。前端只顯示，不對字串做加總。
- 單價來自 `ModelPricing`，該表有分級費率與生效日期。

### 平台設定與權限註冊表

服務：`platform-setting.service.ts`

`PlatformSetting` 是以 `key` 為主鍵的 JSON 設定表。`GET /registry` 不讀資料庫，它回傳 `buildPlatformRegistry()` 的功能清單，以及從 Prisma 的 `ChannelType` enum 動態取得的渠道類型，因此新增渠道類型不需要改這段程式。

## 方案異動的連鎖效果

改方案不只是寫一個欄位。租戶的功能天花板、方案內容與 AI 額度各有一層快取，漏掉任何一層都會讓變更延遲生效。

| 快取 | 失效函式 | 位置 | 存活時間 |
| --- | --- | --- | --- |
| 權限天花板 | `invalidatePlanPermissions(prisma, planId)` | `services/permission.service.ts` | Redis，600 秒 |
| 租戶方案 | `invalidateTenantPlan(tenantId)` | `services/tenant-plan.cache.ts` | 行程內，60 秒 |
| AI 額度 | `clearTokenQuotaCache(tenantId)` | `modules/trial/token-quota.service.ts` | 見該檔 |

四個地方會改動方案，各自需要失效的快取不同：

| 動作 | 需要失效 |
| --- | --- |
| `plan.service.ts` 的 `updatePlan()` | `features` 或 `permissionOverrides` 有變更時，失效權限天花板 |
| `plan-change.service.ts` 核准 `upgrade` | 權限天花板 + 租戶方案 |
| `plan-change.service.ts` 核准 `token_topup` | 租戶方案 + AI 額度 |
| `trial-admin.service.ts` 的 `convertToPaid()` | 權限天花板 + 租戶方案 |

`convertToPaid()` 的註解說明了漏掉的後果：租戶方案快取存活 60 秒，不失效的話，剛付費的租戶在這段期間仍沿用舊的試用天花板，新功能會被 guard 誤擋成 403。權限天花板快取存活 600 秒，漏掉的影響時間更長。

## 稽核

`platform-audit.service.ts` 的 `writePlatformAudit()` 把操作寫進 `platform_audit_logs`，欄位有 `platformUserId`、`action`、`targetType`、`targetId` 與 `payload`。

**稽核由路由負責寫入，服務內部不重複寫。** `trial-admin.service.ts` 第 58 行的註解說明了這個分工的理由：路由持有 `request.platformUser.id`，服務沒有。

新增異動路由時要一併補上 `writePlatformAudit()` 的呼叫。沒有任何檢查會攔下漏寫。

四條異動路由目前沒有寫稽核，見[目前的限制](#目前的限制)。

## 資料模型

平台層的資料表都沒有 RLS，下表列出全部。

| 表 | 用途 |
| --- | --- |
| `platform_users` | 營運方帳號。含 `resetTokenHash`、`resetTokenExpiresAt`、`mustChangePassword`、`lastLoginAt` |
| `platform_audit_logs` | 平台操作紀錄，關聯到 `platform_users` |
| `platform_settings` | 以 `key` 為主鍵的 JSON 設定 |
| `plans` | 方案。`slug` 唯一，`isActive` 為假代表停售軟下架 |
| `model_pricings` | LLM 單價，含分級費率與生效日期 |
| `trial_signups` | 試用申請。`emailNormalized` 唯一，用來擋 Gmail 別名重複申請 |
| `tenants` | 租戶。`planId`、`limitOverrides`、`trialEndsAt`、`purgedAt`、合約起訖日 |

`plan_change_requests` 有 `tenantId`，屬於租戶表，有 RLS。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **登入與密碼重設沒有稽核紀錄** | `POST /auth/login`、`/auth/forgot-password`、`/auth/reset-password` 與 `/trial-signups/:id/resend` 四條路由沒有呼叫 `writePlatformAudit()`，對應的服務內部也沒有寫。詳見 `../system/AUDIT.md` 的 SEC-02 |
| **rate-limit 綁在路由 scope 內** | `@fastify/rate-limit` 在整個 API 只註冊一次，而且註冊在 `platformRoutes()` 函式內部。拆分 `platform.routes.ts` 之前必讀 `../system/AUDIT.md` 的 SEC-03 |
| 沒有任何測試 | `apps/api/src/__tests__/` 沒有檔案涵蓋這個模組。所有路由與服務都沒有回歸保護，CI 也沒有執行測試，見 `../system/AUDIT.md` 的 CI-01 |
| 路由檔沒有跟著領域拆 | `platform.routes.ts` 是 repo 中路由數最多的單一檔案，一個檔案服務下列所有領域。這是 `AGENTS.md` 模組結構規則 3 的已知例外 |
| `GET /trial-signups` 直接查資料庫 | 這是 `platform.routes.ts` 唯一沒有委派給服務的路由，是規則 1 的已知例外 |
| 合約與復原的歸屬與路由名稱不一致 | `PATCH /tenants/:id/contract` 與 `/tenants/:id/restore` 看起來屬於租戶管理，實作在 `trial-admin.service.ts` |
