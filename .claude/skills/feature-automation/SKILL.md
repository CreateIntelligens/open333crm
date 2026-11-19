---
name: feature-automation
description: >
  open333CRM「自動化規則」功能顧問：觸發事件、條件、動作、試跑、執行紀錄、關鍵字回覆、加好友禮、Canvas。改到 automation／canvas 模組、packages/automation、workers 的 automation-actions，或改事件發布之前使用。
---

# 自動化規則

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。自動化的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

規則列表與編輯器（觸發事件、條件、動作、執行順序、命中即停止）、事件觸發（`message.received`、`keyword.matched`、新對話、工單建立與升級、
`contact.created`、`contact.tagged`、`link.clicked`、`contact.followed`、SLA 事件）、規則動作（傳送訊息與素材、工單類動作、貼標與移除標籤、通知、發券）、
試跑「試試看這條規則」、執行紀錄、關鍵字回覆頁、加好友禮頁、Canvas 互動流程（`/api/v1/canvas`）。
相關的程式與資料：`/dashboard/automation`、`/dashboard/line/keyword-replies`、`/dashboard/line/follow-gift`、automation 模組、canvas 模組、
`packages/automation` 的契約、workers 的 `automation-actions.ts`。
常見的問題描述：「規則沒觸發」「自動回覆沒送出」「關鍵字沒反應」「AI 跟關鍵字一起回」。
改事件發布、標籤、工單狀態、素材、SLA 之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/AUTOMATION.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `AUTOMATION.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、workers 的執行程式 | 程式的入口 |
| 規則的欄位、契約驗證、列表與編輯頁的用語 | 一條規則由什麼組成 |
| 事件到動作的執行順序、SLA 路徑、命中即停止、只執行一次 | 規則怎麼被執行 |
| 新增或修改觸發事件 | 哪些事件能觸發規則 |
| 新增或修改動作、工單類動作、存檔的欄位限制 | 哪些動作會執行 |
| 關鍵字比對、AI 讓步、送出失敗 | 關鍵字回覆 |
| 試跑與執行紀錄 | 試跑與紀錄 |
| 規則頁、關鍵字回覆頁、加好友禮頁 | 畫面怎麼呼叫 API |
| 權限碼 | 權限 |
| Canvas | `docs/ref/modules/CANVAS-FLOW-ENGINE.md` |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的自動化測試在 `apps/api/tests/unit/modules/automation/`、`apps/workers/tests/unit/handlers/`、`apps/workers/tests/unit/lib/`、`packages/automation/tests/unit/`、`apps/web/tests/unit/lib/automation/`、`apps/web/tests/unit/components/automation/`，寫法可以照著參考。

`AUTOMATION.md` 裡標 `HC-AUTOMATION-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/AUTOMATION.md`
- 規格：`openspec/specs/automation-engine/spec.md`、`openspec/specs/automation-contract-composer/spec.md`、`openspec/specs/interaction-canvas/spec.md`
- 手冊：`apps/web/public/manual/ch05-automation.html`。關鍵字回覆另見 `apps/web/public/manual/ch10-line.html`。
- 影響分析：`node scripts/feature-impact.mjs --domain automation`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `AUTOMATION.md` 括號內的章節。

- 動作只在 workers 執行。不要在 API 端加動作執行器。新增動作要同時改契約 `packages/automation/src/contracts/actions.ts`、workers 的分支、編輯器。（負責的模組）
- 後端存 `{type, params}`，編輯器用 `{type, payload}`。API 的 Zod 只保留 `params`。（哪些動作會執行）
- workers 以 BYPASSRLS 的連線查詢，每個查詢都要自己帶 `tenantId`。不要照抄 `escalate_case`、`set_case_priority`、`assign_agent` 只用 `where: { id: caseId }` 的寫法。（哪些動作會執行）
- 每個事件的每個動作最多執行一次（`side_effect_claims`）。不要拿掉認領，否則客人會收到重複的回覆。（規則怎麼被執行）
- 不合契約的規則不可啟用，停用永遠可以。契約拿掉動作時，要附 migration 清理既有規則，參考 `20261005100000_remove_retired_automation_actions`。（一條規則由什麼組成；已拿掉的動作）
- `keyword.matched` 的每個關鍵字都要非空白。否則 `includes('')` 會讓規則對每則訊息觸發。（關鍵字回覆）
- AI 讓步（`apps/api/src/modules/automation/keyword-yield.ts`）與 workers 用同一個 `matchKeywordTrigger()`、`buildAutomationFacts`、`AUTOMATION_DELIVERY_CHANNEL_TYPES`。改條件評估或渠道清單時，兩邊一起改。（關鍵字回覆）
- `contact.tagged` 靠 `source:'automation'` 防止迴圈。新增貼標的路徑時要帶來源。（哪些動作會執行）
- 每個租戶只能有一條加好友禮，後端回 409。（程式的入口）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`），不要讀 `response.data.message`。
- UI 不放 emoji 與 ✓。

