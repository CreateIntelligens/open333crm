## 1. 搬遷前的測試

- [x] 1.1 新增 `apps/api/tests/feature/modules/portal/portal-flow.test.ts`：後台活動的生命週期、狀態不對時的錯誤、跨租戶、抽獎、積分調整，以及粉絲端的列表、詳情與送出。在搬遷前的程式碼上執行，10 個通過。2 個失敗在斷言上，都是「送出活動的寫入一起成立」的情境：「送出活動的事件與作答一起寫進 outbox」（outbox 沒有事件）與「事件寫不進 outbox 時，作答與積分都不留下」（回 200）
- [x] 1.2 突變驗證「第二次送出被拒絕，不再給積分」與「抽獎只從還沒中獎的作答抽出」（`portal-flow.test.ts`）：前者拿掉 `submitActivity()` 的重複作答檢查時失敗，後者拿掉抽獎的 `isWinner: false` 條件時失敗

## 2. 搬遷

- [x] 2.1 `portal.service.ts`、`points.service.ts` 改收 `TenantCtx`；`submitActivity()` 不再發布事件，改回傳作答與活動類型；粉絲端路由裡的查詢移進 `portal.service.ts`。`contact-merge.service.ts` 轉移積分時改傳 `TenantCtx`
- [x] 2.2 新增 `portal.flow.ts`：`submitActivityFlow()` 在 `inTenant()` 內寫作答與積分，以 `publishEvent()` 寫事件；其他操作以 `flowOf` 包裝。兩個路由檔改呼叫 flow，`portal-public.routes.ts` 接收 `events` 選項，讓 1.1 通過
- [x] 2.3 新增 `apps/api/tests/unit/modules/portal/portal-submit-flow.test.ts`：「事件在 commit 之後才送出」「積分寫不進去時不送出事件」。突變驗證：flow 在交易內直接 `dispatch` 事件時前者失敗；`submitActivity()` 吞掉積分的錯誤時後者失敗

## 3. 同時操作

- [x] 3.1 新增 `apps/api/tests/feature/modules/portal/portal-concurrency.test.ts`：「同一位粉絲同時送出兩次」「同時寫同一位聯絡人的積分」「同一毫秒內連續寫入」「同時抽獎」「發布還沒 commit 時編輯、刪除、封存或再發布一次」（4 個）「編輯還沒 commit 時發布」「刪除還沒 commit 時封存」。在 2.2 完成後、3.2 之前的程式碼上執行，10 個都失敗在斷言上
- [x] 3.2 `submitActivity()` 先以 advisory lock 鎖住「活動＋聯絡人」再檢查重複作答；新增 `lockActivity()`，抽獎、編輯、刪除與每一種狀態轉換先以 `SELECT … FOR UPDATE` 鎖住活動列再檢查；新增 `lockPointLedgers()`，`addPointTransaction()` 先鎖住帳本再讀餘額，寫入時間至少比最新一筆晚 1 毫秒，讓 3.1 通過
- [x] 3.3 `portal-concurrency.test.ts` 新增「調整積分還沒 commit 時合併聯絡人」「扣點還沒 commit 時解除合併」。在 3.2 之前的程式碼上執行，兩個都失敗在斷言上（沒有等對方 commit 就讀餘額）。`contact-merge.service.ts` 的 `transferPoints()` 先依 id 排序鎖住雙方的帳本再讀餘額，解除合併讀持有者的餘額之前也先鎖住。`contact-merge.test.ts` 的假交易補上 `$executeRaw`
- [x] 3.4 突變驗證 `portal-concurrency.test.ts`，一次拿掉一項，每一項都有測試失敗：
  - 送出的 advisory lock →「同一位粉絲同時送出兩次」
  - `addPointTransaction()` 的帳本鎖 →「同時寫同一位聯絡人的積分」「調整積分還沒 commit 時合併聯絡人」「扣點還沒 commit 時解除合併」
  - 寫入時間＋1 毫秒 →「同一毫秒內連續寫入」
  - 抽獎的 `lockActivity()` →「同時抽獎」
  - `lockActivity()` 的 `FOR UPDATE` → 狀態轉換的 6 個情境與「同時抽獎」
  - `transferPoints()` 的帳本鎖 →「調整積分還沒 commit 時合併聯絡人」
  - 解除合併讀餘額前的帳本鎖 →「扣點還沒 commit 時解除合併」

- [x] 3.5 review-loop 第 1 輪：鎖鍵是字串，uuid 的大小寫不同就是另一把鎖。`portal-concurrency.test.ts` 新增「同時送出時，活動 id 的大小寫不同」「同時寫入時，聯絡人 id 的大小寫不同」，在修正前都失敗在斷言上。送出的鎖鍵改用資料庫回傳的活動 id 與小寫的聯絡人 id；`lockPointLedgers()` 先把聯絡人 id 轉成小寫，再去重、排序

