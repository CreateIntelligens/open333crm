## 1. IG 段落請顧客送出代碼

- [x] 1.1 測試 `identity-binding-unit.test.ts`「IG 連結說明請顧客送出代碼」，在現有程式上斷言失敗
- [x] 1.2 `buildInviteText()` 的 IG 段落改成「開啟後請傳送這組代碼：{代碼}」

## 2. 完成定義

- [x] 2.1 `pnpm --filter @open333crm/api test`
- [x] 2.2 api tsc
- [x] 2.3 `node scripts/validate-openspec.mjs fix-ig-binding-invite-text`
- [x] 2.4 `CHANGELOG.md` Fixed 加條目
