## 1. 追蹤設定（G06）

- [x] 1.1 測試 `apps/api/tests/unit/modules/settings/tracking-settings.test.ts`：「合格的 ID 可以儲存」「含程式碼的 GA ID 被拒」「非數字的 Pixel ID 被拒」「空字串清除設定」，先確認失敗
- [x] 1.2 測試 `apps/api/tests/unit/modules/shortlink/tracking-snippet.test.ts`：「舊資料裡不合格的 ID 不輸出」「合格的 ID 照常輸出」，先確認失敗
- [x] 1.3 `trackingSettingsSchema` 加格式驗證；查詢移到 `tracking-settings.service.ts`；`tracking-snippet.ts` 輸出前驗證並跳脫；前端顯示後端的錯誤
- [x] 1.4 測試 `apps/api/tests/feature/modules/settings/tracking-settings-route.test.ts`：走真實路由驗證 5 個 Scenario：3 種格式不符回 400 `VALIDATION_ERROR` 且已儲存的設定不變，合格的 ID 與空字串照常寫入。突變：路由改成不呼叫 `trackingSettingsSchema.parse`，除了「合格的 ID 可以儲存」之外的 4 個測試都失敗
- [x] 1.5 測試「含小寫字母的 GA ID 被拒」「舊資料裡含小寫字母的 GA ID 不輸出」，先確認失敗；`GA4_ID_PATTERN` 拿掉 `/i`

## 2. 營業時間（G07）

- [x] 2.1 測試 `apps/web/tests/unit/components/settings/office-hours-settings.test.tsx`：「讀取失敗時停用儲存」「重新載入成功後可以儲存」，先確認失敗
- [x] 2.2 `OfficeHoursSettings.tsx` 讀取失敗時顯示錯誤與重新載入，不顯示表單

## 3. 渠道管理（G03、G04、G08、G15）

- [x] 3.1 測試 `apps/api/tests/unit/modules/channel/webhook-base-url.test.ts`：「https 網址可以套用」「http 網址被拒」「帶查詢字串的網址被拒」，先確認失敗
- [x] 3.2 測試 `apps/web/tests/unit/components/settings/channel-management.test.tsx`：「取消確認時不送出」「確認後送出」「停用的 FB 渠道不查詢」「從卡片停用渠道」，先確認失敗
- [x] 3.3 webhook 公開網址：後端 schema 驗證；前端確認與說明文字
- [x] 3.4 測試 `apps/api/tests/unit/modules/channel/fb-token-status-readonly.test.ts`：「查詢 FB 權杖狀態不更新最後驗證」，先確認失敗
- [x] 3.5 `checkFbTokenStatus` 不寫入；前端只查啟用中的 FB 渠道
- [x] 3.6 測試 `apps/api/tests/unit/modules/channel/bot-config-validation.test.ts`：「範圍內的值可以儲存」「超出範圍的值被拒」，先確認失敗
- [x] 3.7 `updateChannelSchema`／`createChannelSchema` 驗證 `maxBotReplies`
- [x] 3.8 測試 `apps/api/tests/unit/modules/channel/channel-delete-in-use.test.ts`：「收過對話的渠道刪除被拒」，先確認失敗
- [x] 3.9 `deleteChannel` 把外鍵錯誤轉成 409 `CHANNEL_IN_USE`；卡片加停用／啟用按鈕

## 4. 人員與角色（G17、G18）

- [x] 4.1 測試 `apps/api/tests/feature/modules/agent/agent-management.test.ts`：「管理員看得到停用的成員」「重新啟用後可以登入」（isActive 回到 true、原密碼可用、角色不變）；`apps/api/tests/unit/modules/agent/agent-reactivate.test.ts`：「重新啟用受方案人數上限限制」，先確認失敗
- [x] 4.2 測試 `apps/api/tests/feature/modules/agent/agent-management.test.ts`：「重新啟用需權限」（斷言 `error.details.requiredPermission` 是 `agent.deactivate`），先確認失敗；前端 `apps/web/tests/unit/components/settings/agent-management.test.tsx`
- [x] 4.3 新增 `listInactiveAgents`、`reactivateAgent` 與兩條路由；人員管理頁列出停用的成員與重新啟用
- [x] 4.4 測試 `apps/api/tests/feature/modules/role/role-management.test.ts`：「停用的成員佔用角色時列出姓名」，先確認失敗；前端 `role-permission-matrix.test.tsx` 顯示後端訊息（原本讀錯欄位）
- [x] 4.5 `deleteRole` 回應列出佔用的成員

## 5. 側邊選單（G09、A06）

- [x] 5.1 測試 `apps/web/tests/unit/components/layout/sidebar.test.tsx`：「只有個人報表權限時顯示我的績效」「沒有設定權限時隱藏 AI 設定」，先確認失敗
- [x] 5.2 `Sidebar.tsx` 調整報表與 AI 設定的權限

## 6. SLA 政策（G20）

- [x] 6.1 測試 `apps/api/tests/unit/modules/case/case-sla-default.test.ts`：「同優先級有多條政策時套用預設」「沒有預設政策時套用最早建立的」，先確認失敗
- [x] 6.2 測試 `apps/api/tests/unit/modules/sla/sla-policy.service.test.ts`：「建立同名政策被拒」「改名後舊工單記錄新名稱」「有未結案工單的政策不能刪除」「只有已結案工單的政策可以刪除」，先確認失敗
- [x] 6.3 `createCaseRecord` 與 workers `create_case` 依預設排序；新增 `sla.service.ts`，路由改呼叫服務；SLA 頁顯示刪除被擋的原因（`sla-management.test.tsx`）

## 7. 報表匯出（G12）

- [x] 7.1 測試 `apps/api/tests/unit/modules/analytics/export-csv-bom.test.ts`：「CSV 以 BOM 開頭」，先確認失敗
- [x] 7.2 測試 `apps/web/tests/unit/app/dashboard/analytics-export.test.tsx`：「沒有匯出權限時不顯示按鈕」「匯出失敗時顯示錯誤」，先確認失敗
- [x] 7.3 `exportCsv` 加 BOM；報表頁依權限顯示按鈕並顯示錯誤

## 8. 完成檢查

- [x] 8.1 `pnpm test` 通過
- [x] 8.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 8.3 `CHANGELOG.md` 補 Fixed／Changed
- [x] 8.4 更新 `docs/ref/system/AUDIT.md` 的 AUTH-09、SLA-03、SLA-04、CHAN-01，並在 `AUDIT-REVIEWS.md` 加紀錄
- [x] 8.5 `node scripts/validate-openspec.mjs fix-admin-settings-safeguards` 與 `--specs` 通過
- [x] 8.6 PR 合併後以 `pnpm exec openspec archive fix-admin-settings-safeguards` 歸檔，並替新的主規格（`tracking-settings`、`channel-management`、`sla-policy-selection`、`office-hours-settings`）寫 `## Purpose`
