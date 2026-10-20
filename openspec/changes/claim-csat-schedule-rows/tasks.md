## 1. 寄送滿意度問卷：先認領再寄出

- [x] 1.1 在 `apps/api/tests/unit/modules/csat/csat.service.test.ts`（新增）寫 Scenario「排程讀取之後，別次執行已經寄出問卷」的測試：mock executor 的 `case.findUnique` 回傳 `RESOLVED`、沒有 `csatSentAt` 的工單，`case.updateMany` 回傳 `{ count: 0 }`；呼叫 `sendCsatSurvey()`，斷言回傳 `false`、`message.create` 沒有被呼叫、渠道 plugin 與 `deliverToChannel()` 沒有被呼叫。執行測試，確認在 assertion 失敗
- [x] 1.2 同一檔案寫 Scenario「排程讀取之後，客服重開了工單」的測試：讀取時是 `RESOLVED`，`updateMany` 回傳 `{ count: 0 }`，並斷言 `updateMany` 的 `where` 包含 `status: 'RESOLVED'`、`csatSentAt: null` 與工單的 `tenantId`。執行測試，確認在 assertion 失敗
- [x] 1.3 同一檔案寫 Scenario「工單到了寄送時間，寄出一份問卷」的測試：`updateMany` 回傳 `{ count: 1 }`，斷言回傳 `true`、`message.create` 呼叫一次、問卷送到渠道一次，而且 `updateMany` 在 `message.create` 之前呼叫。執行測試，確認在 assertion 失敗（修正前不呼叫 `updateMany`）
- [x] 1.4 依 design.md D1 修改 `apps/api/src/modules/csat/csat.service.ts` 的 `sendCsatSurvey()`：在建立訊息之前以 `case.updateMany` 認領，`count === 0` 時寫一行 info log 並回傳 `false`；移除原本建立訊息之後以 `id` 寫入 `csatSentAt` 的更新。執行 1.1～1.3 的測試，確認通過
- [x] 1.5 同一檔案寫 Scenario「認領之後建立問卷訊息失敗，下一期重試」的測試：`updateMany` 第一次回傳 `{ count: 1 }`，`message.create` 丟錯；斷言 `sendCsatSurvey()` 丟出同一個錯誤、第二次 `updateMany` 的 `where` 是工單 id 與第一次寫入的 `csatSentAt`、`data` 是 `csatSentAt: null`，而且沒有送到渠道。執行測試，確認在 assertion 失敗（PR #335 審查意見）
- [x] 1.6 依 design.md D1 在 `sendCsatSurvey()` 的 `message.create()` 外加上還原認領的處理。執行 1.1～1.5 的測試，確認通過

## 2. 問卷逾時結案：先認領再結案

- [x] 2.1 在 `apps/api/tests/unit/modules/csat/csat.scheduler.test.ts`（新增）寫 Scenario「排程讀取之後，客服重開了工單」的測試：傳入假的 `JobScheduler` 取得 `csat-auto-close` 的 `run`；mock executor 的 `case.findMany` 回傳一張工單，`case.updateMany` 回傳 `{ count: 0 }`；斷言沒有發布 `case.closed`、沒有推送 `case.updated`、`closeConversationsForCase()` 沒有被呼叫，並斷言 `updateMany` 的 `where` 包含 `status: 'RESOLVED'`、`csatRespondedAt: null` 與 `tenantId`。執行測試，確認在 assertion 失敗
- [x] 2.2 同一檔案寫 Scenario「排程讀取之後，客人回覆了評分」與「排程讀取之後，別次執行已經結案」的測試。兩者在 executor 層的輸入相同（`updateMany` 回傳 `{ count: 0 }`），各寫一個測試，名稱對應各自的 Scenario。執行測試，確認在 assertion 失敗
- [x] 2.3 同一檔案寫 Scenario「問卷逾時沒有回覆，工單結案」的測試：`updateMany` 回傳 `{ count: 1 }`，斷言 `case.closed` 發布一次、`closeConversationsForCase()` 呼叫一次。執行測試，確認在 assertion 失敗（修正前呼叫的是 `case.update`）
- [x] 2.4 依 design.md D2 修改 `apps/api/src/modules/csat/csat.scheduler.ts` 的 `pollAutoClose()`：以 `case.updateMany` 認領，`count === 0` 時寫一行 info log 並跳過這張工單。執行 2.1～2.3 的測試，確認通過

## 3. 文件

- [x] 3.1 更新 `docs/ref/features/tenant/CASES.md`「解決之後」一節：寫明兩個排程先以條件更新認領工單，認領失敗時不寄問卷、不結案。用詞改成「寄送滿意度問卷」與「問卷逾時結案」。確認文中提到的檔案與函式名稱存在
- [x] 3.2 更新 `docs/ref/system/AUDIT.md` 的 APP-09：摘要表與內文改寫為寄送滿意度問卷與問卷逾時結案已修正，剩下 Canvas 等待節點喚醒（issue #334）。在 `docs/ref/system/AUDIT-REVIEWS.md` 新增一筆紀錄，寫明本 change 與測試檔
- [x] 3.3 在 `CHANGELOG.md` 最新的 `## [YYYY-MM-DD]` 段落的 `Fixed` 加一則，連結 issue #333

## 4. 完成前檢查

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 `pnpm test:feature` 通過（改了資料庫的寫法；`tests/feature/modules/csat/` 必須通過）
- [x] 4.3 `node scripts/check-tenant-scoping.mjs --strict` 與 `node scripts/check-prisma-admin-usage.mjs --strict` 沒有本 change 新增的違規
- [x] 4.4 `node scripts/validate-openspec.mjs claim-csat-schedule-rows` 通過

## Workflow follow-up

- 審查通過後，以 `pnpm exec openspec archive claim-csat-schedule-rows` 歸檔，並把新的主規格 `openspec/specs/csat-survey/spec.md` 的 `## Purpose` 確認為本 change 寫的內容。
- 歸檔後執行 `node scripts/validate-openspec.mjs --specs`，比較「略過 N 則」沒有增加。
