# 數據分析與報表 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，瀏覽器時區設 `Asia/Taipei`）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只讀）
- 規格：`docs/ref/features/feature-map.json` 的 `analytics`；功能文件 `docs/ref/features/tenant/ANALYTICS.md`；手冊 `apps/web/public/manual/ch13-analytics.html`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 2 份 spec、8 個 requirement、18 個 scenario。缺實作 0。缺測試 4（`cli-analytics` 的 message-trend、channels、current-agent 三條讀取 scenario，以及「Shared analytics calculation」，後者只能以結構確認）。缺前端入口：沒有（CLI 規格本來就沒有網頁入口）。另外主規格 `rbac`「沒有報表權限的成員不能以 CLI 讀報表」沒有實作（AUDIT RBAC-02，本次實測仍可讀） |
| 自動測試 | unit：api 1 檔 1 通過（`analytics`）＋ 2 檔 25 通過（`cli-session`、`mcp.routes`）、web 6 檔 24 通過、cli 1 檔 3 通過。feature：2 檔 13 通過（`modules/analytics`、`guards/permission-check`）。無失敗、無 skip。**沒有任何測試檢查報表數字是否正確** |
| 實際操作 | 11 條流程。正常 4，異常 6，未驗 1（每日彙總排程只看了資料表） |

**數字核對方法。** 在本機 Demo 租戶插入一組固定時間的資料（1 位聯絡人、1 段 WebChat 對話、5 則訊息、3 張工單，時間都落在台灣時間 2026-10-21，其中 3 則訊息與 2 張工單在台灣凌晨 0–8 點），另以 API 建立 2 張工單走真實的狀態轉換。用 psql 算出期望值後，對照 API 與報表頁的數字。資料名稱都帶 `hc-analytics-` 前綴，結束時已全部刪除。

## 問題清單（依嚴重度）

