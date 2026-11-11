## Why

規則編輯器把看起來像數字的條件值（「8888」「1」、電話）一律轉成數字存檔，規則引擎的 `contains`、`equal` 等運算子對文字欄位比對數字時永遠不成立。「訊息內容 包含 8888」這類規則因此永遠不觸發，「試試看」也顯示不會觸發，管理員只會以為規則壞了（issue #418、AUDIT AUTO-06、健檢 HC-AUTOMATION-01）。現有規格沒有寫條件值的型別，也沒有寫文字欄位遇到數字比較值時的比對方式。

## What Changes

- 規則編輯器依欄位在契約的型別轉換條件值：只有數字欄位轉成數字、是／否欄位轉成布林，文字欄位（含標籤這類文字清單）一律保留字串。載入既有規則再儲存時，已存成數字的文字條件會改存成字串。
- 規則引擎的運算子（`equal`、`notEqual`、`in`、`notIn`、`contains`、`notContains`、`containsAny`、`containsAll`、`startsWith`、`textContains`、`matchesRegex`）在欄位值是文字、比較值是數字時，把數字當成文字比對，已經存成數字的舊規則不必重存就恢復觸發。
- workers 實際觸發與「試試看」（`POST /api/v1/automation/rules/:id/test`）用同一個 `evaluateRules`，結果一致。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `automation-engine`：新增「條件值依欄位型別儲存」與「文字欄位比對數字比較值」兩項需求。既有的「Rule Conditions」只描述條件格式與契約驗證，沒有涵蓋值的型別；把兩項行為寫進它會讓需求超過 500 字且混入不同行為，所以用 ADDED。

## Impact

- `apps/web/src/lib/automation/qb-to-engine.ts`（欄位型別取自 `@open333crm/automation` 的 `AUTOMATION_FACT_MAP`）
- `packages/automation/src/rules/operators.ts`（API 的試跑與 workers 的 `automation.handler.ts`、`sla.handler.ts` 都經 `evaluateRules` 使用）
- 不改資料庫、不需要 migration；數字欄位（例如開啟案件數）的比對不變。
