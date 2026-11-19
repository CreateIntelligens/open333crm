# 報表

報表彙整一段期間內的訊息量、工單處理、客服績效、渠道分布、聯絡人成長與滿意度。管理者看「總覽」，每個客服可以在「我的績效」看自己的數字。

- **資料來源**：`apps/api/src/modules/analytics/*`、`apps/api/src/modules/cli/cli.routes.ts`、`apps/api/src/modules/mcp/mcp.server.ts`、`apps/api/src/guards/rbac.guard.ts`
- **核對日期**：2026-11-19

## 負責的程式

| 程式 | 負責什麼 |
| --- | --- |
| `analytics.routes.ts` | 報表路由與權限 |
| `analytics.flow.ts` | 每個報表在一個租戶交易內查詢。報表頁、CLI 與 MCP 都呼叫這裡 |
| `analytics.service.ts` | 每個報表的查詢。全部在查詢當下從原始資料表計算 |
| `analytics.scheduler.ts`、`analytics.aggregator.ts` | `runDailyAggregation()` 每天把前一天的彙總寫入 `DailyStat`，每個租戶一個交易。排程 id 是 `analytics-daily`，每天 02:00 執行。沒有任何報表讀這張表，見 `../../system/AUDIT.md` 的 DB-03。要不要讀這張表，由 #318 決定 |

CLI 的 `/api/v1/cli/analytics/*` 與 MCP 的 `crm_get_analytics_overview`、`crm_get_case_statistics` 呼叫同一組 flow，但走 CLI 的 scope 授權，見 `../../system/AUDIT.md` 的 RBAC-02。

## 程式的入口

報表頁的路由在 `analytics.routes.ts`，前綴是 `/api/v1/analytics`。CLI 的路由在 `apps/api/src/modules/cli/cli.routes.ts`。兩組路由都以 `analytics-query.ts` 解析 `from`、`to`，再呼叫 `analytics.flow.ts` 的 flow。每個 flow 都是 `flowOf()` 包住一個 service 函式，在一個租戶交易內查詢。路由先以 `apps/api/src/services/channel-visibility.ts` 的 `resolveChannelVisibility()` 算出成員看得到的渠道，再傳給 flow。

| 路由 | flow → service 函式 |
| --- | --- |
| `GET /analytics/overview`、`GET /cli/analytics/overview` | `getOverviewStatsFlow()` → `getOverviewStats()` |
| `GET /analytics/message-trend`、`GET /cli/analytics/message-trend` | `getMessageTrendFlow()` → `getMessageTrend()` |
| `GET /analytics/cases`、`GET /cli/analytics/cases` | `getCaseStatsFlow()` → `getCaseStats()`。CLI 再以 `summarizeCaseStats()` 把 `slaViolations` 換成數量，不回傳工單本身（主規格 `cli-analytics` 的「CLI response shaping」） |
| `GET /analytics/agents` | `getAgentPerformanceFlow()` → `getAgentPerformance()` |
| `GET /analytics/channels`、`GET /cli/analytics/channels` | `getChannelAnalyticsFlow()` → `getChannelAnalytics()` |
| `GET /analytics/contacts` | `getContactAnalyticsFlow()` → `getContactAnalytics()` |
| `GET /analytics/csat` | `getCsatReportFlow()` → `getCsatReport()` |
| `GET /analytics/coupons` | `apps/api/src/modules/coupon/coupon-stats.flow.ts` 的 `getCouponAnalyticsFlow()`，屬於行銷領域 |
| `GET /analytics/my`、`GET /cli/analytics/my` | `getMyPerformanceFlow()` → `getMyPerformance()`，內部以自己的 `agentId` 呼叫 `getAgentPerformance()` |
| `POST /analytics/export` | `exportCsvFlow()` → `exportCsv()` |

service 函式以 `ctx.tx.$queryRaw` 寫了多段 raw SQL。每段 SQL 都在 `WHERE` 帶 `tenantId` 條件，不只依賴 RLS。

## 有哪些報表

