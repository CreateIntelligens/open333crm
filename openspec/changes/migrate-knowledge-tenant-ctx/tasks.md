## 1. 搬遷前的回歸測試

- [x] 1.1 新增 `apps/api/tests/feature/modules/knowledge/knowledge-test-app.ts`（A、B 兩個專用租戶，走真實的 `requirePermission` 與 `app_tenant` 連線，寫法同 `canvas-test-app.ts`）與 `knowledge-routes.test.ts`，在搬遷前的程式碼上執行「知識庫管理只作用在本租戶的資料」的 5 個 scenario。預期「重新向量化不存在或另一個租戶的文章」失敗在斷言上（回 500），其他 4 個通過。通過的項目以突變驗證：同時拿掉兩層隔離（路由改傳 `fastify.prismaAdmin`，而且 service 的 `where` 拿掉 `tenantId`），各讓對應的項目失敗。「讀取另一個租戶的文章」另外斷言 B 文章的 `viewCount` 不變。結果：「重新向量化不存在或另一個租戶的文章」回 500，失敗在斷言上；其他 4 個通過，以突變驗證（列表、單篇、`PATCH`、回報的 resolve 各自同時拿掉兩層）都失敗
- [x] 1.2 在 `knowledge-routes.test.ts` 寫「知識庫路由驗證查詢參數與路徑參數」的 4 個 scenario。預期「文章 id 格式錯誤」失敗在斷言上（`DATABASE_ERROR`）、`limit=101` 與「回報的篩選值不合法」失敗在斷言上（回 200）。`page=0` 若搬遷前已回 400 `VALIDATION_ERROR`（Prisma 拒絕負的 `skip`），改斷言 `details.issues` 指出 `page`。「沒有給每頁筆數」通過，以突變驗證：預設值改成 20 時失敗。結果：不合法的 id 回 `DATABASE_ERROR`，`page=0` 回 500，`status=closed` 回 200，都失敗在斷言上；「沒有給每頁筆數」通過，突變驗證失敗。每項都斷言 `details.issues` 指出參數名稱
- [x] 1.3 在 `knowledge-routes.test.ts` 寫「批次匯入的每篇文章各自寫入」：第二篇的標題含 `\u0000`，PostgreSQL 拒絕寫入。搬遷前通過；以突變驗證：拿掉 `batchImportArticles` 迴圈內的 `try/catch` 時失敗。結果：搬遷前通過，突變（拿掉 `try/catch`）失敗
- [x] 1.4 在 `knowledge-routes.test.ts` 寫「只改分類或標籤時不重新向量化」。搬遷前 `embedArticle` 不能注入，這一項在 2.6 改成注入之後才執行，以突變驗證：拿掉 `updateArticle` 的欄位判斷時失敗。結果：2.6 之後執行，通過；突變（`needsEmbedding` 一律 `true`）失敗。測試也斷言改內容時開始向量化一次
- [x] 1.5 在 `knowledge-routes.test.ts` 先寫會失敗的測試「角色沒有檢視權限」：只有 `inbox.view` 的成員逐一呼叫 9 條讀取路由，斷言 403 與 `error.details.requiredPermission` 是 `knowledge.view`。預期失敗在斷言上（回 200）。「角色有檢視權限」通過，以突變驗證：列表路由改要求 `knowledge.manage` 時失敗。結果：搬遷前「角色沒有檢視權限」回 200，失敗在斷言上；2.6 之後通過，突變失敗

## 2. knowledge 搬遷（行為不變的部分）

