## 1. 工單重新解決時的問卷（csat-survey、case-management）

- [x] 1.1 測試 `apps/api/tests/feature/modules/csat/csat-reresolve.test.ts`：「重新解決的未評分工單不會被立即結案」，走真的 `transitionCase()` 與問卷逾時結案排程，在現有程式上斷言失敗（`Expected: "RESOLVED"`、`Received: "CLOSED"`）
- [x] 1.2 測試 `packages/shared/tests/unit/case-transitions.test.ts`：`caseTransitionCsatFields()` 未評分轉成 `RESOLVED` 清除、已評分不動、其他轉換不動
- [x] 1.3 `@open333crm/shared` 新增 `caseTransitionCsatFields()`；API 的 `transitionCase()` 展開到更新資料（design D1）
- [x] 1.4 測試 `csat-reresolve.test.ts`：「重新解決的未評分工單再寄一份問卷」修正前斷言失敗（寄出時間不是這一次）；「重新寄出的問卷逾時從這次起算」「已評分的工單重新解決不再寄問卷」寫好就通過，mutation：拿掉 `caseTransitionCsatFields()` 的已評分判斷時「已評分的工單重新解決不再寄問卷」失敗，已還原（「重新寄出的問卷逾時從這次起算」鎖住逾時以 `csatSentAt` 起算的既有行為）
- [x] 1.5 測試 `apps/workers/tests/unit/lib/automation-update-case-status.test.ts`：「自動化重新解決工單時同樣處理問卷」，在現有程式上斷言失敗（清除上一輪的寄出時間）
- [x] 1.6 workers 的 `update_case_status` 讀 `csatScore` 並展開 `caseTransitionCsatFields()`
- [x] 1.7 寄送排程與 `sendCsatSurvey()` 的認領加 `csatScore: null`；測試 `csat-reresolve.test.ts`「已評分的工單不寄問卷（客服代評時還沒寄過問卷）」修正前斷言失敗

## 2. 寄送延遲與渠道能力（csat-survey、channel-plugins）

- [x] 2.1 測試 `apps/api/tests/unit/modules/csat/csat.scheduler.test.ts`：「解決未滿 30 分鐘不寄問卷」在現有程式上斷言失敗；「解決滿 30 分鐘寄出問卷」寫好就通過，mutation：延遲改成 40 分鐘時失敗（unit 與 feature 都失敗），已還原
- [x] 2.2 `csat.scheduler.ts` 改用常數 `CSAT_SURVEY_DELAY_MINUTES = 30`
- [x] 2.3 測試 `packages/channel-plugins/tests/unit/csat-survey-capability.test.ts`：「LINE plugin builds a CSAT survey」修正前失敗；「Other plugins cannot send a CSAT survey」寫好就通過（其他外掛修正前後都沒有這個方法，測試鎖住「只有 LINE 有」這個定義）；`apps/workers/tests/unit/lib/plugin-registry.test.ts`：「Workers registry has the same capability」
- [x] 2.4 `ChannelPlugin` 新增選用方法 `buildCsatSurvey()`，LINE 外掛實作（Flex 從 csat.service 移到 `line/builders.ts`）
- [x] 2.5 測試 `apps/api/tests/feature/modules/csat/csat-channel-capability.test.ts`：「非 LINE 渠道的工單不寄問卷」「非 LINE 工單不佔排程名額」「解決未滿 30 分鐘不寄問卷」修正前斷言失敗；「非 LINE 渠道的工單停在已解決」寫好就通過，mutation：問卷逾時結案的查詢改看 `resolvedAt` 時失敗，已還原；「解決滿 30 分鐘寄出問卷」同 2.1 的 mutation
- [x] 2.6 `sendCsatSurvey()` 與寄送排程依 `csatSurveyChannelTypes()` 判斷，移除 csat 模組的 `channelType` 分支（design D2）
- [x] 2.7 更新 `csat-delivery.test.ts`「問卷送出失敗時客服看得到：其他渠道送不出」改為渠道停用，新增「非 LINE 渠道的工單不寄問卷：不認領、不建立問卷訊息」；`csat.service.test.ts`、`csat-disabled-tenant.test.ts` 改用 LINE 對話（決定 7 刻意改變的行為；`csat-disabled-tenant` 以 mutation 驗證：拿掉兩處 `tenant.isActive` 條件時失敗，已還原）

## 3. 評分（csat-survey、inbound-message-processing）