| 端點 | 內容 |
| --- | --- |
| `GET /analytics/overview` | 未結工單、新工單、已解決工單、SLA 達成率、平均首次回應與平均解決時間、CSAT 平均與好評率（只算客人自評），以及客服代評的筆數 `csatAgentRatedCount` |
| `GET /analytics/message-trend` | 訊息量趨勢，可以依日、週、月分組 |
| `GET /analytics/cases` | 工單趨勢、狀態、優先級與分類分布、SLA 逾時數、升級率 |
| `GET /analytics/agents` | 每個客服的處理量、平均首次回應與解決時間、CSAT（只算客人自評）、SLA 達成率。可以用 `agentId` 只看一人 |
| `GET /analytics/channels` | 各渠道類型的訊息量、對話量與新聯絡人數，以及機器人與真人處理的比例 |
| `GET /analytics/contacts` | 新聯絡人趨勢、活躍聯絡人數、最常用的標籤。報表頁沒有呼叫這個端點 |
| `GET /analytics/csat` | 期間內送出問卷的工單：回覆率、平均分數、滿意率（4 分以上），以及最多 20 張低分（2 分以下）工單，都只算客人自評；另外回傳客服代評的筆數 `agentRatedCount`。依送出問卷的時間篩選。報表頁沒有呼叫這個端點 |
| `GET /analytics/coupons` | 「優惠券成效」分頁：每張優惠券在期間內的發放、領取、核銷、開啟領券連結數與核銷率（`apps/api/src/modules/coupon/coupon-stats.flow.ts`） |
| `GET /analytics/my` | 自己本月的績效，以及手上待處理與快到期的工單 |
| `POST /analytics/export` | 匯出 CSV，可選總覽、工單、客服或渠道 |

期間以 `from` 與 `to` 指定，預設最近 30 天。`from` 晚於 `to` 時回 400 並指出 `from`。報表頁的路由與 CLI 的路由都用 `analytics-query.ts` 的 `ordered()` 做這個檢查（主規格 `analytics-reports`）。「我的績效」固定看本月。

## 數字怎麼算

**即時計算。** 每次查詢都直接統計 `cases`、`messages`、`conversations`、`contacts` 等資料表，沒有快取，也不讀 `DailyStat`。資料量大時，報表的查詢時間會跟著增加。工單報表的匯出與 CSAT 報表讀出期間內的所有工單，見 `../../system/AUDIT.md` 的 ANA-02。

**已解決**看工單的 `resolvedAt`：總覽的已解決數、SLA 達成率、平均解決時間、案件趨勢的「已解決」、客服績效與我的績效都一樣。工單轉成「已解決」時寫入，從已解決轉成已關閉時保留；直接關閉（沒有經過已解決）的工單沒有 `resolvedAt`，不算已解決；重開時清除，重開的工單不再算已解決（規則見[工單](./CASES.md)的「解決時間與關閉時間」）。2026-11-04 之前直接關閉的工單沒有補上 `resolvedAt`。案件趨勢的「已解決」依工單的**建立日**分組，是那天建立、目前已解決的工單數，不是那天解決的數量。

**SLA 達成率**是已解決、而且 `resolvedAt` 不晚於 `slaDueAt` 的工單比例。沒有 SLA 期限的工單不計入。案件報表的 SLA 違規表看的是狀態：不是 `RESOLVED`、`CLOSED`，而且已過 `slaDueAt` 的工單，所以直接關閉的逾期工單不列為違規。

**平均首次回應時間**取 `Case.firstResponseAt` 不為空的工單計算。客服在工單關聯的對話第一次送出訊息時寫入這個欄位，AI 與系統自動回覆不算。沒有關聯對話的工單不會有這個值，因此不計入，見 `../../system/AUDIT.md` 的 SLA-05。

**CSAT 好評率**是 4 分與 5 分佔客人自評的比例。總覽的 CSAT 依工單的**建立日**決定是否落在期間內，不是依評分時間。`/analytics/csat` 則依送出問卷的時間（`csatSentAt`）篩選，所以同一段期間兩者可能一邊有分數、一邊沒有（HC-ANALYTICS-06）。CSAT 的平均與好評率只算客人自評：工單的 `csatRatedBy` 是 `agent`（客服代評）時不計入，報表頁的 CSAT 分數卡另外顯示「客服代評 N 筆（不計入平均）」。2026-11-04 之前的評分沒有來源紀錄，視為客人自評。