- [x] 3.6 後台調整積分原本不檢查聯絡人：外鍵檢查不受 RLS 限制，其他租戶的聯絡人回 200 並寫入紀錄，不存在的聯絡人回 `DATABASE_ERROR`。`portal-flow.test.ts` 新增「調整其他租戶聯絡人的積分回 404，不寫入」「調整不存在的聯絡人的積分回 404」，在修正前都失敗在斷言上。新增 `adjustPoints()`，先確認聯絡人屬於這個租戶，路由改呼叫 `adjustPointsFlow`

- [x] 3.7 review-loop（第二次）第 1 輪：`submitActivity()` 以真假值判斷 `allowMultiple`，後台的 `settings` 接受任意 JSON，字串 `"false"` 會被當成允許重複參加。`portal-flow.test.ts` 新增「allowMultiple 不是 true 時只能參加一次：字串 "false" 也不允許重複」，在修正前失敗在斷言上。改為只有 `true` 才允許

- [x] 3.8 review-loop（第二次）第 1 輪之後，停止條件 4：uuid 大小寫與 `allowMultiple: "false"` 同屬「換一種合法的寫法就繞過檢查」，根本原因是 `settings` 沒有驗證。另外發現前端擋不住負數的 `pointsPerSubmit`，每次送出會扣積分。使用者決定做法 A：新增 `portal-settings.ts`，入口以 `activitySettingsSchema` 驗證，service 以 `readActivitySettings()` 讀取；前端不送出負數。`portal-flow.test.ts` 新增「活動設定不合法時，建立與編輯都回 400」「舊資料的積分設定不合法時，送出成功但不給積分」，3.7 的測試改為直接寫入舊資料；`apps/web/tests/unit/components/portal/activity-form-dialog.test.tsx` 新增「每次提交積分輸入負數時，送出 0」。三個測試在修正前都失敗在斷言上

- [x] 3.9 使用者決定在 AGENTS.md 定義輸入驗證的規則（Conventions 的 Validation），portal 先照規則改。兩個路由檔原本有 18 處以 `as` 轉型 `request.params`、`request.query`、`request.body`。`portal-flow.test.ts` 新增「後台與粉絲端的輸入不合法時回 400」，在修正前失敗在斷言上（不是 uuid 的活動 id 回 `DATABASE_ERROR`）。每個輸入改以 Zod 解析，分頁改用 `paginationSchema`。`tests/unit/shared/pagination.test.ts` 原本檢查 portal 有 `clampPage(`，改為檢查 portal 用 `paginationSchema`：這是刻意的改變，`?page=0` 從夾到第 1 頁改為回 400

- [x] 3.10 PR #404 的機器人審查：`getFanPointsFlow()` 分兩次查詢餘額與清單，兩次之間寫入一筆時，回應不一致。`apps/api/tests/unit/modules/portal/fan-points-flow.test.ts` 新增「粉絲的積分餘額與交易清單一致」，在修正前失敗在斷言上。餘額改取自清單的最新一筆；`portal-public-tenant-scope.test.ts` 的 mock 跟著更新。`portal-flow.test.ts` 的 `fan()` 原本一律以租戶 A 簽 fanToken，改為以聯絡人自己的租戶簽

- [x] 3.11 PR #404 機器人審查的第二批：
  - 積分的排序只依 `createdAt`，舊資料的時間相同時，最新一筆與交易清單可能選到不同的一筆。`apps/api/tests/unit/modules/portal/points-ordering.test.ts` 新增「時間相同的積分紀錄，最新一筆與交易清單的排序相同」，在修正前失敗在斷言上。兩個查詢改用 `LEDGER_ORDER`（`createdAt` 由新到舊，再依 `id`）
  - `portal-submit-flow.test.ts` 新增「commit 之後送不進佇列時，作答仍然成立」。行為原本就成立，以突變驗證：flow 在交易內直接 `await dispatch` 時，這個測試失敗
  - 粉絲的活動詳情不看開始與結束時間，屬於搬遷前的行為，記進 `docs/ref/system/AUDIT.md` 的 PORTAL-01

## 4. 完成定義

- [x] 4.1 `pnpm test:all` 通過；`tsc --noEmit`、`check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 通過，基準檔已更新
- [x] 4.2 `CHANGELOG.md` 加 Changed 與 Fixed 條目；更新 `docs/ref/features/tenant/PORTAL.md`、`docs/ref/modules/EVENTS.md`、`docs/ref/system/AUDIT.md` 的 PORTAL-02
- [x] 4.3 `node scripts/validate-openspec.mjs portal-activity-guarantees` 與 `--specs` 通過
