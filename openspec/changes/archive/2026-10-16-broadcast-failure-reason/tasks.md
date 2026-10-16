## 1. 資料欄位

- [x] 1.1 `Broadcast` 加 `failureReason String?`，產正式 migration

## 2. 記錄失敗原因（Broadcast Failure Reason Is Recorded）

- [x] 2.1 測試先行：`apps/api/tests/unit/modules/marketing/broadcast-failure-reason.test.ts`「Scheduled broadcast with an empty audience」「Unexpected error during a send」「Every recipient fails」「Some recipients fail」
- [x] 2.2 實作（「Some recipients fail」寫好即通過：欄位原本就是 null。mutation：把最後狀態的 failureReason 改成一律寫入，此測試與重送測試都失敗，已還原）：`executeBroadcast()` 外層 catch 寫入原因；全部收件人失敗時寫入人數與第一個渠道錯誤；沒有 plugin 的錯誤訊息改中文

## 3. 重送時清空原因（Failure Reason Is Cleared When A Broadcast Is Sent Again）

- [x] 3.1 測試先行：`broadcast-failure-reason.test.ts`「Resend a failed broadcast successfully」
- [x] 3.2 實作：搶占 `sending` 的更新同時設 `failureReason: null`

## 4. 畫面顯示與重送（Failed Broadcasts Show The Reason And Can Be Resent Or Cancelled）

- [x] 4.1 測試先行：`apps/web/tests/unit/app/dashboard/marketing/broadcast-tab.test.tsx`「Failed broadcast in the list」「Old failed broadcast without a reason」「Cancel a failed broadcast」
- [x] 4.2 實作（另加「成功的廣播不顯示失敗原因」；mutation：失敗原因改成所有狀態都顯示，此測試失敗，已還原；活動詳情另有 `campaign-detail-failure-reason.test.tsx`）：廣播列表在「失敗」徽章下方顯示原因、失敗的廣播顯示「重新發送」與「取消」；活動詳情的廣播表格顯示原因

## 5. 完成定義

- [x] 5.1 `pnpm test`、相關 feature 測試、`check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`
- [x] 5.2 CHANGELOG、`node scripts/validate-openspec.mjs broadcast-failure-reason`

## 6. Review（PR #296）

- [x] 6.1 取消按鈕補 `aria-label`、請求期間停用（含重新發送），測試「確認視窗按取消就不送出」「請求進行中按鈕停用…完成後重新載入列表」；前者寫好即通過（`handleCancel` 原本就有 confirm），mutation：拿掉 confirm 後此測試失敗，已還原
