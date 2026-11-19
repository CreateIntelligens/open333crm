---
name: feature-sla
description: >
  open333CRM「SLA 與營業時間」功能顧問：SLA 政策、工單套用政策與倒數、sla:poll 掃描的預警、逾時與自動升級、報表的 SLA 數字。改到 sla 模組、sla.handler.ts、SlaPolicy、slaDueAt，或改工單優先級與狀態流程之前使用。
---

# SLA 與營業時間

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。SLA 的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

SLA 政策 CRUD（首次回應、解決時限、到期前預警、設為此優先級預設）、工單套用政策與 SLA 倒數、
`sla:poll` 排程掃描（首次回應與解決期限的預警與逾時、客戶枯等、逾時自動升級優先級）、SLA 通知、SLA 事件觸發的自動化規則、
報表的 SLA 達成率與違規表、營業時間對 SLA 計時的效果。
相關的程式與資料：`/dashboard/settings/sla`、`/dashboard/settings/office-hours`、`modules/sla`、`sla.handler.ts`、
`packages/shared/src/sla`、`SlaPolicy`、`slaDueAt`、`firstResponseAt`。
常見問題：「SLA 怎麼算」「為什麼半夜或假日也逾時」「為什麼工單一直被升級成緊急」「逾時沒通知」「SLA 規則貼標沒反應」「改了政策舊工單有沒有變」。
改工單優先級與狀態流程、工單建立、自動化動作、報表的 SLA 數字、通知之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/SLA.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `SLA.md` 的章節 |
| --- | --- |
| 找路由與排程對應的函式 | 程式碼分佈在哪裡、程式的入口 |
| 政策的欄位與驗證 | 政策的設定項 |
| 建立、改名、刪除政策 | 政策的建立、修改與刪除 |
| 建單挑政策、`slaDueAt`、改優先級 | 政策如何套用到工單 |
| `sla:poll` 的判定、首次回應、客戶枯等 | 監控的時限 |
| 去重、升級優先級、推播、通知對象 | 逾時之後系統做什麼 |
| SLA 事件的自動化規則 | 租戶自訂規則 |
| 營業時間 | 營業時間與 SLA |
| 報表的 SLA 數字 | 報表的 SLA 數字 |
| 前端頁面與元件 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的 SLA 測試在 `apps/api/tests/unit/modules/sla/`、`apps/api/tests/feature/modules/sla/`、`apps/workers/tests/unit/handlers/`（`sla-outcome-once.test.ts`）、`apps/web/tests/unit/components/settings/`，寫法可以照著參考。

`SLA.md` 裡標 `HC-SLA-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/SLA.md`
- 規格：
  - `openspec/specs/sla-policy-selection/spec.md`
  - SLA 掃描與通知：`openspec/specs/standalone-worker-runtime/spec.md`
  - SLA 事件與 facts：`openspec/specs/automation-engine/spec.md`（SLA Event Catalog、SLA Automation Facts、Shared SLA Domain Semantics）
  - 收件匣建單選政策：`openspec/specs/core-inbox/spec.md`
- 手冊：`apps/web/public/manual/ch17-settings.html`（第 3 節 SLA 政策、第 4 節營業時間）、`apps/web/public/manual/ch02-cases.html`
- 影響分析：`node scripts/feature-impact.mjs --domain sla`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `SLA.md` 括號內的章節。

