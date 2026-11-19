---
name: feature-platform-plans
description: >
  open333CRM「方案與上限」功能顧問：/admin/plans 的功能、上限與可用渠道類型，功能天花板與快取，上限硬擋。改到 plan.service、plan-limits.service、token-quota.service，或新增權限碼或 feature、改建立成員／渠道／AI 呼叫流程之前使用。
---

# 方案與上限

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。方案與上限的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

平台後台方案設定 `/admin/plans`：功能勾選 `features`、細分權限 deny、數值上限 `maxAgents`／`maxChannels`／`maxTags`／`monthlyTokens`、可用渠道類型 `allowedChannelTypes`。
功能天花板：角色權限 ∩ 方案天花板、Redis `perms:tenant` 快取、`getTenantPlanId` 60 秒行程內快取。
租戶覆寫 `limitOverrides`、上限硬擋 `PLAN_LIMIT_EXCEEDED`／`CHANNEL_TYPE_NOT_ALLOWED`、AI 月額度（aiquota 計數器）、租戶端方案頁 `/dashboard/plan`。
相關的程式：`plan.service`、`plan-limits.service`、`tenant-plan.cache`、`token-quota.service`。
常見問題：「方案」「升級後功能沒開」「換方案後 403」「客服人數上限」「渠道數上限」「AI 額度用完」「停售方案」「試用方案能不能接 LINE」。
新增權限碼或 feature、改 `requirePermission`、改建立成員、渠道或 AI 呼叫流程之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/platform/PLANS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `PLANS.md` 的章節 |
| --- | --- |
| 找路由對應的函式 | 程式的入口 |
| 上限與天花板在哪裡被擋、錯誤回應、AI 計數器、新增權限碼或 feature | 上限在哪裡被擋 |
| 方案欄位的意義 | 每個欄位各控制什麼、名稱與實際行為不符的欄位 |
| seed 方案、改既有方案的 migration | seed 建立的五個方案 |
| `updatePlanSchema` 的驗證 | 路由層先擋掉哪些值 |
| 停售 | 停售不會生效 |
| `limitOverrides`、無上限 | 有效上限怎麼算、什麼情況會變成無上限 |
| 快取失效、換方案 | 改了方案之後會發生什麼 |
| 加購 | 加購只加當月；`docs/ref/features/platform/PLAN-CHANGES.md` |
| 前端頁面 | 畫面怎麼呼叫 API |

共通機制（天花板用語、快取連鎖、資料模型）見 `docs/ref/features/platform/README.md`；權限計算見 `docs/ref/modules/PERMISSIONS.md`；方案異動申請見 `.claude/skills/feature-platform-plan-changes/SKILL.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/platform/`（`plan-limits`、`tenant-plan`）、`apps/api/tests/unit/modules/channel/`、`apps/api/tests/unit/modules/ai/`、`apps/api/tests/unit/modules/agent/`、`apps/api/tests/feature/modules/platform/`，寫法可以照著參考。

`PLANS.md` 裡標 `HC-PLATFORM-PLANS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-PLANS.md`
- 規格：`openspec/specs/tenant-plan/spec.md`、`openspec/specs/plan-limits-core/spec.md`、`openspec/specs/granular-plan-entitlement/spec.md`、`openspec/specs/token-quota/spec.md`
- 手冊：`apps/web/public/manual/ch14-plan.html`
- 影響分析：`node scripts/feature-impact.mjs --domain platform-plans`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `PLANS.md` 括號內的章節。

- 有效權限 = 角色權限 ∩（`features` 的權限點 ∪ `core`）−`permissionOverrides.deny`。`planId` 為 null 時不設天花板。新路由一定要掛 `requirePermission()`，否則方案關不掉它（PLAN-04）。（上限在哪裡被擋）
- 有效上限：`limitOverrides` **有這個 key**（含 null）就用覆寫，否則用方案的值，都沒有就是無上限（fail-open）。用 `hasOwnProperty`，不要改成 `??`。`monthlyTokens` 要停用 AI 只能填 `0`（PLAN-12）。（有效上限怎麼算、什麼情況會變成無上限）
- 改 `features` 或 `permissionOverrides` 必須呼叫 `invalidatePlanPermissions`。改租戶 `planId` 必須同時呼叫 `invalidateTenantPlan` 與 `invalidatePlanPermissions`。（改了方案之後會發生什麼）
- 換方案不刪 `RolePermission`。（改了方案之後會發生什麼）
- `PLAN_LIMIT_EXCEEDED` 一律 403，帶 `limitKey`、`current`、`max`（AI 只帶 `limitKey`）。新增上限時照這個形狀。（上限在哪裡被擋）
- 計數只算 `isActive: true` 的成員與渠道。把停用的資源改回啟用也要檢查上限：成員已做，渠道還沒做。（上限在哪裡被擋）
- AI 計數器 `aiquota:{tenantId}:{YYYY-MM}:tpe` 用台灣月份，只累加平台金鑰的成功呼叫；BYOK 不計不擋。（上限在哪裡被擋）
- 新增權限碼或 feature：權限碼在 `packages/shared/src/rbac/permissions.ts`，feature 在 `packages/core/src/rbac/features.ts`。既有租戶的系統角色要跑 `scripts/grant-new-role-permissions.mjs`。（上限在哪裡被擋）
- seed（API 容器每次啟動都跑）只建立不存在的方案，**不可以更新既有方案**（`tenant-plan` 規格「部署後保留平台修改」）。不要把 `seedPlans()` 改回 upsert 的 `update`。（seed 建立的五個方案）
- 程式要改既有方案的內容時，寫一次性的資料 migration，並同步更新 `SEED_PLANS`。範例 `20261103120000_enable_channels_on_trial_light`。（seed 建立的五個方案）
- UI 不放 emoji 與 ✓（使用者要求）。