- [x] 2.1 新增 `apps/api/tests/unit/modules/knowledge/knowledge.flow.test.ts`（`tests/support/flow-harness.ts`），先寫會失敗的測試：「commit 之後開始向量化」（`embed` 在 `commit` 之後被呼叫一次，參數是 `tenantId` 與文章 id）、「rollback 時不開始向量化」（寫入文章之後的步驟丟錯，`embed` 沒有被呼叫）、「向量化失敗不影響回應」（`embed` reject 時 flow 仍回傳文章，log 有錯誤）。結果：先以寫入之後立刻呼叫 `embed` 的版本執行，3 項都失敗在斷言上；改用 `startEmbedAfterCommit` 之後通過
- [x] 2.2 `knowledge.service.ts` 改收 `TenantCtx`，拿掉所有 `embedArticle()` 呼叫，改成回傳 flow 需要的事實：`publishArticle` 回傳文章有沒有向量；`semanticSearch` 移到 flow（design D6）；新增 `countPublishedArticles`、`assertArticleExists`
- [x] 2.3 新增 `knowledge-effects.ts` 的 `startEmbedAfterCommit`、`removeFilesAfterCommit`（D2、D3）與 `knowledge.flow.ts`：查詢用 `flowOf`；建立、修改、發布、檔案上傳呼叫 `startEmbedAfterCommit`；批次匯入每篇一個 `inTenant()`（D5）；`/search`、`/embedding-status`、`/bulk-embed`、`/:id/embed` 依 D6。2.1 通過
- [x] 2.4 `kb-feedback.service.ts` 改收 `TenantCtx`；`knowledge.flow.ts` 新增回報的 flow 與 `recordKbFeedbackFlow`（D7）；`webhook/inbound-postback-interceptors.ts` 改呼叫 `recordKbFeedbackFlow`。`tests/feature/modules/webhook/inbound-message-processing.test.ts` 的 3 個「KB 回饋」測試通過
- [x] 2.5 `partner-ingest.service.ts` 改收 `TenantCtx`，拆成判斷結果（交易 1 與交易 2 共用）、`DELETE` 的封存、寫入文章與附件資料列（回傳舊附件的 `storageKey`）。flow 依 D4 串成三段，上傳以注入的 `storage.upload` 呼叫。這一步先不刪舊檔案
- [x] 2.6 `knowledge.routes.ts` 改呼叫 flow，傳入 `embed` 與 `storage` 的實作（D1）；`:id`、列表與回報的查詢以 Zod 解析（D8）；9 條讀取路由加上 `requirePermission('knowledge.view')`（D9）。`knowledge-test-app.ts` 改成注入記錄呼叫的 `embed` 與 `storage`。1.1～1.5 都通過。結果：`knowledge-routes.test.ts` 13 項通過
- [x] 2.7 `knowledge-partner-key-auth.test.ts`、`knowledge-upload-encoding.test.ts` 改成 mock `knowledge.flow.js`（原本 mock service），斷言不變。兩個測試檔通過。結果：兩個測試檔的斷言沒有改，18 項通過
- [x] 2.8 在 `knowledge-routes.test.ts` 新增「commit 之後開始向量化」與「向量化失敗不影響回應」的 feature 版本：注入的 `embed` 以 owner 連線讀文章，讀得到；`embed` reject 時回 201，文章存在。突變驗證：`embed` 改成在交易內直接呼叫時第一項失敗。結果：通過；突變（改成在交易內 `await embed`）讓「commit 之後開始向量化」失敗在「向量化開始時讀不到文章」

## 3. 合作方推送的附件

- [x] 3.1 新增 `apps/api/tests/feature/modules/knowledge/partner-ingest.test.ts`，寫「一個附件上傳失敗」（注入的 `upload` 對第二個附件 reject）。行為本來就有，以突變驗證：拿掉略過附件的 `try/catch` 時失敗。結果：通過；突變（上傳失敗時丟出錯誤）失敗
- [x] 3.2 在 `partner-ingest.test.ts` 先寫會失敗的測試「上傳期間另一個推送寫入較新的版本」：注入的 `upload` 在上傳期間以 owner 連線把文章的 `externalVer` 改大。預期失敗在斷言上（回 `updated`，蓋掉較新的版本）。結果：失敗在斷言上（回 `updated`）
- [x] 3.3 交易 2 再讀一次既有的文章，以判斷結果的同一個函式重新判斷（D4）。3.2 通過。結果：3.2 通過
- [x] 3.4 在 `knowledge.flow.test.ts` 寫「寫入文章失敗」：上傳成功之後交易 2 丟錯，flow 丟出錯誤、沒有呼叫 `storage.remove`、`embed`。在 `partner-ingest.test.ts` 斷言路由回 500 `INGEST_FAILED`。結果：feature 測試讓上傳回傳的 key 含 `\u0000`，寫附件資料列時失敗，回 500 `INGEST_FAILED`，資料庫沒有這篇文章。單元測試沒有內容偵測的模型，內容偵測換成接受 PDF 的假函式
- [x] 3.5 既有的「Partner Doc Mutation Command」scenario（`CREATE`、`UPDATE`、`DELETE`、`skipped`、`INVALID_CMD`）在 `partner-ingest.test.ts` 各寫一個測試，確認拆成三段之後行為不變。搬遷前沒有這些測試，以突變驗證：判斷函式的 `<=` 改成 `<` 時「UPDATE with stale Ver」失敗；`DELETE` 不清空向量時「DELETE soft-delete」失敗。結果：9 項通過；兩個突變各讓對應的項目失敗。`DELETE` 的測試另外斷言附件與檔案保留。測試寫入向量時以資料庫欄位的維度為準：schema 寫 1024，本機的欄位是 1536（AUDIT DB-01）

## 4. 刪除附件的檔案

- [x] 4.1 在 `partner-ingest.test.ts` 先寫會失敗的測試「覆蓋文章時刪除舊附件的檔案」：注入的 `storage.remove` 被呼叫一次，參數是 X 的 `storageKey`，沒有收到 Y 的。結果：失敗在斷言上（沒有刪除）
- [x] 4.2 在 `knowledge-routes.test.ts` 先寫會失敗的測試「刪除文章時刪除附件的檔案」。結果：失敗在斷言上（沒有刪除）
- [x] 4.3 在 `knowledge.flow.test.ts` 先寫會失敗的測試「刪除檔案失敗」（`remove` reject 時 flow 仍回傳結果，log 有錯誤）與「寫入失敗時不刪除舊檔案」（交易 2 丟錯時 `remove` 沒有被呼叫）。結果：「刪除檔案失敗」失敗在斷言上；「寫入失敗時不刪除舊檔案」在沒有刪檔時本來就通過，改讓交易 2 的 commit 失敗（寫入都完成、拿到舊附件的 key 之後才 rollback），4.4 之後以突變驗證：改成在交易內直接刪檔時失敗
- [x] 4.4 `deleteArticle` 與寫入附件資料列的 service 回傳舊附件的 `storageKey`；flow 呼叫 `removeFilesAfterCommit`（D3）。4.1～4.3 通過。結果：知識庫的 feature 29 項、單元 21 項通過