P0：無。HC-ANALYTICS-02、HC-ANALYTICS-04 原列 P2，2026-10-30 使用者決定升為 P1。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-ANALYTICS-01 | P1 | **訊息趨勢的日期全部是 0。** pivot 物件預設 `{ date: 0, … }`，回傳時寫成 `{ date, ...vals }`，`vals.date` 把真正的日期蓋掉。報表頁「訊息趨勢」X 軸沒有任何日期（`String(0).slice(5)` 是空字串），使用者看不出哪一天忙；CLI `open333 stats` 的「Latest period」印成 `0 (50 messages)`。從 `79d0458c`（2026-03-25）起就是這樣 | **實測**。本機與 UAT：`GET /analytics/message-trend?from=…&to=…` 每一筆都是 `"date": 0`；報表頁 X 軸刻度全部空白（本機截圖、UAT 18 個刻度中 13 個空白，只剩 Y 軸數字） | `apps/api/src/modules/analytics/analytics.service.ts:183, 191-194` | 未收錄：main 的 `093b7e75` 已修正（2026-10-30） |
| HC-ANALYTICS-02 | P1 | **「已解決」只看 `resolvedAt`，但工單狀態轉換沒有維護它。** 直接關閉（`OPEN`／`IN_PROGRESS` → `CLOSED`）不寫 `resolvedAt`，這類工單不算已解決、不進 SLA 達成率與平均解決時間；解決後重開（`RESOLVED` → `IN_PROGRESS`）保留舊的 `resolvedAt`，仍在處理中的工單被算成已解決，逾時的還會拉低 SLA 達成率。影響總覽的 `resolvedCases`、SLA 達成率、平均解決時間，案件趨勢的「已解決」，客服績效與我的績效 | **實測**。本機以 API：建立工單 → `POST /:id/close` → `resolvedAt: null`；另一張 → `IN_PROGRESS` → `POST /:id/resolve` → `PATCH status=IN_PROGRESS`，`resolvedAt` 仍是解決時間。固定資料下總覽回 `resolvedCases: 2`（期望 1：K3 處理中卻被算入，K1 直接關閉沒算入）、SLA 達成率 50%（K3 未解決卻被算成逾時）。UAT Demo：3 張 `CLOSED` 工單有 2 張 `resolvedAt` 為空，總覽 `resolvedCases: 1` | `apps/api/src/modules/case/case.service.ts:487-492`（只在轉成 `RESOLVED` 時寫 `resolvedAt`）；報表端 `analytics.service.ts:68-88, 211-214, 350-357` | CASE-04（與 HC-CASES-02「轉換時不重設 `resolvedAt`」同源） |
| HC-ANALYTICS-04 | P1 | **匯出 CSV 沒有跳脫，會跑欄也會變成公式。** 工單 CSV 只替標題加引號，聯絡人名稱、客服姓名、分類原樣輸出；客服 CSV 的姓名也一樣。聯絡人名稱來自 LINE／FB 暱稱或 WebChat 訪客自填，名稱含逗號就讓後面的欄位錯位，以 `=`、`+`、`-`、`@` 開頭會被 Excel 當成公式（CSV injection） | **實測**。本機把聯絡人名稱改成 `=HYPERLINK("http://evil.example","hc-analytics, 點我")` → 匯出工單 CSV → 標題列 10 欄、資料列 11 欄，聯絡人欄是 `=HYPERLINK("http://evil.example"` | `apps/api/src/modules/analytics/analytics.service.ts:652-666, 672-685, 701-703` | ANA-03 |
| HC-ANALYTICS-03 | P2 | **報表不套用渠道可見範圍，而且會帶出工單與聯絡人內容。** 所有報表都統計全租戶；「SLA 違規案件」回傳整筆工單（標題、描述、`csatComment`、聯絡人名稱），工單匯出 CSV 列出期間內全部工單的標題與聯絡人名稱。只有 `analytics.view`、沒有 `case.view`、`contact.view` 的成員也拿得到 | **實測**。本機自建角色「hc-analytics-僅檢視報表」（只有 `analytics.view`、只綁 LINE-A 一個渠道）：`GET /cases` 403，但 `GET /analytics/cases` 的 `slaViolations` 有 WebChat 渠道的工單標題與聯絡人名稱。seed supervisor 只看得到 1 個渠道、3 段對話、0 張工單，報表卻顯示全租戶 72 則訊息、4 張開啟中工單，匯出可下載全部工單 | `apps/api/src/modules/analytics/analytics.service.ts:282-294`（`include` 整筆工單）、`643-667`；`analytics.routes.ts` 全檔沒有呼叫 `channel-visibility` | RBAC-04（已併入表格） |
| ANA-01 | P3 | **確認仍未修正，並補充兩點。** ① 報表頁的區間以瀏覽器本地時區送出（`from=2026-10-20T16:00Z` 代表台灣 10/21），所以 KPI 總數是台灣時間的一天；但趨勢圖以 UTC `date_trunc` 分桶，同一天的資料被拆成 10-20、10-21 兩個點，兩者對不起來。② 「我的績效」的「本月」與每日彙總以 **API 伺服器的時區** 切月、切日（`new Date(y, m, 1)`）；UAT 容器沒有設 `TZ`，是 UTC，每月 1 日台灣 0–8 點的工單算到上個月。`TenantSettings.timezone`（預設 `Asia/Taipei`）存在但報表沒有用 | **實測**。本機固定資料（5 則訊息都在台灣 10/21）：KPI「訊息總量」5，但 `message-trend` 回兩筆（UTC 10-20 有 3 則、10-21 有 2 則），案件趨勢 10-20 有 2 張、10-21 有 1 張，新聯絡人趨勢在 10-20 | `analytics.service.ts:13-22, 212, 492, 560-562`；`analytics.aggregator.ts:19-20` | ANA-01（已記錄，建議補上 ②） |
| RBAC-02 | P2 | **確認仍未修正。** seed agent（只有 `analytics.view.self`）以帳密 `POST /auth/cli/login` 拿到含 `cli:analytics:read` 的 token，`GET /cli/analytics/overview`、`/channels` 都回 200 與全租戶數字；網頁 `/analytics/overview` 同一人回 403 | **實測**（本機） | `apps/api/src/modules/cli/cli.routes.ts:88-149` | RBAC-02（已記錄） |
| DB-03 | P4 | 確認仍未修正：`daily_stats` 每天有寫入（本機最新一筆 2026-10-28，各 statType 都有），報表仍全部即時計算 | 實測（psql） | `analytics.scheduler.ts`、`analytics.aggregator.ts` | DB-03（已記錄） |
| HC-ANALYTICS-05 | P3 | 選反日期、或 API 回 403／500 時，報表頁只顯示「-」與「尚無資料」，沒有錯誤訊息。hook 有回傳 `error`，頁面沒有使用。日期框也不阻止開始日晚於結束日。agent 直接開 `/dashboard/analytics` 時看起來像「沒有資料」而不是「沒有權限」 | **實測**。本機：開始日 10/25、結束日 10/21 → 5 支 API 都 400，畫面全部「-」、3 處「尚無資料」，`[role=alert]` 是空的；agent 開總覽網址也一樣 | `apps/web/src/hooks/useAnalytics.ts:23-61`；`apps/web/src/app/dashboard/analytics/page.tsx:58-62`；`apps/web/src/components/analytics/DateRangePicker.tsx:50-64` | 新（手冊已寫「不會有錯誤提示」） |
| HC-ANALYTICS-06 | P3 | 同一份報表的 CSAT 有兩種歸期方式：總覽的 CSAT 分數與好評率依工單 `createdAt`，`/analytics/csat` 依 `csatSentAt`。同一段期間兩者可能一邊有分數、一邊沒有 | **實測**。本機：工單 10-20 18:00Z 建立、10-21 00:00Z 寄問卷、5 分 → 區間 10-20 23:00Z～10-21 15:59Z：總覽 `csatAvg: null`，`/analytics/csat` `avgScore: 5`。UAT：總覽 `csatAvg: null`，`/csat` `totalSent: 1` | `analytics.service.ts:112-124`；`analytics.routes.ts:132-149` | 新 |
| HC-ANALYTICS-07 | P3 | `/analytics/agents?agentId=X` 在 X 本期沒有工單時回空陣列（`agentId` 條件放在 LEFT JOIN 之後的 WHERE）。「我的績效」因此退回空白預設值，`name`、`role` 是空字串；CLI 的「Agent:」改印 agentId | **實測**。本機 `?agentId=<supervisor>`（區間內無工單）回 `[]`；UAT admin `GET /analytics/my` 回 `name: ""` | `analytics.service.ts:329, 364, 568-578` | 新 |
| HC-ANALYTICS-08 | P3 | 「熱門標籤」不受期間限制，而且以標籤名稱分組：不同範圍的同名標籤合併計數，被封存（已合併）的聯絡人也算 | **實測**。本機區間只有 1 位新聯絡人，`topTags` 仍回「健檢行銷 6」等期間外的貼標 | `analytics.service.ts:518-528` | 新（此端點目前沒有前端入口） |
| HC-ANALYTICS-09 | P3 | CLI 報表路由沒有「開始日不可晚於結束日」的檢查，選反時回全 0 報表。主規格 `analytics-reports` 寫「每個接受 `from`、`to` 的分析端點」都要回 400 | **實測**。`GET /cli/analytics/overview?from=2026-12-31&to=2020-01-01` 回 200、訊息 0 | `apps/api/src/modules/cli/cli.routes.ts:22-29` | 新 |
| HC-ANALYTICS-10 | P3 | 首頁「營運概況」的「開啟中工單」與報表「開啟中案件」名稱幾乎相同、數字不同：首頁只算 `OPEN` 且依渠道可見範圍，報表算 `OPEN/IN_PROGRESS/PENDING/ESCALATED` 且全租戶 | **實測**。本機 admin：首頁 2、報表 4；supervisor：首頁 0、報表 4 | `apps/web/src/app/dashboard/page.tsx:151`；`analytics.service.ts:52-57` | 新 |
| HC-ANALYTICS-11 | P3 | 指標定義容易誤讀（手冊已逐條說明）：案件趨勢的「已解決」是「當天新開、至今已解決」；升級率只算目前仍是 `ESCALATED` 的工單；客服績效算在「目前負責人」；平均時間以工單建立日歸期間，已解決數以解決日歸期間 | 讀程式，並以固定資料確認案件趨勢 | `analytics.service.ts:96-108, 211-214, 296-306, 358-361` | 新 |
| HC-ANALYTICS-12 | P3 | 圖表標示不完整：訊息趨勢只有 LINE、Facebook、WebChat 三條線，Instagram（`THREADS`）有算進總量但沒有線；優先級、SLA 違規表的狀態、客服角色都顯示英文代碼；客服角色欄顯示舊的 `role` 列舉，自訂角色的成員也顯示 `AGENT` | 實測（截圖）；THREADS 讀程式 | `apps/web/src/components/analytics/MessageTrendChart.tsx:62-85`；`AgentPerformanceTable.tsx:117`；`analytics/page.tsx:199` | 新（手冊已說明；角色欄與 RBAC-03 同源） |
| HC-ANALYTICS-13 | P3 | 匯出沒有寫租戶稽核紀錄，也沒有筆數上限；CSV 的時間是 UTC ISO 字串（`2026-10-21T02:00:00.000Z`），不是台灣時間 | 實測（下載內容）；稽核讀程式 | `analytics.routes.ts:176-189`；`analytics.service.ts:643-667` | 新 |
| HC-ANALYTICS-14 | P3 | 沒有渠道篩選與成員篩選。後端只有 `/agents` 的 `agentId`，前端沒用；`/cases` 的 `groupBy`、`category` 被解析但沒有作用；`/analytics/contacts`、`/analytics/csat`、overview 的 5 個欄位、`statusDistribution`、`newContactsByChannel` 都沒有畫面 | 讀程式 | `analytics.routes.ts:38-43, 83`；`apps/web/src/hooks/useAnalytics.ts:63-69` | 新（產品缺口，規格沒有要求） |

