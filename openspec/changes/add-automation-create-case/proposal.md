## Why

自動化規則的「建立工單」自 2026-05 執行搬到 workers 後就沒有實作（AUDIT AUTO-01），#209 先把它列為不支援、存檔時拒絕。目前系統沒有任何自動建立工單的途徑，工單只能由客服手動建立。使用者需要「顧客訊息命中條件（例如含『故障』『客訴』）就自動開工單」。

## What Changes

- workers 實作 `create_case`，行為與手動「由對話建立工單」一致：
  - 依優先度（預設 MEDIUM）套用該租戶同優先度的 SLA 政策，設定 `slaDueAt`。
  - 對話關聯到新工單，寫入工單事件（`actorType: 'automation'`）。
  - 即時推播 `case.created`，並經 domain event 橋接發出 `case.created`，讓通知與「工單建立」觸發的規則照常運作。
  - 同一條規則的後續動作（指派、改狀態等）作用在新工單上。
- 不建立的情況（留 warn）：
  - 觸發事件是工單或 SLA 相關（避免「工單建立 → 建立工單」迴圈）。
  - 沒有對話，或對話不屬於該租戶。
  - 對話已關聯未結案的工單（不重複開）；原工單已解決或已結案時開新單並改關聯。
- 契約：`create_case` 改為需要 `contact` 與 `conversation`，只在收到訊息、postback、關鍵字命中、對話建立事件提供；從 `UNSUPPORTED_AUTOMATION_ACTION_TYPES` 移除。

## Capabilities

### Modified Capabilities

- `automation-engine`：新增自動建立工單動作。

## Impact

- `apps/workers/src/lib/automation-actions.ts`、`packages/automation/src/contracts/actions.ts`
- 既有用到 `create_case` 的規則（UAT 4 條，皆在 Demo Tenant，觸發事件都是收到訊息或關鍵字命中）重新啟用後即可運作。其中啟用中的「一般問題自動開案」另含不存在的動作 `auto_assign`，整條規則在驗證時就被跳過，需重新儲存一次（編輯器會移除 `auto_assign`）。
- 不需要 migration。
