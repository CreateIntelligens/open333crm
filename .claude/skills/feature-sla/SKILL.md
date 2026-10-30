---
name: feature-sla
description: >
  open333CRM「SLA 與營業時間」功能顧問：SLA 政策 CRUD（首次回應、解決時限、到期前預警、設為此優先級預設）、
  工單套用政策與 SLA 倒數、sla:poll 排程掃描（首次回應／解決期限的預警與逾時、客戶枯等、逾時自動升級優先級）、
  SLA 通知、SLA 事件觸發的自動化規則、報表裡的 SLA 達成率與違規表，以及營業時間對 SLA 計時的效果（目前沒有效果）。
  當有人問「SLA 怎麼算」「為什麼半夜／假日也逾時」「為什麼工單一直被升級成緊急」「逾時沒通知」「SLA 規則貼標沒反應」
  「改了政策舊工單有沒有變」，或需求、bug 碰到 /dashboard/settings/sla、/dashboard/settings/office-hours、
  modules/sla、sla.handler.ts、packages/shared/src/sla、SlaPolicy、slaDueAt、firstResponseAt 時使用。
  也在改工單優先級／狀態流程、工單建立、自動化動作、報表的 SLA 數字、通知前使用。
---

# SLA 與營業時間

## 先讀
- 功能現況：`docs/ref/features/SLA.md`
  - 注意：其中「去重：24 小時內已經發生過就直接返回」已過時。change `fix-sla-outcome-repeat`（2026-10-15）之後，同一個期限只記一次（以期限、預警時間點或上次客服回覆為起點），見 `apps/workers/src/handlers/sla.handler.ts` 的 `hasCaseEventSince`。
  - 注意：「政策如何套用」寫「依 priority 查一條政策」，程式是「該優先級勾了預設的優先，沒有預設取最早建立的」。
  - 文件沒寫：SLA 以日曆時間連續計算，**不扣營業時間與假日**（手冊 `apps/web/public/manual/ch17-settings.html` 有寫）。
- 健檢結果與已知問題：`docs/ref/features/health/SLA.md`
- 規格：`openspec/specs/sla-policy-selection/spec.md`；SLA 掃描與通知在 `openspec/specs/standalone-worker-runtime/spec.md`；SLA 事件與 facts 在 `openspec/specs/automation-engine/spec.md`（SLA Event Catalog、SLA Automation Facts、Shared SLA Domain Semantics）；收件匣建單選政策在 `openspec/specs/core-inbox/spec.md`
- 手冊：`apps/web/public/manual/ch17-settings.html`（第 3 節 SLA 政策、第 4 節營業時間）、`apps/web/public/manual/ch02-cases.html`
- 影響分析：`node scripts/feature-impact.mjs --domain sla`

程式分三處：政策 CRUD 在 `apps/api/src/modules/sla/`（`sla.worker.ts` 是刻意的 no-op）；掃描與處置在 `apps/workers/src/handlers/sla.handler.ts`（`apps/workers/src/lib/repeating-jobs.ts` 每 300 秒排一次 `sla:poll`）；判定用的純函式、事件名、facts 在 `packages/shared/src/sla/`。工單上的 SLA 欄位由 `apps/api/src/modules/case/case.service.ts` 寫入。

## 前端操作流程