### 重點驗證的結論

| 項目 | 結論 |
| --- | --- |
| 數字與 DB 是否一致 | **大致一致，但有三個定義問題。** 訊息總量、進出向、新工單、開啟中工單、渠道分布、活躍聯絡人與 psql 結果相同（本機 67/46/21 與固定資料 5/3/2）。不一致的地方是：「已解決」相關指標（HC-ANALYTICS-02）、CSAT 的歸期（HC-ANALYTICS-06）、熱門標籤不看期間（HC-ANALYTICS-08） |
| 日期邊界用台灣時區還是 UTC | **混用。** 前端區間用瀏覽器本地時區（台灣），後端分組用 UTC（ANA-01），「我的績效」與每日彙總用 API 伺服器時區（UAT 是 UTC）。CLI 的 `--from 2026-10-01` 以 UTC 午夜解析 |
| 是否依渠道可見範圍過濾 | **沒有**（HC-ANALYTICS-03）。網頁報表、匯出、CLI 都統計全租戶 |
| CLI `cli:analytics:read` | scope 檢查正常（沒有 scope 回 403、無效 token 回 401，有單元測試）；但不看角色與方案（RBAC-02，實測仍存在） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 選期間 | 本機 | 正常：自訂 10/21～10/21 送出 `from=2026-10-20T16:00:00.000Z`、`to=2026-10-21T15:59:59.999Z`，KPI 訊息總量 5 與 psql 一致 | **異常**：選反日期無錯誤訊息（HC-ANALYTICS-05） | — | |
| 2 概覽 | 本機、UAT | KPI 正確（5、4、50%、5）；客服 TOP 5 正確 | — | 正常：agent 側欄沒有「總覽」；直接開網址顯示「-」（HC-ANALYTICS-05） | **異常**：趨勢圖沒有日期（HC-ANALYTICS-01）、同一天拆兩點（ANA-01） |
| 3 案件報表 | 本機 | 分類、優先級、SLA 違規表（K3 逾時）、升級率 0% 正確 | — | 有 `analytics.view` 就看得到全租戶工單標題與聯絡人（HC-ANALYTICS-03） | **異常**：「已解決」計數錯（HC-ANALYTICS-02）；狀態、優先級為英文（HC-ANALYTICS-12） |
| 4 客服績效 | 本機 | 排序、處理數、已解決、首次回應 10 分、CSAT 5、SLA 50% 與固定資料一致（含 HC-ANALYTICS-02 的偏差） | `agentId=abc` 400 | — | 自訂角色顯示 `AGENT`（HC-ANALYTICS-12） |
| 5 渠道分析 | 本機、UAT | 正常：WEBCHAT 5 則、1 段對話、Bot 處理 1 | — | — | 不依渠道可見範圍（HC-ANALYTICS-03） |
| 6 優惠券成效 | 本機 | 正常：分頁載入，無匯出鈕 | — | — | 計算屬行銷領域，未核數字 |
| 7 匯出 CSV | 本機 | 正常：四種都下載，皆以 `EF BB BF` 開頭；概覽欄名英文（手冊已說明） | `reportType=contacts` 400；**異常**：名稱含逗號或公式時跑欄（HC-ANALYTICS-04） | 正常：supervisor 有按鈕；agent、只有 `analytics.view` 的自訂角色沒有按鈕，後端 403 `requiredPermission: analytics.export` | 不寫稽核（HC-ANALYTICS-13） |
| 8 我的績效 | 本機、UAT | 正常：agent 顯示待處理 1、本月處理 4、已解決 2、首次回應 10 分、CSAT 3 | — | 正常：只有 `analytics.view.self` 的 agent 能看；只有 `analytics.view` 的自訂角色也能開（模組門檻任一即可，符合設計） | 名稱空白（HC-ANALYTICS-07）；切月看伺服器時區（ANA-01 ②） |
| 9 首頁營運概況 | 本機 | 正常：開啟中工單 2、聯絡人 27、活躍規則 0，與各 API 的 `meta.total` 一致 | 沒有權限的格子顯示「載入失敗」與「重試統計」 | 依各模組權限 | **異常**：與報表的「開啟中案件」不同（HC-ANALYTICS-10） |
| 10 CLI stats | 本機（API） | scope 正常：overview、channels、message-trend 回 200 | 無效 token 401；`from=abc` 400；**異常**：反向區間回全 0（HC-ANALYTICS-09） | **異常**：agent 可讀全租戶報表（RBAC-02） | 沒有實際執行 `open333` 指令（需要 build CLI，不在可做範圍）；以 unit 測試為準 |
| 11 每日彙總 | 本機 | 未驗排程本身；`daily_stats` 有 2026-10-28 的資料 | — | — | DB-03 |

