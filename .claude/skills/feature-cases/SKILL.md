---
name: feature-cases
description: >
  open333CRM「工單」功能顧問：建立、狀態轉換、指派與自動指派、升級、備註、CSAT 滿意度問卷。改到 case／csat 模組、/dashboard/cases，或改 SLA、渠道可見範圍、自動化的工單動作之前使用。
---

# 工單

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。工單的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

工單（案件、case、ticket）的建立、狀態轉換（`VALID_CASE_TRANSITIONS`）、指派與輪流自動指派、升級、備註與時間軸、工單標籤、
CSAT 滿意度問卷（排程、逾時結案、評分 postback、收件匣問卷卡片）、工單與對話的關聯、刪除。
相關的程式與資料：`/dashboard/cases`、case 模組、csat 模組、`assignment.service.ts`、`Case`、`CaseEvent`、`CaseNote`、
`case.created`／`assigned`／`escalated`／`resolved`／`closed`。
改 SLA 政策、渠道可見範圍、收件匣聯絡人面板、自動化的「建立工單」「指派客服」動作、通知之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/CASES.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `CASES.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 建立工單、從對話開單、連結對話 | 工單從哪裡來 |
| 狀態、按鈕、下拉、`resolvedAt`／`closedAt` | 狀態、改狀態的路徑、解決時間與關閉時間 |
| 手動指派、自動指派 | 指派 |
| 升級與通知對象 | 升級 |
| SLA 政策與期限 | 期限從哪裡來；`docs/ref/features/SLA.md` |
| 滿意度問卷、評分、逾時結案 | 解決之後 |
| 權限碼、渠道可見範圍 | 權限、誰看得到哪些工單 |
| 前端頁面與元件 | 畫面怎麼呼叫 API |

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/CASES.md`
- 規格：`openspec/specs/case-management/spec.md`、`openspec/specs/csat-survey/spec.md`、`openspec/specs/sla-policy-selection/spec.md`
  - 注意：`case-management` 的「Cases Dashboard Create Button Hidden」已過時，列表頁有「新增工單」（HC-CASES-12）。
- 手冊：`apps/web/public/manual/ch02-cases.html`
- 影響分析：`node scripts/feature-impact.mjs --domain cases`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `CASES.md` 括號內的章節。

- 狀態轉換只有一張表 `VALID_CASE_TRANSITIONS`。新增改狀態的路徑要經過 `transitionCase()` 或 `escalateCase()`。不要在 `updateCase()` 裡直接寫 `status`。（狀態、改狀態的路徑）
- `resolvedAt`、`closedAt` 只由 `caseTransitionTimestamps()` 決定。新增改狀態的路徑也要用這個函式，不要自己寫 `resolvedAt`。（解決時間與關閉時間）
- 頂部按鈕與狀態下拉的副作用要相同。（改狀態的路徑）
- 推播在 commit 之後送出。事件與工單在同一個交易寫進 outbox。自動指派與群發歸因在 commit 之後各開一個交易，失敗只記 log。（狀態、指派）
- 工單依 `channelId` 套用渠道可見範圍。看不到的工單回 404，不是 403。改路由時保留 `assertCaseChannelVisible`、`assertChannelVisible`、`assertConversationChannelVisible`。（誰看得到哪些工單）
- 自動指派只派給看得到、能回覆該渠道的成員。改 `getNextAgent()` 時不要拿掉這個條件。（指派）
- 兩個 CSAT 排程都先以條件更新認領工單，問卷是「最多一次」。不要改成先寄再記。（解決之後）
- 刪除與稽核在同一個交易。稽核寫不進去時不可刪除。（刪除）
- 工單以政策名稱記錄 SLA 政策，改優先級不重算期限。（期限從哪裡來）
- 建立或修改時帶負責人、團隊，要另查 `case.assign`（`case-permission.ts`）；改成已升級要另查 `case.escalate`。（權限）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`），不要讀 `response.data.message`。
- UI 不放 emoji 與 ✓。

## 回歸清單

改到本領域時，至少重走：

1. 列表頁「新增工單」：選有兩個渠道的聯絡人 → 選渠道 → 建立 → 導到詳情。錯誤情況：聯絡人不在渠道、空白標題、舊分類。
2. 收件匣從對話建立工單 → 同一個對話再建一次要回 409。
3. 狀態：OPEN → 指派（自動變處理中）→ 待處理 → 處理中 → 標記解決 → 關閉 → 重新開啟。
   - 每一步時間軸都有事件，`case.resolved`、`case.closed` 進 outbox。
   - 不合法的轉換回 422，並列出可改的狀態。
   - 查 DB：解決後有 `resolvedAt`，關閉後保留，重新開啟後為 null。另一張直接關閉的工單，`resolvedAt` 為 null。
4. 升級：勾兩個通知對象，Supervisor 與原負責人各收到一則，升級者自己不收。`notifyTargets: ["everyone"]` 回 400。
5. 用 API 帶 `teamId` 建工單，確認輪流指派，而且沒有渠道授權的成員被排除。
6. CSAT：
   - LINE 工單解決後 30 分鐘，對話出現問卷。網站聊天室與 FB 工單不寄，停在已解決。
   - 以 SQL 把 `csatSentAt` 調到 72 小時前，確認排程結案並關閉對話。
   - 重開再解決後不被結案，30 分鐘後重寄一份。已評分的工單重開再解決，不重寄。
   - 評分（客人送 `csat:<分數>:<工單 ID>`，或客服點卡片的分數）之後：收件匣不重新整理，問卷卡片就變唯讀，並顯示「客人評 N 分」或「客服代評 N 分」。客人的訊息顯示「我的評分：N 分」，不是代碼。工單時間軸有評分與「（評分後自動關閉）」兩筆。詳情頁的「滿意度」區塊顯示分數。
7. 用只有 `case.view` 的自訂角色，以及只能看部分渠道的成員，重走 1–4，確認 403、404 與按鈕狀態。

自動測試：

- `pnpm --filter @open333crm/api test -- case csat assignment`
- `pnpm --filter @open333crm/web test -- case escalation csat`
- `pnpm --filter @open333crm/workers test -- create-case`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/case modules/csat`。權限表在 `apps/api/tests/feature/modules/route-permission-guards.test.ts`。
- E2E：`apps/web/tests/e2e-uat/tenant-cases.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-cases-contacts-inbox.spec.ts`。

