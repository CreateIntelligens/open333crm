## 1. 搬遷前補測試

- [ ] 1.1 執行既有的 csat 測試（`tests/unit/modules/csat/**`、`tests/feature/modules/csat/**`），記錄通過數，作為搬遷前後的對照。
- [ ] 1.2 `apps/api/tests/feature/modules/csat/csat-transaction.test.ts`：「認領之後建立問卷訊息失敗」（MODIFIED）。
  - 以 owner 連線替這段對話建立暫時的 trigger，讓問卷訊息寫入失敗。
  - 預期：`csatSentAt` 是空值，對話中沒有問卷訊息，系統沒有呼叫渠道外掛。
  - 搬遷前，這個測試應該失敗在斷言上，因為 `csatSentAt` 已經寫入。
- [ ] 1.3 同一個檔案：「結案寫入失敗時分數也不留下」（ADDED）。
  - 以 trigger 讓這張工單改成 `CLOSED` 時失敗。
  - 預期：分數、感謝訊息、`csat_rated`、`case.closed`、推播都沒有留下，渠道沒有收到感謝訊息。
  - 搬遷前，這個測試應該失敗在斷言上，因為分數已經寫入。
  - 另加一項：從路由記分時，commit 之後關閉對話成功（突變：把 `conversationDb` 換成沒有綁定租戶的 `app_tenant` 連線，對話沒有關閉，測試失敗）。
- [ ] 1.4 同一個檔案：「評分沒有寫入之後可以再評分」（ADDED）。移除 trigger 後再評 5 分，預期工單 `CLOSED`、分數 5。
- [ ] 1.5 同一個檔案：問卷逾時結案的 `case.closed` 寫進 outbox，與工單改成 `CLOSED` 一起 commit。以突變驗證：把 `publishEvent` 改回 `eventBus.publish`，測試失敗。

## 2. 搬遷

- [ ] 2.1 `csat.service.ts`：`recordCsatScore`、`sendCsatSurvey` 拆成只收 `TenantCtx` 的 service 函式（認領與寫入），不再收 `TenantDb`、`io`；讀遮罩政策、送 LINE、推播移出 service。
- [ ] 2.2 新增 `csat.flow.ts`：寄問卷（D1）、逾時結案（D2）、記分（D3）三個 flow。依 design 的步驟表開交易、登記推播、以 `publishEvent` 發 `case.closed`。呼叫 `conversation` 的兩個函式時，用入口注入的 `conversationDb`（D4）。
- [ ] 2.3 `notifyCsatLowScore()` 改收 `TenantScope`、呼叫 `createAndDispatch()`；刪除 `notification-effects.ts` 的 `createAndDispatchWithoutTransaction()`，並更新 `NOTIFICATIONS.md`、`feature-notifications` skill 中的說明。
- [ ] 2.4 `csat.scheduler.ts`：`setupCsatScheduler(scheduler, { admin, prisma, io, events })`，掃描用 `admin`，每張工單呼叫 flow；`index.ts` 跟著改。
- [ ] 2.5 `case.routes.ts` 的 `POST /:id/csat` 改呼叫記分 flow，不再用 `request.tenantPrisma`。
- [ ] 2.6 `inbound-postback-interceptors.ts` 的 csat 攔截改呼叫記分 flow，連線用 `ctx.options.tenantPrisma ?? ctx.prisma`。
- [ ] 2.7 執行 1.2～1.4 的測試，確認通過；執行 1.1 的既有測試，確認通過數不變。既有測試的斷言要改時，先依 AGENTS.md 判斷是哪一邊正確，並在 commit 訊息寫明。

## 3. 突變驗證既有 scenario

- [ ] 3.1 「每次解決最多寄出一份滿意度問卷」的其他 scenario：拿掉認領條件中的 `csatSentAt: null`，既有的重複寄送測試失敗。
- [ ] 3.2 「評分只處理一次」：拿掉記分認領條件中的 `csatScore: null`，既有的連點測試失敗。
- [ ] 3.3 「低分通知送不出時客服看得到」：讓收件人查詢丟錯，分數仍記錄、時間軸有 `csat_low_score_notify_failed`；把低分通知移進記分的交易 A，這個測試失敗。

## 4. 完成條件

- [ ] 4.1 `pnpm test` 通過。
- [ ] 4.2 `pnpm test:feature` 通過。
- [ ] 4.3 `node scripts/check-tenant-ctx.mjs --strict` 通過，並以 `--update-baseline` 更新基準檔（`csat.service.ts`、`case.routes.ts` 的舊寫法減少）。
- [ ] 4.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規。
- [ ] 4.5 `node scripts/feature-impact.mjs` 列出的直接受影響領域（工單、LINE），逐項走過 skill 的回歸清單；`feature-map.json` 需要時更新，`--check` 通過。
- [ ] 4.6 `node scripts/validate-openspec.mjs migrate-csat-tenant-ctx` 與 `--specs` 通過。
- [ ] 4.7 `CHANGELOG.md` 在 `Changed` 寫明可觀察的差異（記分一起 rollback、建立問卷訊息失敗會重試、`case.closed` 至少一次）。
- [ ] 4.8 更新 `docs/ref/` 中描述 csat 行為的文件與 `feature-cases` skill。
- [ ] 4.9 部署到 UAT 之後，重跑 #337 規劃 6.2 的量測（這批改到 `POST /cases/:id/csat`，GET 端點沒有改，只確認併發沒有變差）。