權限測試用的角色：admin、seed supervisor（`analytics.view`、`analytics.export`，只看得到 1 個渠道）、seed agent（只有 `analytics.view.self`）、本機自建「hc-analytics-僅檢視報表」（只有 `analytics.view`、只綁 LINE-A）與它的成員 `hc-analytics-viewer`。結束時角色與成員已刪除，CLI token 已登出。

## 完備度對照

| Spec / Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| analytics-reports／Reversed date range | `analytics.routes.ts:23-28` | `apps/api/tests/feature/modules/analytics/analytics-date-range.test.ts:53` | 有，但畫面沒有錯誤訊息（HC-ANALYTICS-05） |
| analytics-reports／Same day | 同上 | 同檔 `:64` | 有 |
| analytics-reports／CSV 以 BOM 開頭 | `analytics.service.ts:614-624` | `apps/api/tests/unit/modules/analytics/export-csv-bom.test.ts:9` | 有 |
| analytics-reports／沒有匯出權限時不顯示按鈕 | `apps/web/src/app/dashboard/analytics/page.tsx:50, 102` | `apps/web/tests/unit/app/dashboard/analytics/analytics-export.test.tsx:39` | 有 |
| analytics-reports／匯出失敗時顯示錯誤 | `page.tsx:30-41, 90-91` | 同檔 `:45` | 有 |
| cli-analytics／Token has analytics read scope | `cli.routes.ts:88-98` | `apps/api/tests/unit/modules/auth/cli-session-auth.test.ts`（`testCliAnalyticsRoutes`） | CLI |
| cli-analytics／Token lacks analytics read scope | `cli.routes.ts:31-44` | 同上 | CLI |
| cli-analytics／Token is invalid | `authenticateCliSession` | 同上 | CLI |
| cli-analytics／Read overview statistics | `cli.routes.ts:88-98` | 同上 | `open333 stats` |
| cli-analytics／Read message trend statistics | `cli.routes.ts:100-110` | **無** | `open333 stats` |
| cli-analytics／Read case statistics | `cli.routes.ts:112-122` | 同上（cases） | `open333 stats` |
| cli-analytics／Read channel analytics | `cli.routes.ts:124-134` | **無** | `open333 stats` |
| cli-analytics／Read current-agent performance | `cli.routes.ts:136-149` | **無** | `open333 stats` |
| cli-analytics／Shared analytics calculation | `cli.routes.ts:3-9` 匯入同一組 service | **無**（結構確認） | — |
| cli-analytics／CLI response shaping | `cli.routes.ts:46-52` | 同上（cases） | — |
| cli-analytics／Analytics scope visible／hidden in discovery | `cli-endpoints.ts` 的 `visibleCliCapabilities` | 同上 | `open333 apis` |
| cli-analytics／Print statistics text／JSON／lacks scope | `apps/cli/src/commands/stats.ts` | `apps/cli/tests/unit/commands/stats-command.test.ts:135-137` | `open333 stats` |
| rbac／沒有報表權限的成員不能以 CLI 讀報表 | **缺實作**（RBAC-02） | 無 | — |

