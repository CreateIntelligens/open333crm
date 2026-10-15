## 1. AI 讓步看規則條件與契約（A09）

- [x] 1.1 測試 `apps/api/tests/unit/modules/automation/keyword-yield-channel.test.ts`：「規則條件不成立」「規則不合契約」先確認失敗；「規則條件成立」與既有 6 個情境維持通過
- [x] 1.2 `buildAutomationFacts` 移到 `packages/automation`（收 Prisma executor），workers 改用套件版本
- [x] 1.3 `hasMatchingKeywordRule` 略過契約驗證失敗的規則，條件不成立的規則不算；兩個呼叫端傳入對話與聯絡人

## 2. 傳送通知的收件人（A03）

- [x] 2.1 測試 `apps/workers/tests/unit/lib/automation-notify.test.ts`：「指定客服」「沒有指定，工單有負責人」「沒有指定，對話有負責客服」「沒有任何負責人」「指定的客服已停用或屬於別的租戶」，先確認失敗（最後一個在舊程式也通過，以 mutation 驗證：略過客服檢查直接送給指定的客服，測試失敗）
- [x] 2.2 契約 `notify` 新增選填 `agentId`；workers 依序選收件人
- [x] 2.3 編輯器的選填客服欄位空值顯示「不指定（通知負責人）」

## 3. 傳送素材從素材庫挑選（A04）

- [x] 3.1 測試 `apps/web/tests/unit/components/automation/action-editor.test.tsx`：「從清單選素材」「已存的素材被停用」「沒有素材檢視權限」，先確認失敗
- [x] 3.2 契約新增參數型別 `material`，`send_material.materialId` 改用它；`ActionEditor` 新增素材下拉

## 4. 不合契約的規則不可啟用（A02）

- [x] 4.1 測試 `apps/api/tests/unit/modules/automation/rule-activation.test.ts`：「開啟含未知動作的規則」先確認失敗；「停用不合契約的規則」「開啟合法的規則」以 mutation 驗證（把「改為啟用」條件改成「有送 isActive」時，「停用不合契約的規則」失敗）
- [x] 4.2 `updateRule` 在改為啟用時驗證儲存後的契約
- [x] 4.3 測試 `apps/web/tests/unit/lib/automation/rule-actions.test.ts`：「舊規則的觸發事件」先確認失敗；編輯器加上未知觸發事件選項與提示
- [x] 4.4 資料腳本 `scripts/disable-invalid-automation-rules.mjs`：預設 dry-run，`--apply` 才寫入；只停用啟用中但不合契約的規則，保留內容；可重複執行

## 5. 完成檢查

- [ ] 5.1 `pnpm test` 通過
- [ ] 5.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [ ] 5.3 `CHANGELOG.md` 補 Fixed
- [ ] 5.4 `node scripts/validate-openspec.mjs fix-automation-rule-gaps` 通過
- [ ] 5.5 部署後在 UAT 先以 dry-run 執行資料腳本、確認清單後加 `--apply`
