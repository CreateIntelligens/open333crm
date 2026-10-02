## 1. 測試

- [x] 1.1 `apps/api/tests/unit/modules/automation/automation-unsupported-actions.test.ts`：清單、編輯器不提供、存檔拒絕、workers 驗證選項、找出不支援動作、只改啟用狀態成功
- [x] 1.2 `apps/workers/tests/unit/handlers/automation-unsupported-actions.test.ts`：既有規則照常執行其他動作

## 2. 實作

- [x] 2.1 `packages/automation` 契約、composer、validation
- [x] 2.2 workers 驗證選項與 log 等級；API `updateRule` 只在改動邏輯時驗證、錯誤訊息中文化
- [x] 2.3 前端規則列表標示、編輯頁說明
- [x] 2.4 刪除 `action-executor.ts`

## 3. 完成檢查

- [x] 3.1 API、workers、web 的 unit 測試與 `tsc` 通過
- [x] 3.2 `CHANGELOG.md` 新增條目
- [ ] 3.3 部署後在 UAT 確認：Demo Tenant 的「一般問題自動開案」在列表顯示「含未支援的動作」、可停用
