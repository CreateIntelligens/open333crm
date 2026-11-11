## Why

2026-10-15 重寫操作手冊時盤點自動化，發現四個「規則看起來設好了、實際不會照做」的問題（問題清單 A02、A03、A04、A09）：

1. **A09**：關鍵字規則另外設了條件（例如「對話渠道等於 LINE」）而條件不成立時，AI 仍然讓步，但 workers 評估條件後不執行規則，顧客什麼都收不到。讓步判斷只看關鍵字與動作，不看條件，也不看規則能不能通過契約驗證（workers 會整條略過驗證失敗的規則）。
2. **A03**：「傳送通知」只送給工單負責人。聯絡人建立、加標籤、短連結點擊、新對話等沒有工單的觸發，選了這個動作永遠不會送，只在 log 留一行。
3. **A04**：「傳送素材」要手動貼素材 ID，欄位提示卻寫「從素材庫選擇」。一般管理員拿不到素材 ID。
4. **A02**：UAT 示範租戶有兩條 2026-03 舊版 seed 建立的規則：「一般問題自動開案」含契約沒有的動作 `auto_assign`，「負面情緒通知」的觸發事件是契約沒有的 `sentiment.negative`。兩條都是啟用狀態，但 workers 整條略過；列表上的開關也能把這種規則重新打開。編輯器開「負面情緒通知」時，觸發事件下拉找不到這個值，顯示成第一個選項「收到訊息」。

## What Changes

- AI 讓步只計算條件成立、而且通過契約驗證的關鍵字規則。
- 「傳送通知」新增選填的「通知誰」。收件人依序是：指定的客服、工單負責人、對話負責客服；都沒有時通知主管與管理員，通知不再無聲消失。
- 「傳送素材」改成從素材庫的下拉選單挑選，顯示素材名稱與渠道；沒有素材檢視權限時退回文字輸入並說明原因。
- 不合契約的規則不可啟用：API 拒絕把這種規則改成啟用，並說明原因；停用永遠可以。
- 編輯器載入觸發事件不在契約內的規則時，下拉顯示「未知觸發事件（<代碼>）」並提示要改選。
- 新增一次性資料腳本 `scripts/disable-invalid-automation-rules.mjs`（預設 dry-run）：所有租戶中，啟用但不合契約的規則改為停用，內容保留原樣。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `automation-engine`：修改「AI 只在關鍵字規則能在該渠道回覆時讓步」；新增「傳送通知的收件人」「傳送素材從素材庫挑選」「不合契約的規則不可啟用」「編輯器標示未知觸發事件」。

## Impact

- `packages/automation`：契約 `notify` 新增選填參數 `agentId`、`send_material` 的 `materialId` 改為新的參數型別 `material`；`buildAutomationFacts` 從 workers 移到這個套件，API 與 workers 共用。
- `apps/api/src/modules/automation/automation.worker.ts`、`apps/api/src/modules/ai/kb-autoreply.service.ts`、`apps/api/src/modules/automation/automation.service.ts`
- `apps/workers/src/lib/automation-actions.ts`、`apps/workers/src/handlers/automation.handler.ts`
- `apps/web/src/components/automation/ActionEditor.tsx`、`apps/web/src/lib/automation/rule-actions.ts`、`apps/web/src/app/dashboard/automation/[ruleId]/page.tsx`
- `scripts/disable-invalid-automation-rules.mjs`：部署後由維運手動執行一次。不需要 Prisma migration，不新增權限點。