- 工單以政策**名稱**記錄政策（`Case.slaPolicy` 是字串，SLA-04）。改名在同一個交易同步工單、名稱不可重複、有未結案工單的政策不能刪，三者都靠 `lockTenantSlaPolicies()` 依序執行。不要拿掉這把鎖。（政策的建立、修改與刪除）
- 掃描只屬於 workers。`apps/api/src/modules/sla/sla.worker.ts` 刻意是 no-op，不要在 API 行程再啟動掃描。（程式碼分佈在哪裡）
- 同一個期限的結果只記一次。查重與寫入在同一個交易，以「工單 + 事件類型」advisory lock 保護。改掃描邏輯時保留這組。（逾時之後系統做什麼）
- 首次回應只算 `AGENT` 訊息，客戶枯等也把 `SYSTEM` 訊息當成客服回覆。兩邊不一致是現況，不要只改一邊。（監控的時限）
- 事件名、facts、`bumpSlaPriority`、`getSlaState` 只在 `packages/shared/src/sla/` 維護。web、API、workers 不要各自寫一份門檻。（程式碼分佈在哪裡）
- 期限以 UTC 時間戳記加減分鐘。只有切日期的地方有時區問題。（監控的時限、報表的 SLA 數字）
- SLA 規則開放新的動作之前，確認 `sla.handler.ts` 傳給 `executeWorkerAutomationActions` 的 context 有該動作需要的欄位。（租戶自訂規則）

## 回歸清單

改到本領域時，至少重走：

1. 政策的 CRUD：
   - 建立政策（含勾預設）→ 同名再建回 409。
   - 改名 → 用到這條政策的未結案工單，`slaPolicy` 跟著改。
   - 刪除使用中的政策回 409；只剩已結案工單時可以刪除。
2. 建 HIGH 工單、不指定政策 → 套用預設政策，`slaDueAt = 建立時間 + 解決分鐘`。
3. 掃描與處置：
   - 用本機 psql 把工單的 `createdAt`、`slaDueAt` 往前調。
   - 等一輪 `sla:poll`，workers log 出現 `[sla] ... for case`。
   - 檢查 `case_events`、優先級升一級、`notifications` 給負責人與 ADMIN、SUPERVISOR。
   - 再等一輪，確認不重複。
4. 客戶枯等：
   - 從對話建單 → 模擬器連送 3 則客戶訊息 → 出現 `customer_waiting_breached`。
   - 客服回覆後 `firstResponseAt` 有值，不再判首次回應逾時。
   - 再送 3 則 → 再記一次。
5. 用預設的客服角色（沒有 `sla.manage`）開設定頁的 SLA 分頁、開建立工單對話框，確認 403 的呈現。

自動測試：

- `pnpm --filter @open333crm/api test -- sla case-sla`
- `pnpm --filter @open333crm/workers test -- sla`
- `pnpm --filter @open333crm/web test -- sla`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/sla`
- E2E：`apps/web/tests/e2e-uat/tenant-settings-ops.spec.ts`（SLA 政策建立、編輯、刪除）。

## 常見 bug 從哪裡查

- 「半夜、週末、假日也逾時、也發通知」：SLA 以日曆時間計算，不讀營業時間（HC-SLA-01）。手冊 ch17 有寫。
- 「工單一直是緊急，期限卻是中優先的」：逾時升級與手動改優先級都不重新套用政策（HC-SLA-02）。
- 「手動建的工單一定首次回應逾時」：沒有關聯對話，`firstResponseAt` 永遠是空值（SLA-05）。
- 「某些工單完全沒有 SLA 事件」：
  - 先查 `Case.slaPolicy` 對不對得到現有的政策名稱。`getPolicy` 回 null 時，這張工單被略過。
  - 再查是否超過全系統每輪 100 張（SLA-02）。
- 「SLA 規則的貼標沒反應」：workers log 出現 `Worker action "add_tag" skipped: no contact in context`（HC-AUTOMATION-02）。
- 「通知沒收到」：
  - 預警只給負責人。工單沒有負責人時，預警沒有人收到。
  - 負責人已停用時，通知被略過，不改發主管（CONV-06）。
  - 看 `apps/workers/src/handlers/sla.handler.ts` 的 `enqueueDefaultNotifications`。
- 「設定頁 SLA 列表是空的」：先看 `GET /sla-policies` 是否回 403（成員沒有 `sla.manage`），畫面不會說（HC-SLA-09）。
- 「報表 SLA 達成率怪」：只算期間內已解決的工單。`resolvedAt` 的規則見 feature-cases（直接關閉不算已解決、重開時清除）。日期以 UTC 切（ANA-01）。