**有後端、沒有前端入口**：`GET /analytics/contacts`、`GET /analytics/csat`、`/analytics/agents` 的 `agentId`、`message-trend` 的 `groupBy=week|month`、overview 的 `newCases`／`resolvedCases`／`avgFirstResponseMinutes`／`avgResolutionMinutes`／`csatPositiveRate`、`statusDistribution`、`newContactsByChannel`。

**前端送出的值與後端 Zod**：`from`/`to` 為 ISO 字串、`groupBy=day`、`reportType` 為 `overview|cases|agents|channels`，後端都接受。沒有發現前端送出、後端拒絕的值。

## 待真機驗

- 每日彙總排程在 UAT 的執行時間與切日（容器 UTC 時，`0 2 * * *` 是台灣 10:00，彙總的「昨天」是 UTC 的昨天）。只能從 log 確認，本次未查。
- `open333 stats` 實際指令輸出（需要 build CLI）。目前以 `stats-command.test.ts` 與直接打 API 為準。

## UAT 操作紀錄

只讀：`GET /analytics/overview`、`/message-trend`、`/cases`、`/channels`、`/contacts`、`/csat`、`/my`，`POST /analytics/export`（工單，下載後刪除），瀏覽報表頁與我的績效。沒有建立、修改或刪除任何資料。UAT 結果與本機一致：趨勢 `date: 0`、3 張關閉工單有 2 張沒有 `resolvedAt`、總覽 CSAT 為空但 `/csat` 有 1 筆寄出、`/my` 名稱空白。

