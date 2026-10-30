---
name: feature-analytics
description: >
  open333CRM「數據分析與報表」功能顧問：報表總覽（概覽、案件報表、客服績效、渠道分析、優惠券成效分頁）、
  日期區間（今天/7 天/30 天/90 天/自訂）、匯出 CSV、我的績效、後台首頁「營運概況」數字、
  CLI `open333 stats` 與 `/cli/analytics/*`（scope `cli:analytics:read`）、每日彙總 DailyStat。
  當需求、bug 或新功能碰到「報表數字不對」「趨勢圖沒有日期」「匯出亂碼/欄位跑掉」「SLA 達成率」「平均首次回應」
  「CSAT 分數」「我的績效」「台灣時間切日」、/dashboard/analytics、/dashboard/analytics/my、analytics.service、
  analytics.routes、cli.routes、analytics.view、analytics.export 時使用。
  也在改工單狀態轉換（resolvedAt、firstResponseAt）、訊息或對話資料表、渠道類型、CSAT 欄位前使用，確認報表不會算錯。
---

# 數據分析與報表

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/ANALYTICS.md`
  - 注意：它沒有提到「優惠券成效」分頁與 `GET /analytics/coupons`，也沒寫 `/analytics/contacts`、`/analytics/csat` 前端沒有用到。見健檢「文件過時之處」。
- 健檢結果與已知問題：`docs/ref/features/health/ANALYTICS.md`
- 規格：`openspec/specs/analytics-reports/spec.md`、`openspec/specs/cli-analytics/spec.md`；CLI 授權看 `openspec/specs/rbac/spec.md` 的「CLI token 的授權」
- 手冊：`apps/web/public/manual/ch13-analytics.html`（把多數「數字怎麼算」寫得很清楚，可當定義對照）
- 影響分析：`node scripts/feature-impact.mjs --domain analytics`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 選期間 | `/dashboard/analytics` 右上 `DateRangePicker`：今天、7 天、30 天、90 天、兩個日期框 | 改 `from`/`to` 後 6 支 SWR 全部重打（每 60 秒也重打一次，`to` 不會往後移） | 無 | 前端不檢查 `from > to`；後端回 400，畫面只剩「-」與「尚無資料」 |
| 2 | 概覽 | 「概覽」分頁：4 張 KPI、訊息趨勢、案件分類圓餅、客服 TOP 5 | `GET /analytics/overview`、`/message-trend`、`/cases`、`/agents` → `apps/api/src/modules/analytics/analytics.service.ts` 的 `getOverviewStats`、`getMessageTrend`、`getCaseStats`、`getAgentPerformance` | 無，全部即時查原始表 | `analytics.view` / 側欄「總覽」依權限隱藏；直接開網址時 403 只顯示「-」 |
| 3 | 案件報表 | 「案件報表」分頁：案件量趨勢、分類、優先級、SLA 違規表（最多 50 筆，不受期間影響）、升級率 | `GET /analytics/cases` | 無 | `analytics.view`。SLA 違規表回傳整筆工單（含標題、描述、聯絡人名稱），不依渠道可見範圍過濾 |
| 4 | 客服績效 | 「客服績效」分頁，可點欄位排序 | `GET /analytics/agents`（前端不帶 `agentId`） | 無 | `analytics.view` |
| 5 | 渠道分析 | 「渠道分析」分頁：渠道訊息圓餅、Bot vs 人工、各渠道對話數 | `GET /analytics/channels` | 無 | `analytics.view` |
| 6 | 優惠券成效 | 「優惠券成效」分頁（切過去才載入） | `GET /analytics/coupons` → `apps/api/src/modules/coupon/coupon-stats.flow.ts`（行銷領域） | 無 | `analytics.view`；此分頁沒有匯出鈕 |
| 7 | 匯出 CSV | 右上「匯出 CSV」，匯出目前分頁（概覽、案件、客服、渠道） | `POST /analytics/export {reportType, from, to}` → `exportCsv` | 下載檔，UTF-8 BOM 開頭；**不寫稽核紀錄** | `analytics.export` / 按鈕依權限隱藏 |
| 8 | 我的績效 | `/dashboard/analytics/my` | `GET /analytics/my` → `getMyPerformance`（固定「本月」，以伺服器時區切月） | 無 | 模組門檻 `analytics.view` 或 `analytics.view.self` 其一 / 側欄「我的績效」要 `analytics.view.self` |
| 9 | 首頁營運概況 | `/dashboard`「營運概況」：開啟中工單、聯絡人總數、活躍自動化規則 | `GET /cases?status=OPEN&limit=1`、`GET /contacts?limit=1`、`GET /automation/rules?limit=1`，讀 `meta.total` | 無 | 各自模組的權限；失敗的格子顯示「載入失敗」。「開啟中工單」只算 `OPEN` 且依渠道可見範圍，和報表的「開啟中案件」（四種狀態、全租戶）不同 |
| 10 | CLI `open333 stats` | 終端機，`--from --to --group-by --json` | `GET /cli/analytics/overview`、`/message-trend`、`/cases`、`/channels`、`/my` → `apps/api/src/modules/cli/cli.routes.ts`，用 `prismaAdmin` 呼叫同一組 service | 無 | 只看 token scope `cli:analytics:read`，**不看角色與方案**（AUDIT RBAC-02）。CLI 路由沒有 `from <= to` 檢查 |
| 11 | 每日彙總（系統） | 排程 `analytics-daily`（每天 02:00） | `apps/api/src/modules/analytics/analytics.scheduler.ts` → `apps/api/src/modules/analytics/analytics.aggregator.ts` 的 `runDailyAggregation` | 寫 `DailyStat` | 沒有任何報表讀它（AUDIT DB-03） |

**有後端、沒有前端入口**：`GET /analytics/contacts`（新聯絡人趨勢、活躍聯絡人、熱門標籤）、`GET /analytics/csat`（回覆率、低分工單）；`/analytics/agents` 的 `agentId`；`/analytics/message-trend` 的 `groupBy=week|month`（前端固定 `day`）；`/analytics/cases` 的 `groupBy`、`category`（後端解析了但沒用）；overview 的 `newCases`、`resolvedCases`、`avgFirstResponseMinutes`、`avgResolutionMinutes`、`csatPositiveRate`（KPI 卡只顯示 4 個）；`statusDistribution`、`newContactsByChannel`。**沒有渠道篩選、沒有成員篩選**（前後端都沒有）。

**前端實際送出的值**：`from`/`to` 都是 `Date.toISOString()`（UTC），自訂日期以瀏覽器本地時區解析，迄日設成 23:59:59.999；`groupBy=day`；匯出 `reportType` 為 `overview|cases|agents|channels`。後端 Zod 全部接受。

## 不可破壞的規則
- 每個 `from`/`to` 端點都要拒絕 `from > to`（主規格 `analytics-reports`），新端點要用 `analytics.routes.ts` 的 `ordered()` 包起來。
- 匯出的 CSV 必須以 UTF-8 BOM 開頭；只對有 `analytics.export` 的成員顯示按鈕。
- `apps/api/src/modules/analytics/analytics.routes.ts` 的模組門檻是 `requireAnyPermission(['analytics.view','analytics.view.self'])`，除了 `/my` 以外每條路由都要再掛 `requirePermission('analytics.view')`。新增路由忘了掛，就變成只有 `view.self` 的客服也看得到全租戶報表。
- service 函式收 Prisma 執行器當第一個參數；網頁走 `request.tenantPrisma`，CLI 走 `fastify.prismaAdmin`（BYPASSRLS）。所以 **每個 raw SQL 都必須自己帶 `tenantId` 條件**，不能靠 RLS。
- 報表全部即時從原始表計算，不讀 `DailyStat`。要改成讀彙總表，先處理 DB-03 的決定與時區問題。
- 日期分組用資料庫 `date_trunc()`，目前是 UTC（ANA-01）。`TenantSettings.timezone`（預設 `Asia/Taipei`）存在但報表沒用；修時區時前端的區間（已是本地時區）與後端的分組要一起改。
- 「已解決」「SLA 達成率」「平均解決時間」只看 `Case.resolvedAt`。工單直接關閉（`OPEN/IN_PROGRESS → CLOSED`）不寫 `resolvedAt`，重開不清 `resolvedAt`。改工單狀態轉換時要想清楚報表定義。
- CLI 的 `/cli/analytics/cases` 刻意把 `slaViolations` 摘要成數量（`summarizeCaseStats`），不回傳原始工單；改 CLI 回應時不要把它拿掉（主規格 `cli-analytics`「CLI response shaping」）。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain analytics` 看最新版本。重點：
- **依賴**：工單（狀態、`resolvedAt`、`firstResponseAt`、CSAT）、收件匣（Message、Conversation）、聯絡人、SLA（`slaDueAt`）、行銷（優惠券成效分頁）、成員（客服績效名單）、渠道（`channelType`）、自動化（首頁規則數）、設定（CLI token scope）、平台方案（`analytics` 功能天花板）。
- **被依賴**：MCP 工具 `crm_get_analytics_overview`（`apps/api/src/modules/mcp/mcp.server.ts`）、網頁 WebMCP（`apps/web/src/lib/webmcp.ts`）。