格式：入口 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 政策列表 | `/dashboard/settings/sla`（`SlaManagement.tsx`） | `GET /sla-policies` → `listSlaPolicies`（依 priority 排序） | 無 | `sla.manage` / **分頁不隱藏**；403 時列表顯示「尚未建立 SLA 政策」，只在 console 記錯 |
| 2 | 建立政策 | 「建立 SLA 政策」對話框 | `POST /sla-policies` → `sla.flow.ts` → `createSlaPolicy`（租戶級 advisory lock、名稱查重、`isDefault` 時取消同優先級其他預設） | 無事件、**無稽核** | `sla.manage` / 按鈕不隱藏，按儲存才 403 |
| 3 | 編輯政策（含改名） | 列表鉛筆 | `PATCH /sla-policies/:id` → `updateSlaPolicy`；改名時同一個交易把工單 `slaPolicy` 改成新名稱 | 改時限：**既有工單的首次回應期限立刻跟著變**（掃描時現算），**解決期限不變**（建單時已寫進 `slaDueAt`） | 同上 |
| 4 | 刪除政策 | 列表垃圾桶 → `confirm` | `DELETE /sla-policies/:id` → `deleteSlaPolicy`；有未結案工單時 409 `SLA_POLICY_IN_USE`（`details.openCaseCount`），前端以 alert 顯示原因 | 硬刪除；已結案工單留下查不到的政策名稱（SLA-04） | 同上 |
| 5 | 建單時套用政策 | 工單列表「建立工單」、收件匣建立工單（`apps/web/src/components/case/CaseCreateModal.tsx` 的「SLA 政策」下拉） | `POST /cases`、`POST /conversations/:id/case` 帶 `slaPolicyId?` → `createCaseRecord` | 寫 `Case.slaPolicy`（**名稱字串**）與 `slaDueAt = 現在 + resolutionMinutes`；沒指定時用該優先級的預設政策，沒有預設取最早建立的；該優先級沒有政策就沒有 SLA | 建單看 `case.create`；下拉讀 `GET /sla-policies`，**沒有 `sla.manage`（agent 預設沒有）時下拉靜默變空** |
| 6 | 倒數與篩選（顯示） | 工單列表 SLA 欄、詳情頁、統計卡（`SlaCountdown.tsx`、`CaseDashboardStats.tsx`） | `GET /cases?slaStatus=`、`GET /cases/stats`、`GET /cases/:id`（`slaPolicyData`） | 無。「即將到期」門檻：倒數元件寫死 120 分、列表篩選與統計卡寫死 30 分，都不讀政策的預警分鐘（HC-CASES-15）；只看解決期限 | `case.view` |
| 7 | 首次回應寫入（系統） | 客服在工單**關聯對話**送訊息；或把對話掛到工單 | `conversation.service.ts` `sendMessage` → `markCaseFirstResponse`；`linkConversationToCase` → `syncFirstResponseFromConversation` | 寫 `Case.firstResponseAt`。AI、系統訊息不算。沒有關聯對話的工單永遠寫不到（SLA-05） | — |
| 8 | 排程掃描（系統） | workers `sla:poll`，每 300 秒 | `handleSlaPoll` → `getActiveCases`（OPEN/IN_PROGRESS/PENDING/ESCALATED、`slaPolicy` 非空，**全系統 `take: 100`**、不分租戶、不排除停用租戶）→ `getPolicy`（以名稱回查） | 首次回應：`createdAt + firstResponseMinutes`，`firstResponseAt` 為空才判定；解決：`slaDueAt`；客戶枯等：最後一則 OUTBOUND 的 AGENT/SYSTEM 訊息之後有 ≥3 則客戶訊息 | — |
| 9 | 逾時處置（系統） | `dispatchSlaOutcome` | 交易內 advisory lock + `hasCaseEventSince` 去重 → 解決逾時時 `bumpSlaPriority` 升一級 → 寫 `CaseEvent`（`first_response_warning`、`first_response_breached`、`sla_warning`、`sla_breached`、`customer_waiting_breached`） | socket `sla.event`、`case.updated`（升級時）；站內通知：預警只給負責人，逾時再加 ADMIN、SUPERVISOR；**升級後不重新套用政策**，`slaPolicy`、`slaDueAt` 不變 | — |
| 10 | SLA 規則 | 自動化規則編輯器選 `sla.*` 事件 | `evaluateSlaAutomationRules` → `evaluateRules` → `executeWorkerAutomationActions`（context 只有 tenantId、caseId、assigneeId、title） | `notify`、`notify_supervisor`（類型 `sla_rule`）、`assign_agent`、`set_case_priority`、`escalate_case`、`update_case_status` 會執行；**`add_tag`、`remove_tag` 一律略過**（沒有 contactId，HC-AUTOMATION-02） | 規則看 `automation.*` |
| 11 | 報表 | `/dashboard/analytics` | `analytics.service.ts`：總覽 SLA 達成率（期間內已解決且 `resolvedAt <= slaDueAt`）、案件報表 SLA 違規表（目前所有逾期未結案，不看期間）、客服績效 SLA%、我的績效即將到期（30 分） | 只有解決期限；首次回應 SLA 沒有任何統計 | `analytics.view` |
| 12 | 營業時間對 SLA 的效果 | `/dashboard/settings/office-hours`（儲存屬 settings 領域） | `GET/PUT /settings/office-hours` → `apps/api/src/modules/settings/office-hours.service.ts` | **對 SLA 沒有任何效果**：只有收訊時的非營業時間自動回覆（`inbound-side-effects.ts`）會讀。假日、下班時間、PENDING 狀態都照算 | `settings.manage` |

**有後端、沒有前端入口**：無（四個 CRUD 端點都有畫面）。反過來，前端沒有「SLA 暫停」「營業時間計時」「首次回應達成率」這些概念，後端也沒有。API 行程訂閱的 `sla.warning`、`sla.breached` 沒有發布端（APP-05）。

**前端實際送出的值**：priority `URGENT|HIGH|MEDIUM|LOW`；三個分鐘欄位以 `parseInt(...) || 預設` 送出，**填 0 或空白會被換成 15／60／10**，所以後端「必須大於 0」的驗證從畫面上碰不到；負數、小數會原樣（小數被 `parseInt` 截斷）送出。後端 `slaMinutesSchema`：正整數、上限 525600（365 天）；**不檢查預警 < 時限、解決 ≥ 首次回應**。

