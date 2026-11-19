---
name: feature-analytics
description: >
  open333CRM「數據分析與報表」功能顧問：報表各分頁、匯出 CSV、我的績效、CLI stats。改到 analytics 模組、/dashboard/analytics，或改工單的 resolvedAt／firstResponseAt、CSAT 欄位之前使用。
---

# 數據分析與報表

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。報表的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

報表總覽的各分頁（概覽、案件報表、客服績效、渠道分析、優惠券成效）、日期區間、匯出 CSV、我的績效、首頁「營運概況」的數字、
CLI `open333 stats` 與 `/cli/analytics/*`（scope `cli:analytics:read`）、每日彙總 `DailyStat`。
相關的程式與資料：`/dashboard/analytics`、`/dashboard/analytics/my`、`analytics.service.ts`、`analytics.routes.ts`、`cli.routes.ts`、
`analytics.view`、`analytics.view.self`、`analytics.export`。
常見的問題描述：「報表數字不對」「匯出亂碼或欄位跑掉」「SLA 達成率」「平均首次回應」「CSAT 分數」「台灣時間切日」。
改工單的狀態轉換（`resolvedAt`、`firstResponseAt`）、訊息或對話資料表、渠道類型、CSAT 欄位之前也使用，確認報表不會算錯。

## 先讀

先讀功能文件 `docs/ref/features/tenant/ANALYTICS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `ANALYTICS.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、CLI 路由 | 程式的入口 |
| 新增或修改報表、報表的欄位 | 有哪些報表 |
| 已解決、SLA 達成率、首次回應、CSAT、日期分組、渠道可見範圍 | 數字怎麼算 |
| 路由權限、匯出 CSV、CLI 授權 | 權限 |
| 報表頁、首頁營運概況、`open333 stats` | 畫面怎麼呼叫 API |
| `DailyStat` 與每日彙總排程 | 負責的程式 |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的報表測試在 `apps/api/tests/unit/modules/analytics/`、`apps/api/tests/feature/modules/analytics/`、`apps/web/tests/unit/components/analytics/`、`apps/web/tests/unit/app/dashboard/analytics/`、`apps/cli/tests/unit/commands/`，寫法可以照著參考。

`ANALYTICS.md` 裡標 `HC-ANALYTICS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/ANALYTICS.md`
- 規格：`openspec/specs/analytics-reports/spec.md`、`openspec/specs/cli-analytics/spec.md`。CLI 的授權看 `openspec/specs/rbac/spec.md` 的「CLI token 的授權」。
- 手冊：`apps/web/public/manual/ch13-analytics.html`。手冊逐條寫了每個數字怎麼算，可以當定義對照。
- 影響分析：`node scripts/feature-impact.mjs --domain analytics`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `ANALYTICS.md` 括號內的章節。