## 建議新增到 AUDIT.md 的項目

- HC-ANALYTICS-01：訊息趨勢的 `date` 被 pivot 預設值蓋成 0（P1）。
- HC-ANALYTICS-02：工單直接關閉不寫 `resolvedAt`、重開不清 `resolvedAt`，報表的已解決與 SLA 達成率失真（可與 HC-CASES-02 合併成一項工單狀態轉換的問題）。
- HC-ANALYTICS-03：報表與匯出不套用渠道可見範圍，SLA 違規表回傳整筆工單。建議加進 RBAC-04 的表格。
- HC-ANALYTICS-04：匯出 CSV 沒有跳脫（跑欄與 CSV injection）。
- ANA-01 補充：「我的績效」的月份與每日彙總以伺服器時區切分；KPI 區間與趨勢分桶時區不同。
- HC-ANALYTICS-09：CLI 報表路由沒有日期順序檢查（主規格 `analytics-reports`）。

## 文件過時之處

- `docs/ref/features/tenant/ANALYTICS.md`：端點表沒有 `GET /analytics/coupons` 與「優惠券成效」分頁；沒寫 `/analytics/contacts`、`/analytics/csat` 前端沒有用到；「數字怎麼算」沒寫直接關閉的工單不算已解決、總覽 CSAT 以工單建立日歸期間；「日期以 UTC 切分」沒提「我的績效」以伺服器時區切月；「不套用渠道可見範圍」沒提 SLA 違規表與匯出會帶出工單標題與聯絡人名稱。
- 手冊 `apps/web/public/manual/ch13-analytics.html` 的定義說明與程式一致；趨勢圖沒有日期的問題（HC-ANALYTICS-01）手冊沒有提，修好後不用改手冊。