**日期以 UTC 切分。** 依日、週、月分組用的是資料庫的 `date_trunc()`，而時間欄位存的是不帶時區的 UTC 時間。台灣時間凌晨 0 點到 8 點的資料會被算到前一天。見 `../../system/AUDIT.md` 的 ANA-01。租戶設定有 `TenantSettings.timezone`（預設 `Asia/Taipei`），但報表不讀這個欄位。報表頁的區間以瀏覽器的本地時區計算，趨勢圖的分組以 UTC 計算，所以 KPI 卡的總數與趨勢圖每天的數字加總可能對不起來。「我的績效」的「本月」以 API 行程的時區切分，容器沒有設定 `TZ` 時是 UTC 的月初。

**指標的定義。** 下列定義容易誤讀（HC-ANALYTICS-11）。手冊 `apps/web/public/manual/ch13-analytics.html` 逐條說明了每個數字怎麼算。

- 升級率只算目前仍是 `ESCALATED` 的工單。
- 客服績效把工單算在「目前的負責人」。
- 平均首次回應與平均解決時間以工單的建立日決定是否落在期間內。
- 總覽的「開啟中案件」算 `OPEN`、`IN_PROGRESS`、`PENDING`、`ESCALATED` 四種狀態。
- 案件報表的 SLA 違規表最多列 50 筆，依 `slaDueAt` 由早到晚排序，不受期間影響。
- 「熱門標籤」不受期間限制，而且以標籤名稱分組：不同範圍的同名標籤合併計數，已封存的聯絡人也算在內（HC-ANALYTICS-08）。

**依渠道可見範圍統計。** 沒有 `channel.view_all` 的成員只看得到可見渠道的資料：訊息與對話依對話的渠道，工單依工單的渠道，聯絡人與標籤依聯絡人的渠道身份（有可見渠道的身份，或沒有任何渠道身份），客服績效只列出被授權任一可見渠道（直綁或所屬團隊）、或在可見渠道有工單的客服，同分店期間內沒有工單的客服以 0 列出；只算可見渠道的工單。報表頁、匯出、CLI 與 MCP 用同一個判斷。兩個例外：優惠券成效不過濾，因為優惠券不屬於任何渠道；「我的績效」只含自己的工單，也不另外過濾。每日彙總（`DailyStat`）寫的是全租戶的數字。主規格 `channel-scoped-visibility` 的「報表只統計可見渠道」。

## 權限

整個模組先要求 `analytics.view` 或 `analytics.view.self` 其中一個，之後各路由再檢查：

| 路由 | 權限 |
| --- | --- |
| `GET /analytics/my` | 通過模組門檻即可，也就是只有 `analytics.view.self` 也能看 |
| 其他報表 | `analytics.view` |
| `POST /analytics/export` | `analytics.export` |

新增報表路由時，除了 `/my` 以外，每條路由都要再掛 `requirePermission('analytics.view')`。只靠模組門檻時，只有 `analytics.view.self` 的成員也讀得到全租戶的報表。

側欄的「總覽」要 `analytics.view`，「我的績效」要 `analytics.view.self`；兩個都沒有時不顯示「報表」。「匯出 CSV」按鈕只對有 `analytics.export` 的成員顯示，匯出的 CSV 以 UTF-8 BOM 開頭，Excel 開啟中文不會亂碼。每一欄（含標題列）都經過 `@open333crm/shared` 的 `csvRow()`：含逗號、引號、換行的欄位以雙引號包住，以 `=`、`+`、`-`、`@`、Tab、CR 開頭的文字前面加 `'`，Excel 不會當成公式；數字欄位照原樣輸出，所以數字欄位要以 number 傳給 `csvRow()`。先轉成字串的負數會被加上 `'`。匯出不寫租戶稽核紀錄，也沒有筆數上限。CSV 的時間是 UTC 的 ISO 字串，不是台灣時間（HC-ANALYTICS-13）。

CLI 的路由只檢查 token 的 scope `cli:analytics:read`，不檢查角色權限與方案，見 `../../system/AUDIT.md` 的 RBAC-02。

## 畫面怎麼呼叫 API