## 回歸清單

改到本領域時，至少重走。在本機用 `hc-` 前綴的自建方案與租戶，不要改 seed 方案或 Demo 租戶的方案：

1. 用 SQL 建方案 → 平台 `POST /platform/tenants` 開通租戶 → 租戶 `GET /auth/me/permissions` 不含方案外的權限碼 → 打 `/marketing/campaigns` 回 403 `requiredPermission`。
2. `/admin/plans` 勾上該 feature → 儲存 → 同一個 token 立即回 200。再 deny 一個權限碼 → 立即消失。
3. `maxAgents`：建到上限回 403 `PLAN_LIMIT_EXCEEDED`；停用一位 → 建新的 → 重新啟用舊的要回 403。
4. `maxChannels` 與 `allowedChannelTypes`：建第二個渠道回 403；建白名單外的類型回 `CHANNEL_TYPE_NOT_ALLOWED`。
5. `monthlyTokens`：
   - 把 Redis `aiquota:{tenantId}:{YYYY-MM}:tpe` 設成上限值 → `POST /ai/rewrite` 回 403 `PLAN_LIMIT_EXCEEDED`，不呼叫 LLM。
   - `limitOverrides.monthlyTokens=null` 之後不擋。
6. 平台 `PATCH /platform/tenants/:id {planSlug}` 換方案 → 下一個請求就套新天花板。
7. `/dashboard/plan` 用 admin、supervisor、agent 各開一次（agent 應回 403）。

自動測試：

- `pnpm --filter @open333crm/api test -- tests/unit/modules/platform/plan tests/unit/modules/platform/tenant-plan tests/unit/modules/channel/channel-plan-limits tests/unit/modules/ai/usage-quota tests/unit/modules/ai/agent-quota tests/unit/modules/agent/agent-reactivate`
- `pnpm --filter @open333crm/web test -- plans-page`
- `pnpm --filter @open333crm/core test -- rbac`
- `pnpm --filter @open333crm/database test`（seed 方案內容與不覆寫既有方案）
- feature（要搶鎖）：`pnpm --filter @open333crm/api test:feature modules/trial/token-quota`
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`、`apps/web/tests/e2e-uat/cross-plan-request.spec.ts`。

## 常見 bug 從哪裡查

- 「升級或換方案後還是 403」：
  - 先看 `getTenantPlanId` 的 60 秒行程快取（`apps/api/src/services/tenant-plan.cache.ts`）。直接改資料庫或有多個行程時，要等 60 秒。
  - Redis `perms:tenant:{roleId}:{planId}` 是第二層，`FLUSHDB` 清不到第一層。
- 「角色頁明明有勾，成員卻 403」：方案天花板擋掉（PLAN-08）。看 403 的 `details.requiredPermission` 屬於哪個 feature，再查租戶方案的 `features` 與 `permissionOverrides.deny`。
- 「渠道頁顯示沒有權限」：`GET /channels` 回 403。看 `details.requiredPermission`，再查角色有沒有 `channel.view`、方案 `features` 有沒有 `channels`。seed 的五個方案都含 `channels`。
- 「平台改了上限卻沒生效」：
  - 同時編輯兩張方案卡片時，另一張送出的是舊值（HC-PLATFORM-PLANS-02）。
  - 檢查租戶有沒有 `limitOverrides`（覆寫優先）。
- 「方案的渠道數上限擋不住」：看是不是從停用改回啟用的渠道（成員已檢查）。`maxTags` 本來就不擋。
- 「AI 額度用完卻還能用」：該租戶是 BYOK（不計不擋），或 `monthlyTokens` 是 null。BYOK 解密失敗會退回平台金鑰開始計數（AI-01）。
- 「升級後 AI 額度沒變」：查租戶是否有 `limitOverrides.monthlyTokens`。正常流程不寫這個欄位，有的話是有人直接改資料庫。
- 「加購的額度下個月不見了」：正常，加購只計入核准當月（台灣時間）。
