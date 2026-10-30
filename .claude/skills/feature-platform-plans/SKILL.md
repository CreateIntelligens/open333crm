---
name: feature-platform-plans
description: >
  open333CRM「方案與上限」功能顧問：平台後台方案設定 /admin/plans（功能勾選 features、細分權限 deny、
  數值上限 maxAgents/maxChannels/maxTags/monthlyTokens、可用渠道類型 allowedChannelTypes）、
  功能天花板（角色權限 ∩ 方案天花板、Redis perms:tenant 快取、getTenantPlanId 60 秒進程內快取）、
  租戶覆寫 limitOverrides、各種上限硬擋 PLAN_LIMIT_EXCEEDED / CHANNEL_TYPE_NOT_ALLOWED、AI 月額度
  （aiquota 計數器）、租戶端方案頁 /dashboard/plan。當需求或 bug 提到「方案」「升級後功能沒開」
  「換方案後 403」「客服人數上限」「渠道數上限」「AI 額度用完」「停售方案」「試用方案能不能接 LINE」、
  plan.service、plan-limits.service、tenant-plan.cache、token-quota.service 時使用。
  也在新增權限碼或 feature、改 requirePermission、改建立成員/渠道/AI 呼叫流程前使用。
---

# 方案與上限

## 先讀
- 功能現況（以它為準）：`docs/ref/features/platform/PLANS.md`
  - 注意：`docs/ref/system/AUDIT.md` 的 PLAN-01 寫「`/admin/plans` 也能切換」停售，已過時：頁面從來沒有停售、名稱、價格的欄位，只能打 API（健檢 HC-PLATFORM-PLANS-03）。
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-PLANS.md`
- 共通機制（天花板用語、快取連鎖、資料模型）：`docs/ref/features/platform/README.md`
- 規格：`openspec/specs/tenant-plan/spec.md`、`openspec/specs/plan-limits-core/spec.md`、`openspec/specs/granular-plan-entitlement/spec.md`、`openspec/specs/token-quota/spec.md`
- 權限計算：`docs/ref/modules/PERMISSIONS.md`；方案異動申請見 `.claude/skills/feature-platform-plan-changes/SKILL.md`
- 手冊：`apps/web/public/manual/ch14-plan.html`
- 影響分析：`node scripts/feature-impact.mjs --domain platform-plans`

路由：平台側 `GET /api/v1/platform/plans`、`PATCH /api/v1/platform/plans/:id`、`GET /api/v1/platform/registry`（`apps/api/src/modules/platform/platform.routes.ts`）；
租戶側 `GET/POST /api/v1/plan-change`（`apps/api/src/modules/platform/plan-change.routes.ts`，屬方案異動領域）。

## 前端操作流程

### 平台後台 `/admin/plans`（`apps/web/src/app/admin/plans/page.tsx`）
| # | 流程 | 入口 | API → 後端 | 副作用 | 權限（後端 / 前端） |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 看方案 | 側欄「方案與上限」 | `GET /platform/plans` → `plan.service.ts` `listPlans`（依 `priceMonthly` 排序）；`GET /platform/registry` 取功能、權限點、渠道類型 | — | 平台 superuser / 未登入導回 `/admin/login` |
| 2 | 勾選功能 | 卡片「功能」勾選框；`core` 停用不可取消 | `PATCH /platform/plans/:id` 一次送 `features`、`limits`、`allowedChannelTypes`、`permissionOverrides` 四欄 → `updatePlan` | `features` 或 `permissionOverrides` 有送就 `invalidatePlanPermissions`（SCAN 刪 `perms:tenant:*:{planId}`），**下一個請求立即生效**；寫平台稽核 `plan.update`（只記新值，PLAN-09） | 同上 |
| 3 | 細分權限 deny | 功能勾選後「▼ 細分權限（N）」，取消勾選 = 加進 `deny` | 同上，`permissionOverrides: { deny: [...] }` | 取消功能時 deny 清單保留（隱藏），重新打開功能後仍生效 | 同上 |
| 4 | 數值上限 | 「客服人數 / 渠道數 / 分眾標籤數 / AI 月額度 token」輸入框，留空 = 無上限 | 同上，`limits` | 不清快取（每次查 DB）。`maxTags` 沒有任何強制點（PLAN-04） | 同上 |
| 5 | 可用渠道類型 | 勾選 LINE/FB/WEBCHAT/WHATSAPP/TELEGRAM/THREADS，全不勾 = 不限制 | 同上，`allowedChannelTypes` | 只擋新建；`TELEGRAM` 不是 `createChannelSchema` 可建的類型 | 同上 |

### 租戶端 `/dashboard/plan`（`apps/web/src/app/dashboard/plan/page.tsx`）
| # | 流程 | 入口 | API → 後端 | 權限（後端 / 前端） |
| - | ---- | ---- | ---------- | ---- |
| 6 | 看申請記錄 | 側欄「分析與管理 → 方案／帳務」 | `GET /plan-change`（最近 50 筆） | `settings.manage` / 側欄依 `settings.manage` 隱藏，但直接開網址仍顯示整張表單；讀取 403 時顯示「尚無申請記錄」 |
| 7 | 申請升級 / 加購 | 「升級方案」選 standard/professional/enterprise（寫死）；「加購 Token」選 20/50/100 萬 | `POST /plan-change`（後續見方案異動領域） | 同上；送出失敗訊息也是綠底 |

頁面**不顯示目前方案、上限或用量**（PLAN-10、RBAC-01 的 `billing.view`）。AI 額度告警的站內通知與 email 都連到這一頁。

### 上限在哪裡被擋（不是頁面，是其他領域的流程）
| 上限 | 檢查點 | 失敗回應 |
| ---- | ------ | -------- |
| 功能天花板 | `apps/api/src/guards/rbac.guard.ts` `requirePermission` → `apps/api/src/services/permission.service.ts` `getEffectiveTenantPermissions` | 403 `FORBIDDEN`，`details.requiredPermission`，分不出「角色沒給」或「方案不含」（PLAN-08） |
| `maxAgents` | `apps/api/src/modules/agent/agent.service.ts` 建立與重新啟用前 count `isActive` | 403 `PLAN_LIMIT_EXCEEDED`，`details {limitKey,current,max}` |
| `maxChannels` | `apps/api/src/modules/channel/channel.service.ts` `createChannel` | 同上；**重新啟用渠道不檢查**（PLAN-07） |
| `allowedChannelTypes` | 同上 | 403 `CHANNEL_TYPE_NOT_ALLOWED`，`details {channelType, allowed}` |
| `monthlyTokens` | `apps/api/src/modules/ai/llm.service.ts` `generateReply`、`apps/api/src/modules/ai/agent/agent.service.ts`（只對 `keySource=platform`） | 403 `PLAN_LIMIT_EXCEEDED`，`details.limitKey='monthlyTokens'` |
| `maxTags` | 無 | 不擋（PLAN-04） |

## 有後端沒前端
- 新增方案、刪除方案：**沒有 API 也沒有 UI**，只能改 `packages/database/prisma/seed.ts` 或直接寫資料庫。
- 改方案名稱、月費、停售（`name`、`priceMonthly`、`isActive`）：API 接受，`/admin/plans` 沒有欄位。停售本身沒有效果（PLAN-01）。
- 租戶覆寫 `Tenant.limitOverrides`：沒有任何讀寫 UI，也沒有 API；唯一寫入端是核准加購（PLAN-03、PLAN-05）。
- `billing.view` 權限碼：沒有任何路由或頁面使用（RBAC-01）。

## 前端實際送出的值
- `/admin/plans` 每次儲存都送完整四欄（不送 `name`、`priceMonthly`、`isActive`）。
- 數值輸入用 `parseInt`：`1.5` 存成 `1`、`12abc` 存成 `12`、`abc` 不更新但仍顯示「已更新」、`-3` 送出被後端 400、空白或 `∞` = `null`。
- 後端 `updatePlanSchema`：`limits` 為 `z.record(非負整數|null)`，**沒有 key 白名單**，送 `{}` 或錯字 key 會把所有上限變成無上限；`features` 不驗 slug；`name` 可以是空字串；`priceMonthly` 接受負數，小數被截成整數。
- 租戶端送 `{type:'upgrade', targetPlanSlug}` 或 `{type:'token_topup', topupTokens}`，方案清單寫死，不讀 `/platform/plans`。

## 不可破壞的規則
- 有效權限 = 角色權限 ∩（`features` 的權限點 ∪ `core`）−`permissionOverrides.deny`。`planId` 為 null 時不設天花板。新路由一定要掛 `requirePermission()`，否則方案關不掉它（PLAN-04）。
- 有效上限：`limitOverrides` **有這個 key**（含 null）就用覆寫，否則用方案的值，都沒有 = 無上限（fail-open）。用 `hasOwnProperty`，不要改成 `??`。`monthlyTokens` 要停用 AI 只能填 `0`（PLAN-12）。
- 改 `features` / `permissionOverrides` 必須呼叫 `invalidatePlanPermissions`；改租戶 `planId` 必須同時呼叫 `invalidateTenantPlan`（行程內 Map，60 秒）與 `invalidatePlanPermissions`。直接改資料庫的 `planId` 要等 60 秒或重啟 API；多個 API 行程時其他行程最多延遲 60 秒（PLAN-03 第三點）。
- 換方案不刪 `RolePermission`：降級後權限只是被天花板擋住，升回原方案自動恢復。
- `PLAN_LIMIT_EXCEEDED` 一律 403 並帶 `limitKey`、`current`、`max`（AI 只帶 `limitKey`）。新增上限時照這個形狀，前端才能共用錯誤訊息。
- 計數只算 `isActive: true` 的成員與渠道；把停用的資源改回啟用也要檢查上限（成員已做，渠道還沒做）。
- AI 計數器 `aiquota:{tenantId}:{YYYY-MM}` 用 UTC 月份，只累加平台金鑰的成功呼叫；BYOK 不計不擋。
- 新增權限碼或 feature：權限碼宣告在 `packages/shared/src/rbac/permissions.ts`，feature 在 `packages/core/src/rbac/features.ts`，平台頁自動出現。既有租戶的系統角色要跑 `scripts/grant-new-role-permissions.mjs`。
- UI 不放 emoji 與 ✓（使用者要求）。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-plans` 看最新版本。重點：
- **依賴**：平台登入（superuser token）、成員與角色（`requirePermission`、權限快取）、平台租戶管理（`planId` 寫入與失效）、平台用量（`AiUsage` 加總）。
- **被依賴**：渠道（類型白名單、渠道數）、成員（人數上限、角色頁不套天花板）、知識庫/AI（月額度硬擋）、行銷（`marketing` feature 與 deny）、方案異動（依 slug 找方案、加購寫覆寫）、試用（`trial` 方案內容）、通知（額度告警連到 `/dashboard/plan`）、收件匣（socket 房間授權與渠道可見範圍也套天花板）。

