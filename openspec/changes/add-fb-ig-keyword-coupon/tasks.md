## 1. 修正：列表在切換或存檔後立即更新（bug fix，先重現）

- [x] 1.1 測試 `apps/web/tests/unit/hooks/use-keyword-replies.test.tsx`：「停用後列表顯示停用」「存檔後列表顯示新的關鍵字」，在現有程式上斷言失敗
- [x] 1.2 `useKeywordReplies` 的 `mutate` 同時重新載入規則列表與明細；`isActive`、名稱、觸發設定以列表的值為準（design D6）

## 2. 規則的渠道（hook）

- [x] 2.1 測試 `use-keyword-replies.test.tsx`：「建立時選 Facebook」（條件 FB）、「Instagram 的關鍵字回覆只發券」（條件 THREADS）、「從清單選券」（LINE 條件）、
      「編輯 Facebook 的關鍵字回覆」「沒有渠道條件的舊規則」「沒有渠道條件、傳送 Facebook 素材的舊規則」「渠道條件這頁無法辨識」
      「傳送 Facebook 素材的規則不能在這頁存檔」（規則限定 LINE、素材是 FB）、「列表顯示每條規則的渠道」（hook 讀出渠道）
- [x] 2.2 `KeywordReply` 加上 `channel`、`channelIssue`、素材查詢結果；`KeywordReplyInput` 加上 `channel`；條件與素材防線依渠道（design D2、D4、D5）

## 3. 表單與列表

- [x] 3.1 測試 `apps/web/tests/unit/components/line/keyword-reply-edit-dialog.test.tsx`：「建立時選 Facebook」（素材只列 FB）、「Instagram 的關鍵字回覆只發券」（素材選單停用）、
      「已有渠道的規則不能改渠道」「沒有渠道條件的舊規則」（說明文字）、「傳送 Facebook 素材的規則不能在這頁存檔」（新訊息）、「渠道條件這頁無法辨識」
- [x] 3.2 `KeywordReplyEditDialog` 加渠道選擇、依渠道列素材、顯示不能更改的渠道與說明
- [x] 3.3 測試 `apps/web/tests/unit/components/line/keyword-reply-material-cell.test.tsx`：「傳送 Facebook 素材的規則不能在這頁存檔」的列表標示（與規則渠道不符）
- [x] 3.4 `KeywordReplyMaterialCell` 依新的原因顯示
- [x] 3.5 測試 `apps/web/tests/unit/app/dashboard/line/keyword-replies-page.test.tsx`：「列表顯示每條規則的渠道」（不出現 THREADS）、「依渠道篩選」、「停用後列表顯示停用」（頁面按開關後重新載入）
- [x] 3.6 頁面改名「關鍵字回覆」、渠道欄與篩選、說明改寫；側欄選單改名（design D1）

## 4. 自動化規則編輯器的對話渠道選項

- [x] 4.1 測試 `packages/automation/tests/unit/contracts/facts.test.ts`：「條件選單有 Instagram」
- [x] 4.2 `AUTOMATION_FACT_DEFINITIONS` 的對話渠道選項加上 `THREADS`／Instagram（design D7）

## 5. FB／IG 端到端（行為已存在，以突變驗證）

- [x] 5.1 測試 `apps/workers/tests/unit/lib/automation-issue-coupon-channels.test.ts`：「Facebook 的關鍵字回覆發券」「Instagram 的關鍵字回覆只發券」（顧客收到發券訊息、券確認、發放方式為關鍵字）、
      「Facebook 顧客已達上限時回覆設定的文字」。突變：從 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 拿掉 `FB`／`THREADS`，測試必須失敗，再還原
- [x] 5.2 測試 `apps/workers/tests/unit/handlers/automation-keyword-scope.test.ts`：「Facebook 的關鍵字回覆發券」「Instagram 的關鍵字回覆只發券」（條件只在所選渠道成立）
- [x] 5.3 突變紀錄：
      - `packages/channel-plugins/src/index.ts` 的 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 改成只有 `['LINE']`：5.1 的 3 個測試全部失敗；還原後通過
      - `packages/automation/src/automation-facts.ts` 的 `conversation.channelType` 只在 LINE 時給值：5.2 的 2 個測試失敗；還原後通過
      - 頁面 `handleToggle` 拿掉 `await mutate()`：3.5「停用後列表顯示停用」失敗；還原後通過
      - 1.1 的兩個測試在修正前的程式上斷言失敗（啟用狀態停在 true、關鍵字停在舊值）；修正有兩道（重新載入明細、以列表值為準），任一道都能讓測試通過

## 6. 文件與完成定義

- [x] 6.1 `docs/ref/features/tenant/AUTOMATION.md`、`docs/ref/features/tenant/LINE.md` 改寫關鍵字回覆的渠道行為
- [x] 6.2 `CHANGELOG.md` 的 `## [2026-10-27]` 加條目
- [x] 6.3 `pnpm --filter @open333crm/web test`、`@open333crm/api`、`@open333crm/workers`、`@open333crm/channel-plugins`、`@open333crm/automation` unit 全過
- [x] 6.4 api、web、workers 三種 `tsc --noEmit`；`pnpm --filter @open333crm/web build`
- [x] 6.5 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict`
- [x] 6.6 `node scripts/validate-openspec.mjs add-fb-ig-keyword-coupon`
- [ ] 6.7 歸檔順序：`add-coupon-system` 歸檔後才歸檔本 change（proposal「與 add-coupon-system 的歸檔順序」）