## 不可破壞的規則
- 工單以政策**名稱**記錄政策（`Case.slaPolicy` 是字串，SLA-04）。改名必須在同一個交易同步工單；名稱在租戶內不可重複；有未結案工單的政策不能刪。三者都靠 `sla.service.ts` 的 `lockTenantSlaPolicies` 依序執行，不要拿掉鎖（`apps/api/tests/feature/modules/sla/sla-policy-concurrency.test.ts`）。
- 掃描只屬於 workers。`apps/api/src/modules/sla/sla.worker.ts` 刻意是 no-op，不要在 API 行程再啟動掃描。
- 同一個期限的結果只記一次：去重起點是期限（逾時）、預警時間點（預警）或上次客服回覆之後（客戶枯等）。查重與寫入在同一個交易、以「工單 + 事件類型」advisory lock 保護。改掃描邏輯時保留這組（`apps/workers/tests/unit/handlers/sla-outcome-once.test.ts`）。2026-10-15 之前是 24 小時去重，逾期工單每天重升一級、重發通知，UAT 舊工單因此停在 URGENT。
- 首次回應只算客服（`senderType: AGENT`）在工單建立後的訊息；客戶枯等卻把 `SYSTEM` 也當成客服回覆。兩邊不一致是現況，不要只改一邊。
- 事件名、facts、`bumpSlaPriority`、`getSlaState` 只能在 `packages/shared/src/sla/` 維護（automation-engine「Shared SLA Domain Semantics」）。web、API、workers 不要各自寫一份門檻。
- 時間全部以 UTC 時間戳記做分鐘加減，沒有時區問題；**日期切分**（報表的日、今日已解決）才有時區問題（ANA-01、HC-SLA-12）。
- 新增 SLA 規則可用的動作時，要確認 `sla.handler.ts` 傳給 `executeWorkerAutomationActions` 的 context 有該動作需要的欄位。

## 跨功能牽連
執行 `node scripts/feature-impact.mjs --domain sla` 看最新版本。重點：
- **依賴**：工單（建單寫 `slaPolicy`、`slaDueAt`；`firstResponseAt`）、收件匣（客服回覆、客戶訊息）、通知（佇列與站內通知）、自動化（SLA 規則的動作）、聯絡人（VIP 標籤 facts）、設定（兩個分頁）。
- **被依賴**：工單（倒數、篩選、統計卡、時間軸 SLA 事件）、自動化（事件與 facts 契約）、數據分析（達成率、違規表、績效）、收件匣（建單下拉）。
- 改工單的優先級、狀態轉換、重開、刪除，或改 `resolvedAt` 的寫法，都會影響 SLA 判定與報表（HC-ANALYTICS-02）。

## 回歸清單
改到本領域時，至少重走：
1. 建立政策（含勾預設）→ 同名再建 409 → 改名 → 用到它的未結案工單 `slaPolicy` 跟著改 → 刪除使用中的政策 409、只剩已結案工單時可刪。
2. 建 HIGH 工單不指定政策 → 套用預設政策、`slaDueAt = 建立 + 解決分鐘`。
3. 把工單 `createdAt`、`slaDueAt` 往前調（本機 psql）→ 等一輪 `sla:poll`（workers log 出現 `[sla] ... for case`）→ 檢查 `case_events`、優先級升一級、`notifications` 給負責人與 ADMIN/SUPERVISOR → 再等一輪不重複。
4. 從對話建單 → 模擬器連送 3 則客戶訊息 → `customer_waiting_breached`；客服回覆後 `firstResponseAt` 有值、不再判首次回應逾時；再送 3 則 → 再記一次。
5. 用 agent（沒有 `sla.manage`）開設定頁 SLA 分頁、開建立工單對話框，確認 403 的呈現。
- 自動測試：`pnpm --filter @open333crm/api test -- sla case-sla`、`pnpm --filter @open333crm/workers test -- sla`、`pnpm --filter @open333crm/web test -- sla`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/sla`。
- E2E：`apps/web/tests/e2e-uat/tenant-settings-ops.spec.ts`（SLA 政策建立、編輯、刪除）。

## 常見 bug 從哪裡查
- 「半夜／週末／假日也逾時、也發通知」：設計如此，SLA 以日曆時間計算，不讀營業時間（HC-SLA-01）。手冊 ch17 有寫。
- 「工單一直是緊急，期限卻是中優先的」：逾時升級與手動改優先級都不重新套用政策（HC-SLA-03）；2026-10-15 前的舊工單每天被升一級。
- 「手動建的工單一定首次回應逾時」：沒有關聯對話，`firstResponseAt` 永遠空（SLA-05）。
- 「某些工單完全沒有 SLA 事件」：先查 `Case.slaPolicy` 對不對得到現有政策名稱（`getPolicy` 回 null 就略過）；再查是否超過全系統每輪 100 張（SLA-02）。
- 「SLA 規則的貼標沒反應」：workers log 出現 `Worker action "add_tag" skipped: no contact in context`（HC-AUTOMATION-02）。
- 「通知沒收到」：預警只給負責人，工單沒有負責人時預警沒有人收到；通知不檢查成員是否停用（HC-NOTIFICATIONS-02）。看 `apps/workers/src/handlers/sla.handler.ts` 的 `enqueueDefaultNotifications`。
- 「設定頁 SLA 列表是空的」：先看 `GET /sla-policies` 是否 403（成員沒有 `sla.manage`），畫面不會說。
- 「報表 SLA 達成率怪」：只算期間內已解決的工單，`resolvedAt` 的維護問題見 HC-ANALYTICS-02；日期以 UTC 切（ANA-01）。