## 4A. PR #463 審查後的修正

- [x] 4A.1 先寫會失敗的測試：`partner-ingest.test.ts`「兩個推送同時寫入同一篇文章」（以 owner 連線的交易鎖住文章、寫成 Ver 3、停在 commit 之前，以 `waitUntilBlockedBy` 確認 Ver 2 的推送卡在鎖上）；「上傳期間另一個推送寫入較新的版本」與「寫入文章失敗」改斷言這次上傳的檔案被刪除；`knowledge.flow.test.ts` 新增「commit 結果不明時保留檔案」，「寫入文章失敗」改斷言 rollback 之後才刪檔。結果：都失敗在斷言上，併發的那一項回 `updated`（Ver 2 蓋掉 Ver 3）
- [x] 4A.2 `findPartnerDoc` 加上 `lock` 選項（`FOR UPDATE`），交易 2 鎖住文章再判斷；flow 以 `commitPending` 旗標區分「確定沒有寫入」與「commit 結果不明」，前者以 `removeFilesNow` 刪除這次上傳的檔案（design D4）。4A.1 通過；突變驗證：交易 2 不上鎖時併發的那一項失敗，commit 結果不明時也刪檔時「commit 結果不明時保留檔案」失敗
- [x] 4A.3 spec 拆出「合作方推送沒有寫入時刪除這次上傳的檔案」，更新 design D4、Risks、proposal、CHANGELOG 與 `feature-knowledge` skill。機器人另外指出的文字問題一起修正：skill 寫「JSON 依 `status`」改成只保留 `PUBLISHED`；`createArticle` 的註解改成狀態由 flow 決定

## 5. 完成條件

- [x] 5.1 `pnpm test` 與 `pnpm test:feature` 通過。結果：`pnpm test` 17 個 turbo 任務都成功（api 單元 1660 項）；`pnpm test:feature` 7 個任務都成功（1309 項）
- [x] 5.2 `node scripts/check-tenant-ctx.mjs --strict` 通過，`--update-baseline` 之後 `knowledge` 模組的舊寫法是 0；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增的違規。結果：`knowledge` 從 45 降到 0。`knowledge-effects.ts` 的註解原本寫了型別名稱，被當成 1 處舊寫法，改寫註解。另外兩個檢查沒有新增的違規
- [x] 5.3 `node scripts/feature-impact.mjs` 列出受影響的領域，逐項檢查 `feature-knowledge` 的回歸清單；路徑有變時更新 `feature-map.json`，`--check` 通過。結果：直接影響 `knowledge`、`marketing`、`line`；後兩者只因 `inbound-postback-interceptors.ts`，這次只改了 `kb_feedback` 分支，由 webhook 的 3 個「KB 回饋」測試涵蓋。`feature-knowledge` 回歸清單：第 1 項本機沒有向量化服務，由 commit 之後開始向量化的測試涵蓋；第 2 項由 `knowledge-upload-encoding.test.ts` 涵蓋；第 3、3a 項沒有改到 `ai` 模組；第 4 項由 KB 回饋與回報 resolve 的測試涵蓋；第 5 項由讀取權限的測試涵蓋。路徑沒有改，`feature-map.json` 不用改，`--check` 通過
- [x] 5.4 `CHANGELOG.md` 的 `Changed` 新增一條：向量化在 commit 之後開始、合作方推送的附件在交易外上傳、覆蓋與刪除文章時刪除舊附件的檔案、`POST /:id/embed` 的 404、參數驗證的 400；`Fixed` 新增一條：讀取路由要求 `knowledge.view`
- [x] 5.5 更新文件：`.claude/skills/feature-knowledge/SKILL.md` 描述向量化、附件與讀取權限的段落；`docs/ref/system/AUDIT.md` 權限碼表的 `knowledge.view` 改成已修正，其他有對應的項目一起更新，並在 `AUDIT-REVIEWS.md` 加一筆；`docs/ref/features/health/KNOWLEDGE.md` 記錄的讀取路由 200 改成已修正。另外在 `docs/ref/features/health/KNOWLEDGE.md` 標註 HC-KNOWLEDGE-09 已修正
- [x] 5.6 `node scripts/validate-openspec.mjs migrate-knowledge-tenant-ctx` 與 `--specs` 通過

## Workflow follow-up

- 部署到 UAT 之後，照 design「Migration Plan」確認，並重跑規劃 6.2 的腳本。
- 歸檔前後比較 `validate-openspec.mjs --specs` 的「略過 N 則」。
