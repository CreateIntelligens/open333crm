## Why

自動化動作「更新工單狀態」不檢查狀態轉換（issue #469，AUDIT AUTO-10、AUTO-12）：規則能把「開啟」直接改成「已解決」，客服手動操作時系統會回 422。工單時間軸也沒有這筆變更，socket 推送的 `source` 寫成 `sla_worker`，對外 webhook 收不到 `case.resolved`／`case.closed`。

規則的參數也只檢查「有填」：用 API、CLI 或 MCP 可以存 `status: "FOO"` 的規則，觸發時才因 Prisma enum 錯誤失敗，而且只寫 log。

編輯器的狀態選單沒有「待處理（PENDING）」。2026-11-09 使用者決定加入，同樣受狀態轉換限制。

## What Changes

- workers 的 `update_case_status`：寫入前用 `@open333crm/shared` 的 `canTransition()`。
  - 不合法：不改工單，在工單時間軸寫一筆 `automation_status_skipped`（規則名稱、原狀態、目標狀態），後台看得到原因。
  - 目標狀態等於目前狀態：不改、不寫紀錄。
  - 合法：條件更新狀態，同一個交易寫 `status_changed` 工單事件（`actorType: 'automation'`，payload 帶 `source: 'automation'` 與規則），轉成已解決、已關閉時寫 `case.resolved`／`case.closed` 到 outbox；socket 推送 `source: 'automation'`。
- `case.resolved`／`case.closed` 的 payload 改由 `@open333crm/shared` 的 `caseStatusOutcomeEvent()` 組，API 的 `caseTransitionedEffects()` 與 workers 共用，兩邊不各自寫一份。
- `packages/automation` 的 `validateActionParams()`：`type: 'select'` 的參數有值時必須是 `values` 之一，存規則時回 400（API、CLI、MCP 都走這裡）。
- `caseStatusOptions` 加入 `PENDING`（待處理）。
- 工單時間軸顯示 `automation_status_skipped`，自動化造成的 `status_changed` 標出規則名稱。

## 判斷：為什麼發 `case.resolved`／`case.closed`

API 的 `transitionCase()` 轉成已解決、已關閉時一定發這兩個事件。目前在系統內訂閱它們的只有對外 webhook（`EXTERNAL_EVENT_NAMES` 包含全部事件）；滿意度問卷靠排程讀 `resolvedAt`，自動化訂閱者沒有訂閱這兩個事件（AUTO-05），所以不會造成規則迴圈。不發的話，租戶的 webhook 只收得到手動結案，收不到規則結案，兩條路徑的結果不一致。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `case-management`：新增「自動化改工單狀態依轉換規則」的需求。
- `automation-contract-composer`：「Contract Compatibility Validation」加上下拉參數值的檢查；「Fact And Action Definitions」加上狀態選項含待處理。

## Impact

- `apps/workers/src/lib/automation-actions.ts`
- `packages/shared/src/constants/case-transitions.ts`
- `apps/api/src/modules/case/case-effects.ts`
- `packages/automation/src/contracts/validation.ts`、`actions.ts`（web 會打包，需跑 `pnpm build`）
- `apps/web/src/components/case/CaseTimeline.tsx`
- 既存規則若存了不在選項內的下拉值，workers 會以契約驗證整條略過，規則列表標示「規則不會執行」（既有機制）。部署前可查：`automation_rules` 的 `actions` 中 `update_case_status.status`、`set_case_priority.priority`、`escalate_case.newPriority`、`create_case.priority`／`category` 不在選項內的列。
- 既存「建立工單時改成已解決」這類規則之後不再生效，工單時間軸會寫略過紀錄。
