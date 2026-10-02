## 1. 測試

- [x] 1.1 `apps/workers/tests/unit/lib/automation-create-case.test.ts`：建立工單、預設優先度與無 SLA、後續動作作用在新工單、已有未結案工單、原工單已結案、沒有對話與跨租戶、工單事件觸發
- [x] 1.2 `apps/api/tests/unit/modules/automation/automation-unsupported-actions.test.ts`：建立工單只在有對話的事件提供

## 2. 實作

- [x] 2.1 workers `create_case`
- [x] 2.2 契約：`create_case` 需要 conversation、移出不支援清單、分類改為下拉選單
- [x] 2.3 審查補強：交易內條件式關聯（並行不重複開）、分類驗證；`autoClassifyNewCase` 不覆蓋既有分類（測試 `apps/api/tests/unit/modules/ai/auto-classify-new-case.test.ts`）

## 3. 完成檢查

- [x] 3.1 API、workers、web 的 unit 測試與 `tsc` 通過
- [x] 3.2 `CHANGELOG.md` 新增條目
- [ ] 3.3 部署後在 UAT：Demo Tenant 的自動開案規則重新儲存並啟用，傳送命中的訊息，確認自動建立工單、收到通知