- 每個接受 `from`、`to` 的端點都要拒絕 `from > to`。新端點要用 `analytics-query.ts` 的 `ordered()` 包住 schema。（有哪些報表）
- 模組門檻是 `requireAnyPermission(['analytics.view','analytics.view.self'])`。除了 `/my`，每條路由都要再掛 `requirePermission('analytics.view')`。（權限）
- 匯出的 CSV 以 UTF-8 BOM 開頭。只對有 `analytics.export` 的成員顯示按鈕。（權限）
- 匯出的每一欄（含標題列）都經過 `@open333crm/shared` 的 `csvRow()`／`csvCell()`。不要自己用 `join(',')` 拼字串。數字欄位傳 number，不要先轉成字串，否則負數會被加上 `'`。（權限）
- service 函式收 `TenantCtx`。每段 raw SQL 都要自己帶 `tenantId` 條件，不要只靠 RLS。（程式的入口）
- 報表全部從原始資料表即時計算，不讀 `DailyStat`。要改成讀彙總表，先處理 DB-03 與 ANA-01。（數字怎麼算）
- 日期分組用資料庫的 `date_trunc()`，以 UTC 切日（ANA-01）。修時區時，前端的區間與後端的分組要一起改。（數字怎麼算）
- 「已解決」「SLA 達成率」「平均解決時間」只看 `Case.resolvedAt`。`resolvedAt` 由 `caseTransitionTimestamps()` 維護。不要在報表改用 `status` 或 `closedAt` 推算已解決。（數字怎麼算；`CASES.md` 的「解決時間與關閉時間」）
- 報表依成員的渠道可見範圍統計，報表頁、匯出、CLI、MCP 用同一個判斷。新報表也要套用。（數字怎麼算）
- CLI 的 `/cli/analytics/cases` 以 `summarizeCaseStats()` 把 `slaViolations` 換成數量。改 CLI 的回應時不要拿掉這一步。（程式的入口）
- 前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`），不要讀 `response.data.message`。

## 回歸清單

改到本領域時，至少重走：

1. 數字核對：
   - 用 psql 對一段期間算出訊息數、新工單、已解決、SLA 達成率，與 `GET /analytics/overview` 對照。同一段期間，再比較報表頁的 KPI 卡。
   - 另建三張工單：直接關閉、解決後重開、解決後關閉。只有第三張算入已解決。
2. 在台灣時間凌晨 0–8 點建一筆訊息與一張工單，選那一天，確認趨勢圖的日期。目前會落到前一天（ANA-01）。
3. 訊息趨勢圖的 X 軸要有日期。
4. 四個分頁各匯出一次，檢查下列各點（unit 測試 `export-csv-escaping.test.ts`）：
   - 檔案以 BOM 開頭，每列的欄位數相同。
   - 聯絡人名稱含逗號或以 `=` 開頭時不跑欄，該欄以 `'` 開頭，不會變成公式。
   - 負數與數字欄位沒有 `'`。
5. 權限：
   - 日期框選開始日晚於結束日時，畫面顯示錯誤。直接打 API 時，後端回 400。
   - supervisor 看得到「匯出 CSV」。agent 只看得到「我的績效」。只有 `analytics.view` 的自訂角色看不到「匯出 CSV」。
   - 只能看部分渠道的成員，報表只含可見渠道的數字。
6. CLI：
   - 用 agent 帳號 `POST /auth/cli/login` 拿 token，打 `/cli/analytics/overview`。RBAC-02 修好之後應回 403。
   - `open333 stats --json`。

自動測試：

- `pnpm --filter @open333crm/api test -- analytics`
- `pnpm --filter @open333crm/api test -- cli-session`
- `pnpm --filter @open333crm/web test -- analytics date-range-picker sidebar`
- `pnpm --filter @open333crm/cli test -- stats`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/analytics guards/permission-check`。
  - 報表數字以固定資料核對：`apps/api/tests/feature/modules/analytics/analytics-reports.test.ts`。
  - 已解決數與工單狀態轉換的關係：`apps/api/tests/feature/modules/case/case-resolved-at.test.ts`。
  - 改計算邏輯時要補 feature 測試：插入固定時間的資料，再比對結果。
- E2E：`apps/web/tests/e2e-uat/tenant-analytics.spec.ts`。

## 常見 bug 從哪裡查

- 「某天的數字少了或多了」：
  - 先看是不是台灣凌晨的資料（ANA-01，`date_trunc` 以 UTC 切日）。
  - KPI 卡的總數用前端本地時區的區間，趨勢圖以 UTC 分組。兩者對不起來是目前的行為。
- 「已解決、SLA 達成率偏低或偏高」：查工單的 `resolvedAt`。直接關閉的工單沒有 `resolvedAt`，這是設計。
- 「平均首次回應是空的」：工單沒有關聯對話（SLA-05），或對話只有 AI 與系統的回覆。
- 「總覽的 CSAT 與 CSAT 報告對不起來」：總覽依工單的 `createdAt` 歸入期間，`/analytics/csat` 依 `csatSentAt`（HC-ANALYTICS-06）。
- 「首頁的開啟中工單與報表不一樣」：首頁 `apps/web/src/app/dashboard/page.tsx` 只算 `OPEN`。報表算 `OPEN`、`IN_PROGRESS`、`PENDING`、`ESCALATED`（HC-ANALYTICS-10）。
- 「客服績效或渠道分析分頁是空的」：這兩個分頁不顯示查詢錯誤。看瀏覽器的 network 回應。
- 「客服用 CLI 看得到報表」：`apps/api/src/modules/cli/cli.routes.ts` 只檢查 scope（AUDIT RBAC-02）。
