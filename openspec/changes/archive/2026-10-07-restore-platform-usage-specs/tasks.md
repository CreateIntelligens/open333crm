## 1. 測試

測試名稱以情境名稱開頭。大部分情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 3 節）。標「修正前失敗」的 2 個測試描述 bug，先在修正前執行，確認以斷言失敗。

測試檔的簡稱：

- `quota`：`apps/api/tests/unit/modules/ai/usage-quota.test.ts`
- `agent`：`apps/api/tests/unit/modules/ai/agent-quota.test.ts`
- `pricing`：`apps/api/tests/unit/modules/ai/pricing.test.ts`
- `notify`：`apps/api/tests/unit/modules/notification/usage-quota-alert.test.ts`
- `usage`：`apps/api/tests/feature/modules/platform/platform-usage.test.ts`
- `alert`：`apps/api/tests/feature/modules/trial/token-quota-alert.test.ts`（既有測試，連真的 Redis）

| 主規格 | 需求 | 情境 | 測試 |
| --- | --- | --- | --- |
| `token-quota` | 本月 AI 用量的計數 | 成功的呼叫累加用量 | `quota` |
| `token-quota` | 本月 AI 用量的計數 | 自備金鑰與失敗的呼叫不累加 | `quota` |
| `token-quota` | 本月 AI 用量的計數 | 計數器不存在時從 AiUsage 建立 | `quota` |
| `token-quota` | 本月 AI 用量的計數 | Redis 無法使用時改用資料庫的加總 | `quota` |
| `token-quota` | 本月 AI 用量的計數 | 每個月重新計數 | `quota` |
| `token-quota` | 呼叫 LLM 之前檢查月額度 | 未達上限時照常呼叫 | `quota` |
| `token-quota` | 呼叫 LLM 之前檢查月額度 | 達到上限時不呼叫 LLM | `quota` |
| `token-quota` | 呼叫 LLM 之前檢查月額度 | 自備金鑰的呼叫不檢查月額度 | `quota` |
| `token-quota` | 呼叫 LLM 之前檢查月額度 | 沒有上限時不檢查 | `quota` |
| `token-quota` | 呼叫 LLM 之前檢查月額度 | Agent 回覆達到上限 | `agent`。修正前失敗：`AssertionError: 應為 AppError，實際是 Error: 已達方案 AI 月額度上限` |
| `usage-quota-alerts` | 跨越用量門檻時發送告警 | 用量首次跨越 80% | `quota`、`alert` |
| `usage-quota-alerts` | 跨越用量門檻時發送告警 | 用量跨越 100% | `quota`、`alert` |
| `usage-quota-alerts` | 跨越用量門檻時發送告警 | 一次呼叫同時跨越 80% 與 100% | `quota`、`alert` |
| `usage-quota-alerts` | 跨越用量門檻時發送告警 | 關閉告警 | `quota` |
| `usage-quota-alerts` | 每個門檻每月最多告警一次 | 同月重複跨越同一個門檻 | `quota`、`alert` |
| `usage-quota-alerts` | 每個門檻每月最多告警一次 | 兩次累加同時跨越同一個門檻 | `quota` |
| `usage-quota-alerts` | 每個門檻每月最多告警一次 | 進入新的月份 | `quota` |
| `usage-quota-alerts` | 只對計入額度的用量告警 | 沒有上限的租戶不告警 | `quota`、`alert` |
| `usage-quota-alerts` | 只對計入額度的用量告警 | 自備金鑰的用量不告警 | `quota` |
| `usage-quota-alerts` | 告警的通知與信件 | 每位管理員都收到通知與 email | `notify` |
| `usage-quota-alerts` | 告警的通知與信件 | critical email 說明影響 | `notify` |
| `usage-quota-alerts` | 告警的通知與信件 | email 的按鈕連到站台的方案頁 | `notify`。修正前失敗：`AssertionError: 【open333】AI 用量提醒（80%）：測試站台`（連結是相對路徑） |
| `usage-quota-alerts` | 告警的通知與信件 | 租戶名稱經過 HTML 轉義 | `notify` |
| `usage-quota-alerts` | 告警不影響 AI 回覆 | Redis 無法使用時跳過告警 | `quota` |
| `usage-quota-alerts` | 告警不影響 AI 回覆 | email 寄送失敗 | `notify` |
| `platform-usage` | 平台用量查詢 | 總覽只計算成功的呼叫 | `usage` |
| `platform-usage` | 平台用量查詢 | 租戶依 token 用量排列 | `usage` |
| `platform-usage` | 平台用量查詢 | 單一租戶的每日用量與來源分布 | `usage` |
| `platform-usage` | 平台用量查詢 | 預設查詢最近 30 天 | `usage` |
| `ai-usage-recording` | 記錄金鑰來源 | 租戶設定了自備金鑰 | `quota` |
| `ai-usage-recording` | 記錄金鑰來源 | 租戶沒有設定自備金鑰 | `quota` |
| `ai-usage-recording` | 記錄金鑰來源 | Ollama 的呼叫 | `quota` |
| `model-pricing` | 成本計算公式 | 含快取與 thinking 的成本 | `pricing` |
| `model-pricing` | 成本計算公式 | 超過分級門檻整筆用高檔價 | `pricing` |
| `model-pricing` | 成本計算公式 | Ollama 本機模型成本為零 | `quota` |
| `model-pricing` | 成本計算公式 | 自備金鑰的呼叫成本為零 | `quota` |
| `trial-lifecycle` | 試用 token 額度硬擋（簡化版） | 試用租戶用盡 token | `quota` |

