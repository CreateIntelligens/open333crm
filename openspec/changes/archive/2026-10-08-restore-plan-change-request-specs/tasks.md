## 1. 測試

測試名稱以情境名稱開頭，全部在 `apps/api/tests/unit/modules/platform/plan-change.test.ts`。Prisma 與 Redis 換成記憶體版本，租戶側的路由以 Fastify inject 呼叫。大部分情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 3 節）。標「修正前失敗」的測試描述 bug，先在修正前執行，確認以斷言失敗。

| 主規格 | 需求 | 情境 |
| --- | --- | --- |
| `plan-change-request` | 租戶送出方案異動申請 | 送出升級申請 |
| `plan-change-request` | 租戶送出方案異動申請 | 已有待審申請時不能再送出 |
| `plan-change-request` | 租戶送出方案異動申請 | 升級申請沒有目標方案 |
| `plan-change-request` | 租戶送出方案異動申請 | 目標方案不存在 |
| `plan-change-request` | 租戶送出方案異動申請 | 加購量不是正整數 |
| `plan-change-request` | 租戶送出方案異動申請 | 沒有 settings.manage 權限 |
| `plan-change-request` | 租戶查詢自己的申請 | 只回傳自己租戶的申請 |
| `plan-change-request` | 租戶查詢自己的申請 | 最多回傳 50 筆 |
| `plan-change-request` | 平台查詢待審的申請 | 只列出待審的申請 |
| `plan-change-request` | 核准升級申請 | 核准升級後立即生效 |
| `plan-change-request` | 核准升級申請 | 目標方案已不存在 |
| `plan-change-request` | 核准加購申請 | 沒有覆寫時加在方案的額度上 |
| `plan-change-request` | 核准加購申請 | 已有覆寫時加在覆寫值上 |
| `plan-change-request` | 核准加購申請 | 有效額度是無上限時不能加購 |
| `plan-change-request` | 核准加購申請 | 核准加購後立即恢復 AI |
| `plan-change-request` | 駁回申請 | 駁回不改變租戶 |
| `plan-change-request` | 只處理待審的申請 | 已處理的申請不能再核准 |
| `plan-change-request` | 只處理待審的申請 | 已處理的申請不能駁回 |
| `plan-change-request` | 只處理待審的申請 | 申請不存在 |
| `usage-quota-alerts` | 每個門檻每月最多告警一次 | 核准加購後再次跨越門檻。修正前失敗：`AssertionError: Expected values to be strictly deep-equal`，實際是 `[]`（旗標還在，沒有回報 warning） |

`usage-quota-alerts` 的其他 3 個情境沒有改變，由 `restore-platform-usage-specs` 的測試涵蓋。

- [x] 1.1 寫上表的測試
- [x] 1.2 執行修正前失敗的測試，確認以斷言失敗

## 2. 修正

- [x] 2.1 `plan-change.service.ts`：核准加購時呼叫 `clearQuotaAlertFlags(req.tenantId)`。刪除用量計數器的 `clearTokenQuotaCache()` 保留
- [x] 2.2 `token-quota.service.ts`：`clearQuotaAlertFlags()` 的註解改為說明核准加購時呼叫
- [x] 2.3 `CHANGELOG.md` 新增修正；`AUDIT.md` 移除 PLAN-06，新增 PLAN-13、USAGE-03；`AUDIT-REVIEWS.md` 新增複查紀錄；更新 `docs/ref/features/platform/` 的 `PLAN-CHANGES.md`、`README.md`、`USAGE.md`
- [x] 2.4 執行 `pnpm test`

## 3. 突變驗證

每個突變改壞一處程式，執行對應的測試，確認測試失敗，再還原程式。

36 個突變中，35 個讓測試失敗。

