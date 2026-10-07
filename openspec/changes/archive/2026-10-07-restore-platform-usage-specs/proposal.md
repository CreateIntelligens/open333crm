## Why

change `platform-control-plane` 與 `add-usage-quota-alerts` 在 `aa274cf0` 以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。`platform-control-plane` 分成幾個 change 補回：`restore-platform-plan-specs`（#247）處理認證、方案天花板與上限。這個 change 處理用量與額度：

- `platform-control-plane` 的 `platform-usage` 與 `token-quota`。
- `add-usage-quota-alerts` 的 `usage-quota-alerts`。額度告警與額度的計數是同一段程式，所以一起補回。

程式已經實作大部分的需求，但做法與歸檔規格不同。這個 change 照現行程式寫主規格，並修正對照時發現的 2 個問題。

## What Changes

- 新增主規格 `token-quota`：
  - 「本月 AI 用量的計數」：Redis 計數器、只計平台金鑰的成功呼叫、從 `AiUsage` 回填、Redis 無法使用時改用資料庫的加總。
  - 「呼叫 LLM 之前檢查月額度」。
- 新增主規格 `usage-quota-alerts`：補回 `add-usage-quota-alerts` 的 5 條需求，照現行程式改寫。
- 新增主規格 `platform-usage`：「平台用量查詢」。
- `ai-usage-recording`：新增「記錄金鑰來源」。
- `model-pricing`：修改「成本計算公式」，自備金鑰的呼叫成本為零。
- `trial-lifecycle`：修改「試用 token 額度硬擋（簡化版）」，改為引用 `token-quota`。
- 修正對照程式時發現的 2 個問題：
  - Agent 回覆（`runAgentReply()`）達到月額度時拋出一般的 `Error`，API 回 500，違反「Agent 回覆達到上限」。現在與 `generateReply()` 相同，拋出 403 `PLAN_LIMIT_EXCEEDED`。
  - 用量告警 email 的按鈕連結是相對路徑 `/dashboard/plan`，在郵件客戶端開不了站台，違反「email 的按鈕連到站台的方案頁」。現在改用 `WEB_BASE_URL` 組成絕對網址。站內通知的 `clickUrl` 仍是相對路徑。

### 歸檔需求的處理方式

**`platform-usage`**

| 歸檔的需求 | 處理 |
| --- | --- |
| AI 呼叫逐次記錄（AiUsage） | 已由 `ai-usage-recording` 涵蓋。呼叫來源的欄位是 `feature`，不是 `callType`。`keySource` 新增「記錄金鑰來源」。embedding 呼叫不寫 `AiUsage`，`AiUsage` 也沒有 `latencyMs`：這兩項沒有實作，這個 PR 合併後在 #228 請 Daniel 決定 |
| Provider 介面回傳 usage | 已由 `ai-usage-recording` 的「Provider 回傳 token 用量」涵蓋 |
| AI 金額換算與 BYOK 排除 | 已由 `model-pricing` 涵蓋。成本在寫入時以當時的單價算好，存入 `costUsd`，改價不影響歷史紀錄。BYOK 的部分修改「成本計算公式」 |
| 每日彙總複用 DailyStat | 沒有實作，已在 #228 請 Daniel 決定 |
| 三類指標彙總（用量／計費／健康度） | 沒有實作，已在 #228 請 Daniel 決定 |
| 平台用量 API（跨租戶總覽與單租戶鑽取） | 新增「平台用量查詢」。路由在 `/api/v1/platform/usage/*`，直接查 `AiUsage`，不讀 `DailyStat`。查詢不寫稽核（已在 #228 請 Daniel 決定）。沒有歸檔規格的 AI 明細路由、訊息量排行與異常警示 |

**`token-quota`**

| 歸檔的需求 | 處理 |
| --- | --- |
| Token 月額度定義與覆寫 | 沒有 `tokenQuotaMonthly` 欄位。月額度是有效的 `monthlyTokens`（`plan-limits-core`），單一租戶的覆寫寫在 `limitOverrides.monthlyTokens` |
| Redis 即時月度用量計數器 | 新增「本月 AI 用量的計數」。key 是 `aiquota:{tenantId}:{YYYY-MM}`，不是 `usage:tokens:…`；月份依 UTC 計算 |
| AI 呼叫前額度硬擋 | 新增「呼叫 LLM 之前檢查月額度」。現行程式拋出 `PLAN_LIMIT_EXCEEDED`，不回覆客人固定訊息，也不記錄被擋的事件；知識庫自動回覆捕捉這個錯誤後，改送文章的原文。這幾點這個 PR 合併後在 #228 請 Daniel 決定 |
| 硬擋涵蓋 Embedding（含 KB 搜尋） | 沒有實作，已在 #228 請 Daniel 決定 |
| 呼叫後累加用量計數 | 寫在「本月 AI 用量的計數」 |
| 分級用量預警 | 由 `usage-quota-alerts` 涵蓋 |
| BYOK 租戶預設不受硬擋 | 寫在「呼叫 LLM 之前檢查月額度」。平台對 BYOK 租戶開啟限制的開關沒有實作，已在 #228 請 Daniel 決定 |
| 加購後即時恢復與額度校準 | 與核准加購一起，在補回 `plan-change-request` 的 change 處理（AUDIT PLAN-05、PLAN-06） |

**`usage-quota-alerts`**

5 條需求照現行程式改寫，寫法上的差異：

- 告警受 `USAGE_QUOTA_ALERTS_ENABLED` 控制，預設開啟。
- 管理員是角色列舉為 `ADMIN` 的成員，不看細粒度角色。這個問題已記錄在 AUDIT RBAC-03。
- email 的按鈕連結在這個 change 修正，見上方。

**`trial-lifecycle`**

「試用 token 額度硬擋（簡化版）」原本寫「檢查當月 AiUsage 的 totalTokens 加總」，現行程式改用 Redis 計數器，所以改為引用 `token-quota`。原本的「真人回覆不受影響」沒有保留：客服的手動回覆不經過 `generateReply()`，不會碰到額度檢查，這句話沒有可以測試的行為。

## Capabilities

### New Capabilities

- `token-quota`：本月 AI 用量的計數，以及呼叫 LLM 之前的月額度檢查。
- `usage-quota-alerts`：用量達到 80% 與 100% 時對管理員的告警。
- `platform-usage`：平台管理員的跨租戶用量查詢。

### Modified Capabilities

- `ai-usage-recording`：記錄金鑰來源。
- `model-pricing`：自備金鑰的呼叫成本為零。
- `trial-lifecycle`：試用的額度檢查改為引用 `token-quota`。

## Impact

- `apps/api/src/modules/ai/agent/agent.service.ts`：Agent 回覆達到月額度時拋出 403 `PLAN_LIMIT_EXCEEDED`。
- `apps/api/src/modules/notification/notification.worker.ts`：告警 email 的按鈕改用絕對網址。
- `CHANGELOG.md`：上述 2 項修正。
- `docs/ref/system/AUDIT-REVIEWS.md` 新增複查紀錄。2 項問題在同一個 PR 發現並修正，沒有列入 `AUDIT.md`。
- 歸檔後，3 份新主規格的 Purpose 是 CLI 產生的佔位文字，要手動改寫。