## 回歸清單

改到本領域時，至少重走：

1. 建 `message.received` 規則：
   - 條件「訊息內容 包含 退貨」；動作貼標、建立工單、傳送通知、傳送訊息。
   - 用 `POST /api/v1/simulator/send-message` 送含「退貨」的訊息。
   - 確認標籤、工單、通知、外送訊息（或失敗紀錄）都出現。
2. 條件值改用純數字（例如「包含 8888」）重走 1。確認規則命中，送出的條件 `value` 是字串。
3. `case.created` 規則（指派、改優先級、改狀態、指定通知），由 1 建立的工單觸發：
   - 改狀態為「處理中」時，時間軸有「狀態：開啟 → 處理中（自動化規則「…」）」。
   - 改狀態為「已解決」時，工單維持「開啟」，時間軸寫「沒有改狀態：不能從「開啟」直接改成「已解決」」。
   - 從「處理中」改成「已解決」的規則觸發後，查 DB 有 `resolvedAt`，outbox 有 `case.resolved`。
   - 改回「處理中」的規則觸發後，`resolvedAt` 為 null。
4. `contact.tagged` 規則：人工貼標觸發一次；自動化貼標不觸發；再貼別的標籤時會再觸發（HC-AUTOMATION-03）。
5. 在關鍵字回覆頁建 FB 規則：FB 訊息觸發，LINE 訊息不觸發。WebChat 送不出（CHAN-02）。
6. `stopOnMatch`：建兩條同事件的規則，高優先序的勾選停止，確認低優先序的不執行。
7. 權限：
   - supervisor（只有 `automation.view`）：列表看得到；儲存、開關、刪除回 403。
   - agent：側欄沒有自動化，直接開網址顯示權限不足。
8. 試試看：填符合與不符合的值各一次。

自動測試：

- `pnpm --filter @open333crm/api test -- automation`
- `pnpm --filter @open333crm/workers test -- automation`
- `pnpm --filter @open333crm/automation test`
- `pnpm --filter @open333crm/web test -- automation keyword follow-gift`
- feature 測試：`remove-retired-automation-actions`、`follow-tracking`、`backfill-follow-tracking`、`outbox-workers`。
- E2E：`apps/web/tests/e2e-uat/tenant-automation.spec.ts`、`apps/web/tests/e2e-uat/tenant-automation-editor-fixes.spec.ts`。

## 常見 bug 從哪裡查

- 「規則沒觸發」，依序查：
  1. 觸發事件是不是 AUTO-05 列出的不會觸發的事件。
  2. 規則列表有沒有標示「規則不會執行」。
  3. 條件值的型別：直接查 `automation_rules.conditions`。數字欄位的比較值存成字串時，「等於」類的條件不會命中。
  4. 是否被優先序較高、勾了「執行後停止」的規則擋掉。
  5. workers log 有沒有 `[automation] N/M rule(s) matched`。
- 「有觸發但客人沒收到」：
  - 查該對話的外送訊息 `metadata.deliveryFailed`、`deliveryError`：憑證、WebChat 外掛、素材渠道不符、渠道停用。
  - 對話已不存在時，查 `automation_logs` 的 `errorMsg`。
- 「同一則訊息回兩次」：一則訊息命中幾條關鍵字規則就回幾次。或者關鍵字規則不能回覆，AI 沒讓步（`keyword-yield.ts`）。
- 「SLA 規則的貼標沒作用」：SLA 路徑不傳 `contactId`（`apps/workers/src/handlers/sla.handler.ts` 的 `evaluateSlaAutomationRules`，HC-AUTOMATION-02）。
- 「規則改成已解決，客人沒收到滿意度調查」：`update_case_status` 會寫 `resolvedAt`。先查工單有沒有關聯對話、租戶是否停用、`csatSentAt` 是否已寫入。
- 「執行紀錄空白」：成功的執行不寫紀錄，只有動作失敗時寫（AUTO-02）。
- 「`contact.created` 規則在本機測不到」：模擬器不發布這個事件（HC-AUTOMATION-14）。
- 「Canvas 流程跑完一步就失敗」：節點的 `nextNodeId` 無法指到同一個請求建立的節點（HC-AUTOMATION-06）。執行紀錄的 `errorMessage` 是 `Node … not found in flow`。
- 「Canvas 手動觸發回 404 或 409」：
  - 流程不屬於本租戶或聯絡人不屬於本租戶時回 404。流程不是 `ACTIVE` 時回 409 `FLOW_NOT_ACTIVE`。
  - 引擎在 commit 之後才開始執行。觸發回 202、execution 卻一直停在 `RUNNING` 時，查 API log 的 `[Canvas] 流程執行失敗`。
