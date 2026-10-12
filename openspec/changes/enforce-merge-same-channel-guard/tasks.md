## 1. 合併引擎拒絕同渠道雙身分（contact-management）

- [ ] 1.1 測試先行：`apps/api/tests/unit/modules/contact/contact-merge.test.ts` 新增「Contacts on different channels」與引擎層的同渠道拒絕（409 `SAME_CHANNEL_CONFLICT`、`details.channels`、不封存、不寫合併紀錄）；確認同渠道案例在現行程式失敗
- [ ] 1.2 既有測試 `解除：雙方在同一渠道都有身分（手動合併不擋）時，不搬 survivor 自己的新對話` 改以直接寫資料準備同渠道雙身分（代表本 change 之前就存在的資料），斷言不變（design Risks）
- [ ] 1.3 實作：`mergeContacts()` 鎖定雙方之後、搬移之前檢查同渠道（design D1、D2）
- [ ] 1.4 測試先行：`apps/api/tests/feature/modules/contact/contact-merge-same-channel.test.ts`「Agent merges two contacts on the same LINE channel」（`POST /api/v1/contacts/merge` 回 409）與「Approving a suggestion for two contacts on the same channel」（建議維持 `PENDING`）。1.3 之後這兩個入口不需改程式，以突變驗證：拿掉 1.3 的檢查，兩案例須失敗
- [ ] 1.5 測試先行：同一檔「Two merges into the same survivor at the same time」，兩個獨立交易同時把 A1、A2 併入 B（真實 Postgres，資料加標記、`afterAll` 刪除）；確認在 1.3 之前失敗或以突變驗證

## 2. email 登記（email-identity-merge）

- [ ] 2.1 測試先行：`apps/api/tests/feature/modules/identity-binding/email-registration.test.ts`「合併時才發現同一渠道」：同一 LINE 渠道的兩位聯絡人同時登記 B 的 email，一位合併、另一位結果為 `channel_conflict`、email 不變、收到說明
- [ ] 2.2 實作：`submitEmailRegistration()` 接住 `SAME_CHANNEL_CONFLICT`，比照合併前檢查回覆（design D3）
- [ ] 2.3 測試先行：同一檔「兩位聯絡人同時登記同一個新的 email」與「不同 email 不互相等待」
- [ ] 2.4 實作：查詢之前取得以租戶與 email 為 key 的 `pg_advisory_xact_lock`（design D4）

## 3. 綁定代碼（cross-channel-binding-code）

- [ ] 3.1 測試先行：`apps/api/tests/feature/modules/identity-binding/identity-binding.test.ts`「確認時另一個綁定剛完成」
- [ ] 3.2 實作：`confirmBinding()` 接住 `SAME_CHANNEL_CONFLICT`：放回代碼、不恢復待確認、回覆 `channelConflict`、回傳 `channel_conflict`（design D3）

## 4. 前端

- [ ] 4.1 測試先行：`apps/web/tests/unit/components/contact/ContactMergeModal.test.tsx`「Merge window shows the reason」：合併回 409 時視窗顯示 API 的訊息並維持開啟
- [ ] 4.2 實作：`ContactMergeModal.tsx` 以 `getApiErrorMessage()` 取錯誤訊息（預覽與合併兩處）

## 5. 文件與完成檢查

- [ ] 5.1 `docs/ref/system/AUDIT.md`：IDENT-03、IDENT-04 改為已修正；`AUDIT-REVIEWS.md` 新增複查紀錄；`docs/ref/features/tenant/CONTACTS.md` 的「目前的限制」移除這兩列，合併段落補上同渠道拒絕
- [ ] 5.2 `CHANGELOG.md` 新增 Fixed 條目（`## [YYYY-MM-DD]`）
- [ ] 5.3 `pnpm test`、`pnpm test:feature` 通過
- [ ] 5.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [ ] 5.5 `node scripts/validate-openspec.mjs enforce-merge-same-channel-guard` 通過
- [ ] 5.6 突變驗證紀錄（測試寫在程式之後的案例，列出突變與結果）

| 測試 | 突變 | 結果 |
| --- | --- | --- |
