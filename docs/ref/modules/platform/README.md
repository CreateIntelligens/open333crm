# 平台後台（platform）

平台後台是營運方管理所有租戶的控制台。營運方在這裡開通租戶、調整方案、審核升級申請、追蹤跨租戶用量，並管理營運方自己的帳號。

`platform` 在檔案結構上是一個模組目錄，功能上卻是一組各自獨立的領域。服務層已經照領域拆開，一個領域一支服務；`platform.routes.ts` 沒有跟著拆，所有領域的路由都掛在同一個檔案。

- **資料來源**：`apps/api/src/modules/platform/*`、`apps/api/src/plugins/auth.plugin.ts`、`apps/web/src/app/admin/*`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-09-23

## 本目錄的文件

每個領域一份文件。本檔只放跨領域的共通機制。

| 文件 | 領域 | 適合解答的問題 |
| --- | --- | --- |
| [平台帳號認證](./AUTH.md) | 登入與密碼 | 防帳號枚舉怎麼做？重設 token 的規則是什麼？ |
| [平台帳號管理](./PLATFORM-USERS.md) | 營運方帳號 | 怎麼建立與停用營運方帳號？ |
| [租戶管理](./TENANTS.md) | 租戶 | 開通一個租戶會建立哪些東西？ |
| [方案與上限](./PLANS.md) | 方案 | `Plan` 的四個欄位各自控制什麼？空值代表什麼？ |
| [方案異動審核](./PLAN-CHANGES.md) | 升級與加購 | 兩種申請型別核准後各做什麼？ |
| [試用管理](./TRIALS.md) | 試用 | 試用的生命週期是什麼？誰能延長？ |
| [用量統計](./USAGE.md) | 用量 | 成本怎麼算？哪些呼叫不計入？ |
| [平台設定與權限註冊表](./SETTINGS.md) | 設定 | 平台設定存在哪裡？`/registry` 回傳什麼？ |

模組屬於哪個後台、掛在哪個路由前綴、對應哪個 `/admin` 頁面，見[模組總覽](../OVERVIEW.md)的平台後台一節。

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

## 用語：天花板

多份文件會出現「天花板」。它是 repo 既有的用語，指**方案允許的權限上限**。一個使用者實際能做什麼，是角色權限與方案天花板的交集：

```text
有效權限 = 角色權限 ∩ 方案功能天花板
```

角色給得再多，方案沒開的功能仍然用不到；方案開得再多，角色沒有的權限也不會自動出現。`apps/api/src/guards/rbac.guard.ts` 是這個判斷的實作，`permission.service.ts`、`services/channel-visibility.ts` 與 socket 房間授權都比照同一個公式。平台後台 `/admin/plans` 的介面也用「功能天花板」這個詞。

原始碼裡「功能天花板」與「權限天花板」指同一件事，兩種寫法都有。這一組文件在講概念時用「功能天花板」，在指那一層快取時沿用程式碼註解的「權限天花板快取」。

## 方案異動的連鎖效果

改方案不只是寫一個欄位。租戶的功能天花板、方案內容與 AI 額度各有一層快取，漏掉任何一層都會讓變更延遲生效。

| 快取 | 失效函式 | 位置 | 存活時間 |
| --- | --- | --- | --- |
| 權限天花板快取 | `invalidatePlanPermissions(prisma, planId)` | `services/permission.service.ts` | Redis，600 秒 |
| 租戶方案快取 | `invalidateTenantPlan(tenantId)` | `services/tenant-plan.cache.ts` | 行程內，60 秒 |
| AI 額度快取 | `clearTokenQuotaCache(tenantId)` | `modules/trial/token-quota.service.ts` | 見該檔 |

四個地方會改動方案，各自需要失效的快取不同：

| 動作 | 需要失效 |
| --- | --- |
| `plan.service.ts` 的 `updatePlan()` | `features` 或 `permissionOverrides` 有變更時，失效權限天花板快取 |
| `plan-change.service.ts` 核准 `upgrade` | 權限天花板快取 + 租戶方案快取 |
| `plan-change.service.ts` 核准 `token_topup` | 租戶方案快取 + AI 額度快取 |
| `trial-admin.service.ts` 的 `convertToPaid()` | 權限天花板快取 + 租戶方案快取 |

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
| **登入與密碼重設沒有稽核紀錄** | `POST /auth/login`、`/auth/forgot-password`、`/auth/reset-password` 與 `/trial-signups/:id/resend` 四條路由沒有呼叫 `writePlatformAudit()`，對應的服務內部也沒有寫。詳見 `../../system/AUDIT.md` 的 SEC-02 |
| **rate-limit 綁在路由 scope 內** | `@fastify/rate-limit` 在整個 API 只註冊一次，而且註冊在 `platformRoutes()` 函式內部。拆分 `platform.routes.ts` 之前必讀 `../../system/AUDIT.md` 的 SEC-03 |
| 沒有任何測試 | `apps/api/src/__tests__/` 沒有檔案涵蓋這個模組。所有路由與服務都沒有回歸保護，CI 也沒有執行測試，見 `../../system/AUDIT.md` 的 CI-01 |
| 路由檔沒有跟著領域拆 | `platform.routes.ts` 是 repo 中路由數最多的單一檔案，一個檔案服務下列所有領域。這是 `AGENTS.md` 模組結構規則 3 的已知例外 |
| `GET /trial-signups` 直接查資料庫 | 這是 `platform.routes.ts` 唯一沒有委派給服務的路由，是規則 1 的已知例外 |
| 合約與復原的歸屬與路由名稱不一致 | `PATCH /tenants/:id/contract` 與 `/tenants/:id/restore` 看起來屬於租戶管理，實作在 `trial-admin.service.ts` |