報表頁 `/dashboard/analytics` 的資料由 `apps/web/src/hooks/useAnalytics.ts` 以 SWR 讀取。每個 SWR 每 60 秒重新查詢一次。重新查詢用同一個 `to`，所以區間的結束時間不會往後移。

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 右上的 `DateRangePicker`：今天、7 天、30 天、90 天，以及開始與結束兩個日期框 | 改變區間後，所有報表重新查詢 | `from`、`to` 以 `Date.toISOString()`（UTC）送出。自訂日期以瀏覽器的本地時區解析，迄日設成當天 23:59:59.999。日期不完整，或開始日晚於結束日時，日期框顯示錯誤，不送出新的區間 |
| 「概覽」分頁：4 張 KPI 卡、訊息趨勢、案件分類、客服績效 TOP 5 | `GET /analytics/overview`、`GET /analytics/message-trend`（固定 `groupBy=day`）、`GET /analytics/cases`、`GET /analytics/agents` | KPI 卡只顯示訊息總量、開啟中案件、SLA 達成率、CSAT 分數。查詢失敗時，各區塊顯示「載入失敗」與「重新載入」 |
| 「案件報表」分頁：摘要數字、案件趨勢、分類與優先級分布、SLA 違規表 | `GET /analytics/cases` | 摘要數字由 `trend` 與 `slaViolations` 在前端加總 |
| 「客服績效」分頁，可以點欄位排序 | `GET /analytics/agents`，不帶 `agentId` | 角色欄依舊的 `role` 列舉顯示角色名稱，自訂角色的成員也顯示 `AGENT` 的名稱（HC-ANALYTICS-12）。這個分頁沒有傳入錯誤狀態，查詢失敗時看起來像沒有資料 |
| 「渠道分析」分頁：各渠道的訊息量、機器人與真人的比例、各渠道的對話數 | `GET /analytics/channels` | 這個分頁沒有傳入錯誤狀態，查詢失敗時看起來像沒有資料 |
| 「優惠券成效」分頁 | `GET /analytics/coupons` | 切到這個分頁才查詢。這個分頁沒有「匯出 CSV」按鈕 |
| 右上的「匯出 CSV」 | `POST /analytics/export`，`reportType` 是目前分頁：`overview`、`cases`、`agents`、`channels` | 只對有 `analytics.export` 的成員顯示。錯誤回應也是 Blob，畫面先轉回 JSON 再讀錯誤訊息 |
| 「我的績效」`/dashboard/analytics/my` | `GET /analytics/my` | 固定看本月 |
| 首頁 `/dashboard` 的「營運概況」：開啟中工單、聯絡人總數、活躍自動化規則 | `GET /cases?status=OPEN&limit=1`、`GET /contacts?limit=1`、`GET /automation/rules?limit=1`，讀 `meta.total` | 每格各自要求所屬模組的權限，失敗的格子顯示「載入失敗」。首頁的「開啟中工單」只算 `OPEN`，報表的「開啟中案件」算四種狀態，兩個數字不同（HC-ANALYTICS-10） |
| 終端機的 `open333 stats`（`--from`、`--to`、`--group-by`、`--json`） | `GET /cli/analytics/overview`、`/message-trend`、`/cases`、`/channels`、`/my` | 只看 token 的 scope，見[權限](#權限) |

下列 API 或參數沒有畫面入口（HC-ANALYTICS-14）：

- `GET /analytics/contacts`（新聯絡人趨勢、活躍聯絡人、熱門標籤）與 `GET /analytics/csat`。
- `/analytics/agents` 的 `agentId`。
- `/analytics/message-trend` 的 `groupBy=week`、`groupBy=month`。
- `/analytics/cases` 的 `groupBy`、`category`。後端解析這兩個參數，但查詢不使用。
- 總覽的 `newCases`、`resolvedCases`、`avgFirstResponseMinutes`、`avgResolutionMinutes`、`csatPositiveRate`，案件報表的 `statusDistribution`，渠道分析的 `newContactsByChannel`。
- 渠道篩選與成員篩選。前端與後端都沒有。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 沒有關聯對話的工單不計入平均首次回應時間 | 詳見 `../../system/AUDIT.md` 的 SLA-05 |
| 日期以 UTC 切分 | 詳見 `../../system/AUDIT.md` 的 ANA-01 |
| 每天寫入的彙總沒有被使用 | 詳見 `../../system/AUDIT.md` 的 DB-03 |
| CLI 報表不受角色權限限制 | 詳見 `../../system/AUDIT.md` 的 RBAC-02 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
