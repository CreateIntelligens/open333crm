## 1. LINE 外掛：flex 與不認得的類型

- [x] 1.1 在 `packages/channel-plugins/tests/unit/line/line-flex-message.test.ts`（新增）寫 Scenario「Flex message sent」（三個測試：原樣送出 altText／contents、不送內部欄位、舊資料 flexJson）、「Flex 訊息缺少 altText」、「不認得的訊息類型」（主訊息與附加訊息各一）的測試。執行測試，確認 6 個在 assertion 失敗（修正前得到 `{"type":"text","text":""}`）
- [x] 1.2 同一檔案寫 Scenario「Text message sent」的測試（`text` 與 `quick_reply`）。現有程式靠 `default` 已有此行為，測試直接通過；以 1.3 的修改為突變驗證：只把 `default` 改成丟錯、不加 `text`／`quick_reply` 分支時，此測試必須失敗
- [x] 1.3 修改 `packages/channel-plugins/src/line/index.ts`：新增 `LineMessageBuildError`；`buildLineMessage()` 加 `text`、`quick_reply`、`flex` 分支，`default` 改為丟 `LineMessageBuildError`；`sendMessage()` 接住後回 `{ success: false, error }` 且不呼叫 LINE。從套件入口匯出 `LineMessageBuildError`。執行 1.1、1.2 的測試，確認通過

## 2. 滿意度問卷：送出結果與失敗紀錄

- [x] 2.1 在 `apps/api/tests/unit/modules/csat/csat-delivery.test.ts`（新增）寫 Scenario「LINE 客人收到的問卷是 Flex 訊息」與「問卷送出失敗時客服看得到」的 LINE 拒收、找不到客人的 LINE 帳號、其他渠道送不出三個測試；LINE 外掛用真的 `linePlugin`，只替換 `fetch` 與憑證解密。在 1.3 之前執行，4 個都在 assertion 失敗；1.3 之後 Flex 測試通過，其餘 3 個仍在 assertion 失敗
- [x] 2.2 修改 `apps/api/src/modules/csat/csat.service.ts`：`sendCsatSurvey()` 檢查 LINE 外掛的 `success` 與 `deliverToChannel()` 的回傳值，算出失敗原因；新增 `recordCsatDeliveryFailure(ctx: TenantCtx, …)` 寫入訊息 `metadata.deliveryFailed`／`deliveryError` 與 `csat_send_failed` 事件；再推一次 `message.new`。不還原 `csatSentAt`。執行 2.1 的測試，確認通過
- [x] 2.3 更新 `apps/api/tests/unit/modules/csat/csat.service.test.ts` 的 Scenario「送到客人的渠道失敗」：mock 補 `message.update`、`caseEvent.create`，並斷言寫入失敗紀錄（本 change 修改了這個情境）
- [x] 2.4 在 `apps/web/tests/unit/components/inbox/csat-message-delivery.test.tsx`（新增）寫 Scenario「問卷送出失敗時客服看得到：卡片顯示沒有送出與原因」的兩個測試，修改 `CsatMessage.tsx`、`ChatWindow.tsx` 傳入並顯示 `deliveryError`；`CaseTimeline.tsx` 顯示 `csat_send_failed`。突變驗證：把卡片的提示條件改成 `false`，第一個測試失敗，再還原

## 3. 文件

- [x] 3.1 更新 `docs/ref/features/tenant/CASES.md`、`docs/ref/features/tenant/INBOX.md`、`docs/ref/features/health/LINE.md`、`docs/ref/features/health/README.md`、`docs/ref/features/feature-map.json`、`.claude/skills/feature-cases/SKILL.md`、`.claude/skills/feature-line/SKILL.md`
- [x] 3.2 `CHANGELOG.md`、`docs/ref/system/AUDIT.md`（CASE-03）與 `docs/ref/system/AUDIT-REVIEWS.md` 的文字由維護者依回報內容更新（本次委派範圍不直接修改這三個檔案）

## 4. 完成前檢查

- [x] 4.1 `pnpm --filter @open333crm/channel-plugins test`、`pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/workers test`、web 相關測試通過
- [x] 4.2 `tests/feature/modules/csat/` 通過
- [x] 4.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 通過
- [x] 4.4 `node scripts/validate-openspec.mjs fix-csat-line-flex-416` 通過