| 情境 | 突變 | 結果 |
| --- | --- | --- |
| 送出升級申請 | 申請不屬於成員的租戶 | 失敗 |
| 已有待審申請時不能再送出 | 已有待審申請時照樣建立 | 失敗 |
| 升級申請沒有目標方案 | 不檢查 `targetPlanSlug` | 失敗 |
| 目標方案不存在 | 建立時不檢查目標方案存在 | 失敗 |
| 加購量不是正整數 | 路由不檢查加購量是整數 | 失敗 |
| 加購量不是正整數 | 服務不檢查加購量 | 失敗 |
| 沒有 settings.manage 權限 | 路由不檢查 `settings.manage` | 失敗 |
| 只回傳自己租戶的申請 | 查詢不限租戶 | 失敗 |
| 只回傳自己租戶的申請 | 查詢改成舊的在前 | 失敗 |
| 最多回傳 50 筆 | 上限改成 100 筆 | 失敗 |
| 只列出待審的申請 | 清單含已處理的申請 | 失敗 |
| 只列出待審的申請 | 清單改成新的在前 | 失敗 |
| 只列出待審的申請 | 不帶租戶名稱 | 失敗 |
| 只列出待審的申請 | 方案名稱改成 slug | 失敗 |
| 核准升級後立即生效 | 不改租戶的方案 | 失敗 |
| 核准升級後立即生效 | 不清租戶方案快取 | 失敗 |
| 核准升級後立即生效 | 不清權限天花板快取 | 測試通過，見下方說明 |
| 核准升級後立即生效、沒有覆寫時加在方案的額度上 | 不記 `reviewedBy` | 失敗 |
| 核准升級後立即生效、沒有覆寫時加在方案的額度上 | 不記 `reviewedAt` | 失敗 |
| 核准升級後立即生效、沒有覆寫時加在方案的額度上 | 不記 `reviewNote` | 失敗 |
| 目標方案已不存在 | 核准時不檢查目標方案存在 | 失敗 |
| 沒有覆寫時加在方案的額度上 | 沒有覆寫時不讀方案的額度 | 失敗 |
| 沒有覆寫時加在方案的額度上、已有覆寫時加在覆寫值上 | 加購量沒有加上去 | 失敗 |
| 已有覆寫時加在覆寫值上 | 已有覆寫時改用方案的額度 | 失敗 |
| 已有覆寫時加在覆寫值上 | 丟掉其他覆寫值 | 失敗 |
| 有效額度是無上限時不能加購 | 無上限時照樣加購 | 失敗 |
| 核准加購後立即恢復 AI | 不寫入覆寫值 | 失敗 |
| 核准加購後再次跨越門檻 | 不清告警旗標（修正前的程式） | 失敗 |
| 駁回不改變租戶 | 駁回改成 `approved` | 失敗 |
| 駁回不改變租戶 | 不記 `reviewedBy` | 失敗 |
| 駁回不改變租戶 | 不記 `reviewedAt` | 失敗 |
| 駁回不改變租戶 | 不記 `reviewNote` | 失敗 |
| 已處理的申請不能再核准 | 核准不檢查狀態 | 失敗 |
| 已處理的申請不能駁回 | 駁回不檢查狀態 | 失敗 |
| 申請不存在 | 核准不檢查申請存在 | 失敗 |
| 申請不存在 | 駁回不檢查申請存在 | 失敗 |

「不清權限天花板快取」沒有讓測試失敗，這不是測試的漏洞。權限天花板快取的 key 是 `perms:tenant:{roleId}:{planId}`，換方案之後讀的是新方案的 key，舊方案的快取不會被讀到。核准升級時的 `invalidatePlanPermissions()` 清的是新方案的 key，沒有可以觀察到的效果。

「核准加購後立即恢復 AI」的測試資料讓資料庫的加總與 Redis 計數器一致。核准加購會刪除計數器，系統下一次讀取時從資料庫補建。如果加總是 0、計數器是 1,000,000，補建後的用量會變成 0，「不寫入覆寫值」的突變就不會讓測試失敗。

- [x] 3.1 執行上表的突變

## 4. 歸檔

- [x] 4.1 `node scripts/validate-openspec.mjs restore-plan-change-request-specs` 通過
- [x] 4.2 以 `pnpm exec openspec archive` 歸檔，改寫新主規格 `plan-change-request` 的 Purpose
- [x] 4.3 `node scripts/validate-openspec.mjs --specs` 通過