- [x] 3.1 測試 `apps/api/tests/feature/modules/csat/csat-rating.test.ts`：「客人連點兩次評分只處理一次」「同一份評分同時送達兩次」（兩條連線讀完都在柵欄等待，再一起寫入），在現有程式上斷言失敗（`只有一次回傳已記錄`：`2 !== 1`）
- [x] 3.2 `recordCsatScore()` 改成條件更新認領，同時寫 `csatRatedBy`（design D3）
- [x] 3.3 測試 `csat-rating.test.ts`：「客人評分記錄來源」「客服代評記錄來源」「客人評分後對話關閉」「客服代評後對話關閉」，在現有程式上斷言失敗
- [x] 3.4 schema 新增 `Case.csatRatedBy` 與 migration `20261111100000_add_case_csat_rated_by`（只套用到 `open333crm_test_339`）；測試 `apps/api/tests/feature/migrations/backfill-case-csat-rated-by.test.ts`：「既有評分依時間軸回填來源」、重複執行、guard
- [x] 3.5 評分結案後呼叫 `closeConversationsForCase()`（design D5）

## 4. 低分通知（csat-survey）

- [x] 4.1 測試 `csat-rating.test.ts`：「低分通知有工單指派權限的管理員與主管」「沒有工單指派權限的成員不收低分通知」「看不到渠道的成員不收低分通知」在現有程式上斷言失敗；「停用的成員不收低分通知」以 mutation 驗證（拿掉收件人查詢的 `isActive` 條件時失敗，另直接斷言收件人名單，因為寫入通知時也會擋停用成員）；「3 分不發低分通知」以 mutation 驗證（門檻改成 3 分時失敗），都已還原
- [x] 4.2 `permission.service.ts` 抽出 `loadPlanCeiling()`；`notification.service.ts` 新增 `resolveCaseManagerRecipients()`；`recordCsatScore()` 改用 `notifyCsatLowScore()`，失敗時寫 `csat_low_score_notify_failed`（design D4）；測試 `apps/api/tests/unit/modules/csat/csat-score-display.test.ts`「低分通知送不出時客服看得到」，mutation：事件類型改名時失敗，已還原
- [x] 4.3 前端 `CaseTimeline` 顯示 `csat_low_score_notify_failed` 的中文說明（`case-csat-score.test.tsx`「時間軸以中文顯示低分通知沒有送出」修正前失敗）

## 5. 報表（analytics-reports）

- [x] 5.1 測試 `apps/api/tests/feature/modules/analytics/analytics-csat-source.test.ts`：「總覽的平均不含客服代評」「滿意度報告分開客服代評」「客服績效的 CSAT 不含客服代評」，在現有程式上斷言失敗；`analytics-reports.test.ts` 的總覽與 CSAT 報表回應多了 `csatAgentRatedCount`、`agentRatedCount`（本 change 刻意新增的欄位）
- [x] 5.2 `analytics.service.ts` 的總覽、CSAT 報告、客服績效只算客人自評，回傳客服代評筆數
- [x] 5.3 測試 `apps/web/tests/unit/components/analytics/kpi-cards-csat.test.tsx`：「報表頁顯示客服代評筆數」；`apps/web/tests/unit/components/case/case-csat-score.test.tsx`：「工單詳情標明客服代評」，在現有程式上斷言失敗
- [x] 5.4 `KpiCards` 顯示客服代評筆數；`CaseDetail` 標明客服代評；工單詳情頁傳入 `csatRatedBy`

## 6. 文件

- [x] 6.1 `docs/19_CSAT_FLOW.md` 依本次決定改寫；`docs/04_CASE_MANAGEMENT.md` 的 CSAT 段落標成過時並指向 19
- [x] 6.2 `docs/ref/system/AUDIT.md`：CASE-04、CASE-02 移除，CASE-05 部分修正內文更新，RBAC-03 移除 `recordCsatScore()` 一列；`AUDIT-REVIEWS.md` 加一筆；`feature-map.json`、健檢總表的參照更新
- [x] 6.3 `docs/ref/modules/CHANNEL-PLUGINS.md`、`docs/ref/modules/PERMISSIONS.md`、`docs/ref/features/tenant/CASES.md`、`NOTIFICATIONS.md`、`ANALYTICS.md` 更新

## 7. 完成定義

- [x] 7.1 `pnpm test`
- [x] 7.2 `pnpm test:feature`（`TEST_DATABASE_NAME=open333crm_test_339`）
- [x] 7.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有新增違規
- [x] 7.4 `node scripts/validate-openspec.mjs --specs`、`node scripts/validate-openspec.mjs csat-reresolve-decisions-339`
- [x] 7.5 `pnpm build`
- [x] 7.6 `CHANGELOG.md` 的 `## [2026-11-11]` 加條目
- [x] 7.7 不在本 change 歸檔：部署到 UAT 驗證後才歸檔
