## Why

#337 階段 3 第六批把 `portal` 模組改成入口開交易（AGENTS.md 結構規則 2）。粉絲活動與積分沒有主規格，下列規則只寫在程式與 `docs/ref/features/tenant/PORTAL.md`，沒有 Scenario 可以對照測試：

- 送出活動時，作答、積分與 `portal.activity.submitted` 事件是否一起成立。搬遷前，事件以 `eventBus.publish()` 在 commit 之前送出：交易 rollback 時事件照樣送出，行程在送出之前結束時事件遺失。
- 不允許重複參加的活動，每位粉絲只能留下一筆作答。
- 積分帳本的餘額不能算錯。
- 後台只能調整本租戶聯絡人的積分。搬遷前不檢查：外鍵檢查不受 RLS 限制，其他租戶的聯絡人也寫得進去。
- 抽獎不能重複抽出同一份作答。
- 只有草稿能編輯與刪除，已發布的活動不能封存。

搬遷時盤點發現，這些規則在同時操作時都不成立。每個寫入都是先讀、再寫，沒有鎖，同時進來的請求都會通過檢查：

- 同一位粉絲同時送出兩次，兩次都成功，積分給兩次。
- 同時寫同一位聯絡人的積分，兩筆都以同一個餘額計算。同一毫秒內連續寫入時，「最新一筆」不確定。
- 同時抽獎，抽到同一批人。
- 發布還沒 commit 時開始編輯，編輯會在發布 commit 之後換掉已發布活動的選項。刪除與封存也會作用在已發布的活動上。

積分帳本也服務聯絡人合併。主規格 `contact-management` 的「Point balances are summed」與「Points transferred back on reversal」，在同時調整積分時也不成立。

## What Changes

- 送出活動時，作答、積分與事件在同一個交易寫入。事件寫進 outbox，commit 之後才送出，至少送出一次（主規格 `event-delivery`）。其中一項寫不進去時，三項都不留下。
- 送出不允許重複參加的活動時，系統先鎖住「活動＋聯絡人」，再檢查有沒有作答過。
- 寫入積分帳本之前，系統先鎖住這位聯絡人的帳本，再讀餘額。寫入時間至少比最新一筆晚 1 毫秒。合併與解除合併先依 id 排序鎖住雙方的帳本，再讀餘額。
- 抽獎、編輯、刪除與每一種狀態轉換，都先鎖住活動列，再檢查狀態。
- 已知限制：粉絲送出時不鎖活動列，所以送出與結束活動同時進行時，可能多一筆剛好在結束時送出的作答。見 `design.md`。

## Capabilities

### New Capabilities

- `portal-activity`：粉絲活動的送出、積分帳本、抽獎與活動狀態轉換，在同時操作時的保證。

### Modified Capabilities

（無）`contact-management` 的積分 Scenario 內容不變，這個 change 讓它們在同時操作時也成立。

## Impact

- 後端：`apps/api/src/modules/portal/`（新增 `portal.flow.ts`）、`apps/api/src/modules/contact/contact-merge.service.ts`（轉移積分前先鎖住雙方的帳本）。
- 測試：
  - 新增 `apps/api/tests/feature/modules/portal/portal-flow.test.ts`：後台與粉絲端的路由，以及送出活動的事件。
  - 新增 `apps/api/tests/feature/modules/portal/portal-concurrency.test.ts`：同時操作的情境。
  - 新增 `apps/api/tests/unit/modules/portal/portal-submit-flow.test.ts`：送出活動的寫入順序。
  - `apps/api/tests/unit/modules/contact/contact-merge.test.ts` 的假交易補上 `$executeRaw`。
- API：同時操作時，原本會成功的第二個操作改為失敗，例如重複送出、編輯已發布的活動。等鎖期間活動被刪除時，封存等操作回 404，不再回 500。其他回應不變。
- 資料庫：沒有 migration。鎖是交易層級的 advisory lock 與 `SELECT … FOR UPDATE`。