## 常見 bug 從哪裡查

- 「工單自己變成已關閉」：先看 `case_events` 有沒有 `status_changed`。`payload.reason` 是 `csat_rated` 時，是客人或客服評分後自動關閉。沒有事件時，是問卷逾時結案（`csat.scheduler.ts`）。SLA 逾時只提高優先級，不結案。
- 「被指派的人打開是 404、列表看不到」：負責人沒有該渠道的授權。手動指派不檢查（HC-CASES-04）。查 `agent_channel_accesses` 與團隊的 `channel_team_accesses`。
- 「指派了卻沒收到通知」：建立時帶負責人不發 `case.assigned`（`case.flow.ts` 的 `afterCaseCreated`），升級時改派也不發。只有 `/assign` 與自動指派會通知。
- 「自動指派沒反應」：畫面送不出 `teamId`（HC-CASES-06）。有團隊時，看候選條件（`role=AGENT`、啟用、渠道授權 `reply_only` 或 `full`）。全部不符時只寫 log「No available agent」。輪流位置存在行程記憶體，重啟或多個行程時各自從頭。
- 「客人沒收到滿意度調查」：工單要有關聯對話（列表頁建的工單沒有）。只有轉成 `RESOLVED` 才寄，直接關閉不寄。非 LINE 渠道不寄。投遞失敗時，問卷卡片顯示「這份問卷沒有送出」與原因（`metadata.deliveryFailed`、`deliveryError`），時間軸寫 `csat_send_failed`。`csatSentAt` 已寫入，不會重寄。
- 「首次回應一直未達或已達」：後端看 `Case.firstResponseAt`，只在關聯對話的客服訊息寫入（SLA-05）。詳情頁的「已達／未達」用時間軸的第一個客服事件計算（`apps/web/src/components/case/CaseDetail.tsx`，HC-CASES-11）。
- 「統計卡數字跟列表對不上」：統計不套渠道可見範圍（RBAC-04）。「即將到期」的統計用 30 分鐘，倒數元件用 120 分鐘（HC-CASES-15）。「今日解決」以 API 行程的時區切日。
- 「改分類被 400」：建立只收 `CASE_CATEGORIES`。舊工單更新時另收 `LEGACY_CASE_CATEGORIES`（`case.routes.ts`）。
- 「按了沒反應」：詳情頁改負責人、新增備註失敗時都沒有提示（HC-CASES-09）。看瀏覽器 console 與 API 回應。