## 回歸清單
改到本領域時，至少重走（本機用 `hc-` 前綴的自建方案與租戶，不要改 seed 方案或 Demo 租戶的方案）：
1. 建方案（SQL）→ 平台 `POST /platform/tenants` 開通租戶 → 租戶 `GET /auth/me/permissions` 不含方案外的權限碼，打 `/marketing/campaigns` 回 403 `requiredPermission`。
2. `/admin/plans` 勾上該 feature → 儲存 → 同一個 token 立即 200；再 deny 一個權限碼 → 立即消失。
3. `maxAgents`：建到上限回 403 `PLAN_LIMIT_EXCEEDED`；停用一位 → 建新的 → 重新啟用舊的要 403。
4. `maxChannels` 與 `allowedChannelTypes`：建第二個渠道 403；建白名單外類型回 `CHANNEL_TYPE_NOT_ALLOWED`。
5. `monthlyTokens`：把 Redis `aiquota:{tenantId}:{YYYY-MM}` 設成上限值 → `POST /ai/rewrite` 回 403 `PLAN_LIMIT_EXCEEDED`（不會呼叫 LLM）；`limitOverrides.monthlyTokens=null` 後不擋。
6. 平台 `PATCH /platform/tenants/:id {planSlug}` 換方案 → 下一個請求即套新天花板。
7. `/dashboard/plan` 用 admin、supervisor、agent 各開一次（agent 應 403）。
- 自動測試：`pnpm --filter @open333crm/api test -- tests/unit/modules/platform/plan tests/unit/modules/platform/tenant-plan tests/unit/modules/channel/channel-plan-limits tests/unit/modules/ai/usage-quota tests/unit/modules/ai/agent-quota tests/unit/modules/agent/agent-reactivate`；`pnpm --filter @open333crm/web test -- plans-page`；`pnpm --filter @open333crm/core test -- rbac`；feature：`test:feature modules/trial/token-quota`（要搶鎖）。
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`、`apps/web/tests/e2e-uat/cross-plan-request.spec.ts`。

## 常見 bug 從哪裡查
- 「升級／換方案後還是 403」：先看 `getTenantPlanId` 的 60 秒行程快取（`apps/api/src/services/tenant-plan.cache.ts`）；直接改資料庫或多行程時要等 60 秒。Redis `perms:tenant:{roleId}:{planId}` 是第二層，`FLUSHDB` 清不到第一層。
- 「角色頁明明有勾，成員卻 403」：方案天花板擋掉（PLAN-08）；看 403 的 `details.requiredPermission` 屬於哪個 feature，再查租戶方案的 `features` 與 `permissionOverrides.deny`。
- 「渠道頁顯示沒有渠道、但收件匣有訊息」：方案不含 `channels`，`GET /channels` 403 被顯示成空狀態。seed 的 `trial`、`light` 都不含 `channels`（HC-PLATFORM-PLANS-01）。
- 「平台改了上限卻沒生效」：同時編輯兩張方案卡片時，先存的那張會重載資料，另一張輸入框顯示新值、送出的卻是舊值（HC-PLATFORM-PLANS-02）；也檢查租戶有沒有 `limitOverrides`（覆寫優先）。
- 「方案人數上限擋不住」：看是不是從停用改回啟用的渠道（成員已檢查）；`maxTags` 本來就不擋。
- 「AI 額度用完卻還能用」：該租戶是 BYOK（不計不擋），或 `monthlyTokens` 是 null；BYOK 解密失敗會退回平台金鑰開始計數（AI-01）。
- 「升級後 AI 額度沒變」：租戶有加購留下的 `limitOverrides.monthlyTokens`（PLAN-05），只能改資料庫。
