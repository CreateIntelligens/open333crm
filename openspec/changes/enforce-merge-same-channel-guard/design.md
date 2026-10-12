## Context

`mergeContacts()`（`apps/api/src/modules/contact/contact-merge.service.ts`）是所有合併的唯一引擎，在呼叫端的交易內執行。它以條件式更新鎖定雙方：被合併方 `isArchived false → true`，survivor 碰一下 `updatedAt`。鎖定依 id 排序，避免死結。交易隔離層級是 Postgres 預設的 read committed。

## Decisions

### D1. 同渠道檢查放在引擎內、鎖定之後

兩個合併同時併入同一位 survivor 時，兩者都要鎖 survivor 的列。後取得鎖的交易在前一個提交之後才繼續，read committed 下它接下來的查詢看得到前一個交易已搬過來的渠道身分。所以檢查只要放在鎖定之後、搬移之前，就能擋下並行的情況。

放在引擎內，4 個入口都套用，之後新增的入口也不會漏掉。

### D2. 錯誤格式

`AppError('兩位聯絡人在同一個渠道（{渠道名稱}）都有帳號，合併後回覆會送錯人，無法合併', 'SAME_CHANNEL_CONFLICT', 409, { channels: [{ id, displayName, channelType }] })`。

渠道名稱給客服看哪一個渠道衝突。呼叫者都有 `contact.merge` 或 `identity.review` 權限，名稱不是個資。

### D3. 客人觸發的入口

合併前的檢查（`hasSharedChannel()`）保留：它在合併前回覆客人，綁定代碼還要放回代碼。引擎丟出 `SAME_CHANNEL_CONFLICT` 時，兩個入口比照合併前檢查不通過的處理：

- 綁定代碼：放回代碼（不放回待確認狀態，因為再確認一次也會被拒絕），回覆 `channelConflict`，回傳 `channel_conflict`。
- email 登記：不寫入 email，回覆 `channelConflict`，回傳 `channel_conflict`。

`inTransaction()` 已在交易內時直接執行，不開 savepoint，引擎丟錯時不會回滾任何寫入。所以引擎拒絕前要自己還原鎖定時封存的被合併方（實作時發現，見 tasks.md 5.6），呼叫端接住錯誤後交易才能照常提交、送出回覆訊息。合併是 `inTransaction()` 裡第一個寫入，後面的 `identityMap.upsert` 不會執行。

### D4. email 鎖

`SELECT pg_advisory_xact_lock(hashtextextended('email-registration:{tenantId}:{email}', 0))`。email 已由 `normalizeEmail()` 去空白並轉小寫。鎖在交易結束時自動釋放。公開登記路由整段在 `withTenant` 交易內執行，所以鎖會持有到合併完成。

`hashtextextended` 是 64 位元雜湊，碰撞時只會讓兩個不相關的登記依序執行，不影響正確性。

### D5. 不處理既有資料

UAT 已經存在的同渠道雙身分聯絡人，本 change 不處理。之後要加 `channel_identities` 的 `(contactId, channelId)` 唯一限制時再查。

### D6. 同一個 email 的鎖會讓兩個登記在合併前檢查就分出結果

兩個登記送出同一個 email 時，後一個被 email 鎖擋住，等前一個提交後才做合併前的檢查，所以由合併前的檢查回覆，不會走到 D3 的引擎拒絕。D3 的情況來自其他併入同一位聯絡人的合併（綁定代碼、客服手動合併、不同 email 的登記）。測試「合併時才發現同一渠道」因此以客服手動合併當作另一個合併。

## Risks

- 客服手動合併多一種被拒絕的情況。視窗會顯示原因，客服知道是哪個渠道。
- 測試 `解除：雙方在同一渠道都有身分…不搬 survivor 自己的新對話` 原本以引擎建立同渠道雙身分。引擎改為拒絕之後，這個情境只能以直接寫資料的方式準備（代表本 change 之前就存在的資料），測試要改準備方式，斷言不變。
