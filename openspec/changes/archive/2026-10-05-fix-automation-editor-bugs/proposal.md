## Why

UAT 實測 `add-automation-create-case`（tasks 4.3）時，在 Demo Tenant 的自動化規則頁遇到三個問題，「一般問題自動開案」因此無法重新儲存：

1. 規則列表看不到第 21 條以後的規則。API 預設一頁 20 條，前端沒有分頁，也沒有載入更多。Demo Tenant 有 155 條規則，「一般問題自動開案」排在第 29 條。
2. 規則裡有契約外的動作（例如 `auto_assign`，契約從來沒有這個動作）時，存檔一定失敗。編輯頁載入時只濾掉 `UNSUPPORTED_AUTOMATION_ACTION_TYPES` 的 4 種動作。另一段依觸發事件過濾的程式，在規則的觸發事件與預設值相同（收到訊息）時不會重跑。畫面也沒有說明是哪個動作有問題。
3. 契約驗證的錯誤訊息只有「尚未支援」那一句是中文，其他是英文技術訊息（`actions[1].type is not allowed for message.received: auto_assign`），管理員看不懂。

## What Changes

- 規則列表與關鍵字回覆列表載入全部規則：前端依 `meta.totalPages` 逐頁取回（每頁 100 條，API 上限）；API 排序加上 `id`，翻頁不重複不遺漏；載入失敗時顯示錯誤。
- 編輯頁載入既有規則時，濾掉所選觸發事件的契約沒有提供的所有動作，並分兩類列出：尚未支援的動作（workers 只略過該動作），以及會讓 workers 整條略過規則的動作。
- 規則列表在 workers 會整條略過的規則旁標示「規則不會執行」，原本這種失敗只寫進 log。
- 契約驗證錯誤訊息全部改成中文，寫第幾個條件、第幾個動作，並用契約的中文名稱。契約沒有的欄位或動作，沿用原始代碼。

## Capabilities

### Modified Capabilities

- `automation-engine`：規則列表顯示全部規則；編輯器移除契約外的動作；列表標示會被略過的規則。
- `automation-contract-composer`：驗證錯誤訊息用中文。

## Impact

- `packages/automation`（需重新 build）、`apps/web` 規則列表、編輯頁與關鍵字回覆列表、`apps/api` 規則列表排序
- 不需要 migration；既有規則資料不變。
- `add-automation-create-case` 也修改 `automation-engine` 的 `Actions` 需求，且尚未歸檔。本 change 用 ADDED 新增獨立的需求，不碰 `Actions`，兩個 change 的歸檔順序不受影響。
