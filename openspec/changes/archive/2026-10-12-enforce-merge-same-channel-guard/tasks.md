## 1. 合併引擎拒絕同渠道雙身分（contact-management）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/contact/contact-merge.test.ts` 新增「Contacts on different channels」與引擎層的同渠道拒絕（409 `SAME_CHANNEL_CONFLICT`、`details.channels`、不封存、不寫合併紀錄）；確認同渠道案例在現行程式失敗
- [x] 1.2 既有測試 `解除：雙方在同一渠道都有身分（手動合併不擋）時，不搬 survivor 自己的新對話` 改以直接寫資料準備同渠道雙身分（代表本 change 之前就存在的資料），斷言不變（design Risks）
- [x] 1.3 實作：`mergeContacts()` 鎖定雙方之後、搬移之前檢查同渠道（design D1、D2）
- [x] 1.4 測試先行：`apps/api/tests/feature/modules/contact/contact-merge-same-channel.test.ts`「Agent merges two contacts on the same LINE channel」（`POST /api/v1/contacts/merge` 回 409）與「Approving a suggestion for two contacts on the same channel」（建議維持 `PENDING`）。1.3 之後這兩個入口不需改程式，以突變驗證：拿掉 1.3 的檢查，兩案例須失敗
- [x] 1.5 測試先行：同一檔「Two merges into the same survivor at the same time」，兩個獨立交易同時把 A1、A2 併入 B（真實 Postgres，資料加標記、`afterAll` 刪除）；確認在 1.3 之前失敗或以突變驗證

## 2. email 登記（email-identity-merge）

- [x] 2.1 測試先行：`apps/api/tests/feature/modules/identity-binding/email-registration-concurrency.test.ts`（並行要各自提交的交易，不能放進以 rollback 隔離的 `email-registration.test.ts`）「合併時才發現同一渠道」：同一 LINE 渠道的兩位聯絡人同時登記 B 的 email，一位合併、另一位結果為 `channel_conflict`、email 不變、收到說明
- [x] 2.2 實作：`submitEmailRegistration()` 接住 `SAME_CHANNEL_CONFLICT`，比照合併前檢查回覆（design D3）
- [x] 2.3 測試先行：同一檔「兩位聯絡人同時登記同一個新的 email」與「不同 email 不互相等待」
- [x] 2.4 實作：查詢之前取得以租戶與 email 為 key 的 `pg_advisory_xact_lock`（design D4）

## 3. 綁定代碼（cross-channel-binding-code）

- [x] 3.1 測試先行：`apps/api/tests/feature/modules/identity-binding/identity-binding-concurrency.test.ts`（理由同 2.1）「確認時另一個綁定剛完成」
- [x] 3.2 實作：`confirmBinding()` 接住 `SAME_CHANNEL_CONFLICT`：放回代碼、不恢復待確認、回覆 `channelConflict`、回傳 `channel_conflict`（design D3）

## 4. 前端

- [x] 4.1 測試先行：`apps/web/tests/unit/components/contact/contact-merge-modal.test.tsx`「Merge window shows the reason」：合併回 409 時視窗顯示 API 的訊息並維持開啟
- [x] 4.2 實作：`ContactMergeModal.tsx` 以 `getApiErrorMessage()` 取錯誤訊息（預覽與合併兩處）

## 5. 文件與完成檢查

- [x] 5.1 `docs/ref/system/AUDIT.md`：IDENT-03 改為部分修正（修正前合併產生的資料與資料庫限制未處理），IDENT-04 移除；`AUDIT-REVIEWS.md` 新增複查紀錄；`docs/ref/features/tenant/CONTACTS.md` 的「目前的限制」更新 IDENT-03、移除 IDENT-04，合併與 email 登記段落補上同渠道拒絕與依序處理
- [x] 5.2 `CHANGELOG.md` 新增 Fixed 條目（`## [YYYY-MM-DD]`）
- [x] 5.3 `pnpm test`、`pnpm test:feature` 通過
- [x] 5.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 5.5 `node scripts/validate-openspec.mjs enforce-merge-same-channel-guard` 通過
- [x] 5.6 突變驗證紀錄（測試寫在程式之後的案例，列出突變與結果）

| 測試 | 突變 | 結果 |
| --- | --- | --- |
| `contact-merge-same-channel.test.ts` 三個案例（1.4、1.5） | 註解掉 `mergeContacts()` 的 `assertNoSharedChannel()` | 三個都失敗 |
| `contact-merge-same-channel.test.ts`「Two merges into the same survivor at the same time」 | 把 `assertNoSharedChannel()` 移到鎖定之前 | 失敗（連跑三次），其他兩個通過：確認檢查必須在鎖定之後 |
| `email-registration-concurrency.test.ts`「不同 email 不互相等待」 | 鎖的 key 拿掉 email（只剩租戶） | 失敗 |
| `email-registration-concurrency.test.ts`「兩位聯絡人同時登記同一個新的 email」 | 拿掉 `pg_advisory_xact_lock` | 失敗 |
| `email-registration-concurrency.test.ts`「合併時才發現同一渠道」（code review 後改寫） | 拿掉 `registerEmail()` 接住 `SAME_CHANNEL_CONFLICT` 的分支 | 失敗 |
| `identity-binding-concurrency.test.ts`「確認時另一個綁定剛完成」 | 停用 `confirmBinding()` 接住 `SAME_CHANNEL_CONFLICT` 的分支 | 失敗 |
| `identity-binding-concurrency.test.ts`「確認時另一個綁定剛完成」 | 不放回代碼 | 失敗（`代碼仍可兌換`） |

其餘案例寫在實作之前，並確認在實作前因斷言失敗：1.1（`Missing expected rejection`）、引擎拒絕時還原被合併方（`被合併方不可留在封存狀態`）、2.1 與 3.1（`後送出／後確認的一方不可丟錯`）、2.3（`B 應併入 A`）、4.1（找不到 API 訊息，只顯示「合併失敗」）。

實作 2.2 時發現：`inTransaction()` 已在交易內時不開 savepoint，引擎在鎖定後拒絕時，被合併方已被標為封存，email 登記接住錯誤後交易照常提交會留下錯誤的封存。改為引擎拒絕前自己還原被合併方，並在 `contact-merge.test.ts` 加上斷言（先失敗後通過）。

Code review 修正：原本的「合併時才發現同一渠道」以兩個同 email 的登記並行。2.4 加上 email 鎖之後，後一個登記被鎖擋住，改由合併前的檢查回覆，接住引擎拒絕的分支沒有被測到（拿掉也會通過）。改為以客服手動合併當另一個合併（design D6），並補上上表的突變驗證。綁定代碼的並行測試補上「代碼仍可兌換」的斷言。PR Agent 指出固定等待無法保證交易 2 已走到鎖（機器慢時會走合併前檢查而照樣通過）：改用 `tests/support/wait-for-lock-wait.ts`，以 `pg_blocking_pids()` 確認有連線被交易 1 擋住才放開交易 1（只看「有連線在等鎖」會被不相關的等待誤判），等不到就丟錯，並在 `finally` 放開交易 1。改完重做上表的拿掉接住分支（email、綁定）與拿掉 email 鎖三項突變，皆失敗（拿掉 email 鎖時以「沒有連線被 pid … 擋住」失敗，交易 1 仍被放開、測試正常結束）。
