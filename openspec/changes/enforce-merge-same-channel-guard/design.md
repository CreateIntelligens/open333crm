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

email 登記的合併在 `inTransaction()` 的子交易內（savepoint），引擎丟錯時只回滾子交易，外層的 `withTenant` 交易還能繼續送出回覆訊息。實作時要確認這一點，否則改在外層處理。

### D4. email 鎖

`SELECT pg_advisory_xact_lock(hashtextextended($tenantId || ':' || lower($email), 0))`。鎖在交易結束時自動釋放。公開登記路由整段在 `withTenant` 交易內執行，所以鎖會持有到合併完成。

`hashtextextended` 是 64 位元雜湊，碰撞時只會讓兩個不相關的登記依序執行，不影響正確性。

### D5. 不處理既有資料

UAT 已經存在的同渠道雙身分聯絡人，本 change 不處理。之後要加唯一限制（IDENT-03 做法 B）時再查。

## Risks

- 客服手動合併多一種被拒絕的情況。視窗會顯示原因，客服知道是哪個渠道。
- 測試 `解除：雙方在同一渠道都有身分（手動合併不擋）時，不搬 survivor 自己的新對話` 以引擎建立同渠道雙身分。引擎改為拒絕之後，這個情境只能以直接寫資料的方式準備（代表本 change 之前就存在的資料），測試要改準備方式，斷言不變。