- [x] 1.1 寫上表的測試
- [x] 1.2 執行修正前失敗的 2 個測試，確認以斷言失敗

## 2. 修正

- [x] 2.1 `agent.service.ts`：達到月額度時拋出 `AppError('已達方案 AI 月額度上限', 'PLAN_LIMIT_EXCEEDED', 403, { limitKey: 'monthlyTokens' })`
- [x] 2.2 `notification.worker.ts`：告警 email 的 `usageUrl` 改為 `${WEB_BASE_URL}/dashboard/plan`
- [x] 2.3 `CHANGELOG.md` 新增 2 項修正，`AUDIT-REVIEWS.md` 新增複查紀錄
- [x] 2.4 執行 `pnpm test` 與上表的 feature 測試

## 3. 突變驗證

每個突變改壞一處程式，執行對應的測試，確認測試失敗，再還原程式。

48 個突變都讓測試失敗。

| 情境 | 突變 | 結果 |
| --- | --- | --- |
| 成功的呼叫累加用量 | 既有的計數器不累加 | 失敗 |
| 自備金鑰與失敗的呼叫不累加 | 自備金鑰的呼叫也累加 | 失敗 |
| 計數器不存在時從 AiUsage 建立 | 回填時加總自備金鑰的呼叫 | 失敗 |
| 計數器不存在時從 AiUsage 建立 | 回填時加總失敗的呼叫 | 失敗 |
| 計數器不存在時從 AiUsage 建立 | 回填時不限本月 | 失敗 |
| 計數器不存在時從 AiUsage 建立 | 回填後不寫入計數器 | 失敗 |
| Redis 無法使用時改用資料庫的加總 | Redis 無法使用時把用量當成 0 | 失敗 |
| 每個月重新計數 | 計數器的 key 不含月份 | 失敗 |
| 達到上限時不呼叫 LLM | 不檢查月額度 | 失敗 |
| 達到上限時不呼叫 LLM | 用量等於上限時放行 | 失敗 |
| 達到上限時不呼叫 LLM | 錯誤碼改名 | 失敗 |
| 未達上限時照常呼叫 | 未達上限也擋 | 失敗 |
| 自備金鑰的呼叫不檢查月額度 | 自備金鑰的呼叫也檢查 | 失敗 |
| 沒有上限時不檢查 | 沒有上限時視為已達上限 | 失敗 |
| 試用租戶用盡 token | 不檢查月額度 | 失敗 |
| Agent 回覆達到上限 | Agent 不檢查月額度 | 失敗 |
| Agent 回覆達到上限 | 改回修正前的一般 `Error` | 失敗 |
| 租戶設定了自備金鑰 | 自備金鑰記成 `platform` | 失敗 |
| 租戶設定了自備金鑰、租戶沒有設定自備金鑰 | 不把金鑰交給 provider | 失敗 |
| Ollama 的呼叫 | Ollama 記成 `byok` | 失敗 |
| 含快取與 thinking 的成本 | 快取的 token 不從 prompt 扣除 | 失敗 |
| 超過分級門檻整筆用高檔價 | input 不用 tier 價 | 失敗 |
| 超過分級門檻整筆用高檔價 | output 不用 tier 價 | 失敗 |
| Ollama 本機模型成本為零 | Ollama 也查價 | 失敗 |
| 自備金鑰的呼叫成本為零 | 自備金鑰也查價、計費 | 失敗 |
| 自備金鑰的呼叫成本為零 | 自備金鑰標成 `usageMissing` | 失敗 |
| 用量首次跨越 80% | warning 門檻改成 90% | 失敗 |
| 用量跨越 100% | 不判斷「剛跨越」，只看累加後的用量 | 失敗 |
| 一次呼叫同時跨越 80% 與 100% | 一次只回報一個門檻 | 失敗 |
| 關閉告警 | 不看 `USAGE_QUOTA_ALERTS_ENABLED` | 失敗 |
| 同月重複跨越同一個門檻 | 旗標不用 `NX` | 失敗 |
| 兩次累加同時跨越同一個門檻 | 旗標不用 `NX` | 失敗 |
| 進入新的月份 | 旗標的 key 不含月份 | 失敗 |
| 沒有上限的租戶不告警 | 沒有上限時也回報 warning | 失敗 |
| 自備金鑰的用量不告警 | 自備金鑰的呼叫也累加 | 失敗 |
| Redis 無法使用時跳過告警 | Redis 無法使用時檢查額度拋出錯誤 | 失敗 |
| 每位管理員都收到通知與 email | 只通知第一位管理員 | 失敗 |
| 每位管理員都收到通知與 email | 站內通知的 `clickUrl` 改錯 | 失敗 |
| critical email 說明影響 | critical 信不說明真人回覆 | 失敗 |
| email 的按鈕連到站台的方案頁 | 改回修正前的相對路徑 | 失敗 |
| 租戶名稱經過 HTML 轉義 | 信件的變數不轉義 | 失敗 |
| email 寄送失敗 | 寄信失敗時中斷後續的管理員 | 失敗 |
| 總覽只計算成功的呼叫 | 總覽含失敗的呼叫 | 失敗 |
| 租戶依 token 用量排列 | 排行由少到多 | 失敗 |
| 租戶依 token 用量排列 | 排行不帶租戶名稱 | 失敗 |
| 單一租戶的每日用量與來源分布 | 每日用量改成每月 | 失敗 |
| 單一租戶的每日用量與來源分布 | 來源分布改成依 provider | 失敗 |
| 預設查詢最近 30 天 | 預設期間改成 60 天 | 失敗 |

「失敗的呼叫不累加」沒有單獨的突變：失敗的呼叫沒有 usage，totalTokens 一定是 0，拿掉 `success` 的條件也不會累加。回填的加總另有「回填時加總失敗的呼叫」，測試資料給失敗的呼叫 700 tokens，確認加總排除了失敗的呼叫。

- [x] 3.1 執行上表的突變

## 4. 歸檔

- [x] 4.1 `node scripts/validate-openspec.mjs restore-platform-usage-specs` 通過
- [x] 4.2 以 `pnpm exec openspec archive` 歸檔，改寫 3 份新主規格的 Purpose
- [x] 4.3 `node scripts/validate-openspec.mjs --specs` 通過