## 回歸清單
改到本領域時，至少重走：
1. 用 psql 對一段期間算訊息數、新工單、已解決、SLA 達成率，與 `GET /analytics/overview` 對照；同一段期間比較報表頁 KPI。
2. 在台灣時間凌晨 0–8 點建一筆訊息與工單，選那一天，確認趨勢圖落在正確的日期（目前會落到前一天，ANA-01）。
3. 訊息趨勢圖 X 軸要有日期（目前 `date` 被蓋成 0，HC-ANALYTICS-01）。
4. 四個分頁各匯出一次：BOM、欄位數一致、聯絡人名稱含逗號或以 `=` 開頭時不會跑欄或變公式（HC-ANALYTICS-04）。
5. 選反日期 → 後端 400；supervisor 看得到匯出、agent 只看得到「我的績效」、只有 `analytics.view` 的自訂角色看不到匯出。
6. CLI：agent 帳號 `POST /auth/cli/login` 拿 token 打 `/cli/analytics/overview`（RBAC-02 修好後應 403）；`open333 stats --json`。
- 自動測試：`pnpm --filter @open333crm/api test -- analytics`、`pnpm --filter @open333crm/api test -- cli-session`、`pnpm --filter @open333crm/web test -- analytics date-range-picker sidebar`、`pnpm --filter @open333crm/cli test -- stats`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/analytics guards/permission-check`。
- E2E：`apps/web/tests/e2e-uat/tenant-analytics.spec.ts`。
- 目前**沒有任何測試檢查報表數字是否正確**，只測日期順序、BOM、權限與畫面格式。改計算邏輯時請補 feature 測試（插入固定時間的資料再比對）。

## 常見 bug 從哪裡查
- 「訊息趨勢圖沒有日期／CLI 的 Latest period 是 0」：`apps/api/src/modules/analytics/analytics.service.ts` 的 `getMessageTrend`，pivot 物件預設 `date: 0`，回傳時 `{ date, ...vals }` 被蓋掉。
- 「某天的數字少了／多了」：先看是不是台灣凌晨的資料（ANA-01，`date_trunc` 以 UTC 切）；KPI 卡的總數用的是前端本地時區的區間，趨勢圖的分桶是 UTC，兩者對不起來是正常的現況。
- 「已解決、SLA 達成率偏低或偏高」：查工單的 `resolvedAt`。直接關閉的工單沒有 `resolvedAt`，重開的工單保留舊的 `resolvedAt`（`apps/api/src/modules/case/case.service.ts` 的狀態轉換）。
- 「平均首次回應是空的」：工單沒有關聯對話（SLA-05），或只有 AI／系統回覆。
- 「報表 CSAT 和 CSAT 報告對不起來」：總覽依工單 `createdAt` 歸期間，`/analytics/csat` 依 `csatSentAt`。
- 「首頁開啟中工單和報表不一樣」：首頁 `apps/web/src/app/dashboard/page.tsx` 只算 `OPEN`、依渠道可見範圍；報表算 `OPEN/IN_PROGRESS/PENDING/ESCALATED`、全租戶。
- 「我的績效名字是空的／CLI 顯示 agentId」：`getAgentPerformance` 帶 `agentId` 時把條件放在 LEFT JOIN 之後的 WHERE，本期沒有工單就整列消失，`getMyPerformance` 退回空白預設值。
- 「看得到不該看的渠道資料」：報表不套用渠道可見範圍（`apps/api/src/services/channel-visibility.ts` 沒被呼叫），見健檢 HC-ANALYTICS-03。
- 「客服用 CLI 看得到全公司報表」：AUDIT RBAC-02，`apps/api/src/modules/cli/cli.routes.ts` 只檢查 scope。
