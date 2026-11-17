## 1. 測試

程式的行為已經在 commit `248010df`（#337 階段 4 第七批）完成，所以測試不能先失敗。每個測試改以突變驗證（AGENTS.md「When a test passes as soon as you write it」）。

- [x] 1.1 `apps/api/tests/feature/modules/notification/notification-recipient.test.ts`：「交易 rollback 時，通知與推播都作廢」。突變：`createAndDispatch()` 不經 `notifyAgent()`，直接 `io.to().emit()`，這個測試失敗。
- [x] 1.2 同一個檔案：「推播送到帶租戶 ID 的成員房間，內容是寫入的通知」；「createAndDispatch 的收件成員已被永久刪除」「已停用」「啟用中」的房間改成 `tenant:<租戶 ID>:agent:<成員 ID>`。
- [x] 1.3 `apps/api/tests/feature/modules/comment-reply/comment-reply-admin-notify.test.ts`：「留言私訊健康告警只通知該租戶啟用中的管理員」。突變：找管理員時拿掉 `role: 'ADMIN'` 條件，這個測試失敗。拿掉 `tenantId` 條件時測試仍然通過，因為通知的條件寫入只寫給同租戶的成員，是第二道防護。

## 2. 完成條件

- [x] 2.1 `pnpm test` 通過。
- [x] 2.2 `pnpm test:feature` 通過。
- [x] 2.3 `node scripts/validate-openspec.mjs document-api-notification-writers` 通過。
- [x] 2.4 `node scripts/validate-openspec.mjs --specs` 通過。
- [x] 2.5 只改規格，不需要 `CHANGELOG.md` 條目。程式的改動已經寫在第七批的條目。
- [x] 2.6 PR #535 合併後，以 `pnpm exec openspec archive document-api-notification-writers` 歸檔。
