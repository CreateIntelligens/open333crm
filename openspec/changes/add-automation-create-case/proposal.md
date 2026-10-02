## Why

自動化規則的「建立工單」自 2026-05 執行搬到 workers 後就沒有實作（AUDIT AUTO-01），#209 先把它列為不支援、存檔時拒絕。目前系統沒有任何自動建立工單的途徑，工單只能由客服手動建立。使用者需要「顧客訊息命中條件（例如含『故障』『客訴』）就自動開工單」。

## What Changes

- workers 實作 `create_case`，行為與手動「由對話建立工單」一致：
  - 依優先度（預設 MEDIUM）套用該租戶同優先度的 SLA 政策，設定 `slaDueAt`。
  - 對話關聯到新工單，寫入工單事件（`actorType: 'automation'`）。
  - 即時推播 `case.created`（收件匣與工單列表即時更新），並經 domain event 橋接發出 `case.created`，讓「工單建立」觸發的規則與自動分類照常運作。
  - 建單、關聯對話、寫事件在同一個交易；關聯以條件式更新，多個 worker 同時處理同一段對話時不會開出兩張，也不留孤兒工單。
  - 分類只收系統分類清單內的值（契約改為下拉選單，與 `CASE_CATEGORIES` 一致，測試比對兩份清單）。
- 不建立的情況（留 warn）：
  - 觸發事件是工單或 SLA 相關（避免「工單建立 → 建立工單」迴圈）。
  - 沒有對話，或對話不屬於該租戶。
  - 對話已關聯未結案的工單（不重複開）；原工單已解決或已結案時開新單並改關聯。
- 契約：`create_case` 改為需要 `contact` 與 `conversation`，只在收到訊息、postback、關鍵字命中、對話建立事件提供；從 `UNSUPPORTED_AUTOMATION_ACTION_TYPES` 移除。
- 新工單的自動分類（API 收到 `case.created` 時）改為工單已有分類就不覆蓋：原本客服手動選的分類、規則指定的分類都會被 AI 結果蓋掉（既有問題，一併修正）。

## Capabilities

### Modified Capabilities

- `automation-engine`：新增自動建立工單動作。

## Impact

- `apps/workers/src/lib/automation-actions.ts`、`packages/automation/src/contracts/actions.ts`
- 既有用到 `create_case` 的規則（UAT 4 條，皆在 Demo Tenant，觸發事件都是收到訊息或關鍵字命中）重新啟用後即可運作。其中啟用中的「一般問題自動開案」另含不存在的動作 `auto_assign`，整條規則在驗證時就被跳過，需重新儲存一次（編輯器會移除 `auto_assign`）。
- 不需要 migration。
- 已知限制：
  - 同一條規則裡的工單動作（指派、改狀態）目前設定不出來：契約要求 case 範圍，訊息類事件不提供。workers 已把新工單 id 寫回 context，日後開放即可作用在新工單。
  - 「工單建立」不會發站內通知（notification worker 沒有訂閱 `case.created`，手動建單也一樣）。
  - 自動建立的工單不做群發歸因（手動建單的 `trackBroadcastCase` 在 API 行程）。
  - 掛在聯絡人、連結點擊、工單、SLA 事件且含 `create_case` 的既有規則，契約改為需要對話後會被 workers 整條跳過；UAT 的 4 條都掛在訊息類事件，不受影響。
