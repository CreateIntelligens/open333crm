## 1. 測試

- [x] 1.1 `apps/workers/tests/unit/lib/automation-create-case.test.ts`：建立工單、預設優先度與無 SLA、後續動作作用在新工單、已有未結案工單、原工單已結案、沒有對話與跨租戶、工單事件觸發
- [x] 1.2 `apps/api/tests/unit/modules/automation/automation-unsupported-actions.test.ts`：建立工單只在有對話的事件提供

## 2. 實作

- [x] 2.1 workers `create_case`
- [x] 2.2 契約：`create_case` 需要 conversation、移出不支援清單、分類改為下拉選單
- [x] 2.3 審查補強：交易內條件式關聯（並行不重複開）、分類驗證；`autoClassifyNewCase` 不覆蓋既有分類（測試 `apps/api/tests/unit/modules/ai/auto-classify-new-case.test.ts`）

## 3. 規格

- [x] 3.0 MODIFIED「Actions」：`create_case` 改為已支援並需要對話，待實作清單剩 4 種（#197 審查：不可用 ADDED 與主規格既有需求矛盾）

## 4. 完成檢查

- [x] 4.1 API、workers、web 的 unit 測試與 `tsc` 通過
- [x] 4.2 `CHANGELOG.md` 新增條目
- [x] 4.3 部署後在 UAT 驗證自動建單：改以 UAT E2E `apps/web/tests/e2e-uat/tenant-automation-editor-fixes.spec.ts` 案例 05 驗證（2026-10-05，PR #221 部署後）——建立 [E2E] 規則、從網站客服送出命中的訊息，自動建立工單、優先度正確、關聯觸發的對話；測後刪除規則。Demo Tenant 的「一般問題自動開案」沒有重新儲存：儲存後會對每位沒有未結案工單的聯絡人開單，由使用者決定
