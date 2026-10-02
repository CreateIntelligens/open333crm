## 1. 測試

- [x] 1.1 `apps/api/tests/unit/modules/automation/automation-unsupported-actions.test.ts`：清單、編輯器不提供、存檔拒絕、workers 驗證選項、找出不支援動作、只改啟用狀態成功
- [x] 1.2 `apps/workers/tests/unit/handlers/automation-unsupported-actions.test.ts`：既有規則照常執行其他動作

## 2. 實作

- [x] 2.1 `packages/automation` 契約、composer、validation
- [x] 2.2 workers 驗證選項與 log 等級；API `updateRule` 只在改動邏輯時驗證、錯誤訊息中文化
- [x] 2.3 前端規則列表標示、編輯頁說明
- [x] 2.4 刪除 `action-executor.ts`，更新 `docs/ref/features/tenant/AUTOMATION.md` 與主規格 `ai-usage-recording` 對它的引用
- [x] 2.5 編輯頁載入既有規則時濾掉不支援的動作；測試 `apps/web/tests/unit/lib/automation/rule-actions.test.ts`

## 3. 完成檢查

- [x] 3.1 API、workers、web 的 unit 測試與 `tsc` 通過
- [x] 3.2 `CHANGELOG.md` 新增條目
- [x] 3.3 部署後在 UAT 確認：~~Demo Tenant 的「一般問題自動開案」在列表顯示「含未支援的動作」、可停用~~ 改由 `add-automation-create-case` 3.3 驗證：該 change 補上 `create_case` 實作，這條規則不再含未支援的動作；可停用由 `automation-unsupported-actions.test.ts` 的 updateRule 測試涵蓋

## 4. 規格修正（#197 審查）

- [x] 4.1 delta 由 ADDED「拒絕 workers 尚未支援的動作」改為 MODIFIED「Actions」：主規格原本寫 SHALL 支援 `create_case`，ADDED 會讓主規格同時要求支援與拒絕
