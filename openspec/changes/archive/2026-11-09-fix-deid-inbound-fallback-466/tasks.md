## 1. 測試先行

- [x] 1.1 feature 測試 `apps/api/tests/feature/modules/webhook/inbound-deidentification-fallback.test.ts`（真的 `processInboundMessage()`、測試資料庫與 `setupAutomationWorker()`；只換掉 HTTP（`fetch`）、模型供應商、送出渠道、BullMQ 佇列與 `sendOpsAlert()`）：「去識別化服務回 503」「去識別化服務逾時」「去識別化服務的網址解析失敗」「重試一次成功」「未遮罩的進站訊息發出告警」「發出告警失敗」「未遮罩的訊息轉接真人」「去識別化服務無法使用時客人點按轉接人工」「去識別化服務無法使用時跨渠道綁定失敗」。程式寫在測試之前（接手時已有實作），以 3.1 的 mutation 確認每個測試在對應程式拿掉時以 assertion 失敗
- [x] 1.2 同一檔「去識別化服務正常」：現有程式本來就成立，以 mutation 驗證（見 3.1 M20、M20b）
- [x] 1.3 單元測試 `apps/api/tests/unit/modules/ai/deidentification-retry.test.ts`：「去識別化服務回 400 不重試」、逾時後重試（假計時器）、兩次都逾時、政策關閉
- [x] 1.4 單元測試 `apps/api/tests/unit/modules/automation/inbound-unmasked-ai.test.ts`（automation-harness）：「未遮罩的訊息命中關鍵字規則」「未遮罩的訊息的情緒分析」「去識別化服務無法使用時客人要求轉接真人」（最後一個在修正前以 `assert.doesNotReject` 失敗）
- [x] 1.5 單元測試 `apps/api/tests/unit/modules/privacy/unmasked-history.test.ts`：「對話紀錄有未遮罩的訊息」「新工單最新的進站訊息未遮罩」
- [x] 1.6 單元測試 `apps/api/tests/unit/modules/privacy/system-template-message.test.ts`：「座席轉接時沒有填寫轉接訊息」（更新原本的預設轉接訊息案例）；`csat.service.test.ts` 的評分後回覆案例改為斷言不呼叫 2md
- [x] 1.7 單元測試 `apps/api/tests/unit/modules/csat/csat-delivery.test.ts`：「去識別化服務無法使用時滿意度調查照常送出」

## 2. 實作

- [x] 2.1 `deidentification.service.ts`：`maskTexts()` 每次嘗試 6 秒逾時、短暫故障重試一次；失敗原因代碼；`prepareInboundMessageContent()`、`isUnmaskedInbound()`；`readModelMessageContent()` 略過未遮罩訊息
- [x] 2.2 `deidentification-alert.ts`：`alertInboundUnmasked()`（`sendOpsAlert()`，告警失敗只記 log）
- [x] 2.3 `inbound-message-writer.ts`、`simulator.service.ts` 改用 `prepareInboundMessageContent()` 並發告警；`publishMessageReceived()` 與模擬器的 `message.received` 帶 `privacyUnmasked`
- [x] 2.4 `automation.worker.ts`：未遮罩訊息不呼叫 agent／知識庫，呼叫 `handOffAfterAiFailure()`；情緒分析不呼叫模型。`ai-failure-handoff.flow.ts` 接受固定原因與來源
- [x] 2.5 `ai-guard.ts` 的 `modelText()`、`classify.service.ts` 略過未遮罩訊息；`sentiment.service.ts` 加只用關鍵字的選項
- [x] 2.6 固定系統文字改用 `fixedSystemMessageContent()`：`inbound-postback-interceptors.ts`、`inbound-identity-binding.ts`、`csat.service.ts`（調查、評分後回覆）、`conversation.service.ts`（預設轉接訊息）
- [x] 2.7 `automation.worker.ts` 的 `checkAutoHandoff()`：轉接系統訊息遮罩失敗（去識別化失敗）時捨棄摘要、改用固定文字（design D7）

## 3. Mutation 驗證

- [x] 3.1 mutation 與失敗的測試（每次都以 `git checkout` 還原）：
  - M1 `prepareInboundMessageContent()` 不降級、照丟錯 → feature「去識別化服務回 503」「逾時」「網址解析失敗」「發出告警」「發出告警失敗」「轉接真人」「點按轉接人工」失敗
  - M2 拿掉重試 → feature「回 503」「逾時」「網址解析失敗」「重試一次成功」、單元「逾時之後重試一次成功」「兩次都逾時」失敗
  - M3 4xx 也重試 → 「去識別化服務回 400 不重試」失敗
  - M4 每次嘗試逾時改回 10 秒 → 「逾時之後重試一次成功」「兩次都逾時」失敗
  - M5 DNS 錯誤歸類成 `timeout` → 「去識別化服務的網址解析失敗」失敗
  - M6 拿掉 `TimeoutError`／`AbortError` 歸類 → 「去識別化服務逾時」失敗
  - M7 `message.received` 不帶 `privacyUnmasked` → 「回 503」「轉接真人」失敗
  - M8 worker 不看 `privacyUnmasked` → 「未遮罩的訊息轉接真人」失敗
  - M9 未遮罩分支不讓步關鍵字規則 → 「未遮罩的訊息命中關鍵字規則」失敗
  - M10 情緒分析忽略 `modelAllowed` → 「未遮罩的訊息的情緒分析」「命中關鍵字規則」失敗
  - M11 `readModelMessageContent()` 不略過 → 「對話紀錄有未遮罩的訊息」失敗
  - M12 `modelText()` 不略過 → 「對話紀錄有未遮罩的訊息」失敗
  - M13 自動分類不略過 → 「新工單最新的進站訊息未遮罩」失敗
  - M14 不發告警 → 「未遮罩的進站訊息發出告警」失敗
  - M15 告警失敗往外丟 → 「發出告警失敗」失敗
  - M16 按鈕轉接改回呼叫 2md → 「去識別化服務無法使用時客人點按轉接人工」失敗
  - M17 預設轉接訊息改回呼叫 2md → 「座席轉接時沒有填寫轉接訊息」失敗
  - M18 評分後回覆改回呼叫 2md → 「System template message keeps its authored text: CSAT follow-up」失敗
  - M19 滿意度調查改回呼叫 2md → 「去識別化服務無法使用時滿意度調查照常送出」失敗
  - M20 2md 正常時也標 `privacyUnmasked` → 「去識別化服務正常」「重試一次成功」失敗
  - M20b 2md 正常時多呼叫一次 → 「去識別化服務正常」失敗
  - M21 自動轉接遮罩失敗照丟錯 → 「去識別化服務無法使用時客人要求轉接真人」失敗
  - M22 `handOffAfterAiFailure()` 忽略固定原因 → 「未遮罩的訊息轉接真人」失敗
  - M23 綁定失敗提示改回呼叫 2md → 「去識別化服務無法使用時跨渠道綁定失敗」失敗

## 4. 完成定義

- [x] 4.1 `pnpm test`、api feature 全套、`check-tenant-scoping`／`check-prisma-admin-usage`／`check-tenant-ctx` 加 `--strict`、`feature-impact --check` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs fix-deid-inbound-fallback-466` 與 `--specs` 通過
- [x] 4.3 CHANGELOG、`docs/ref/features/`（KNOWLEDGE、INBOX、TENANTS、feature-map）、健檢文件（health/KNOWLEDGE 待真機驗）、skill（feature-knowledge、feature-inbox）更新。沒有對應的 AUDIT 項目，AUDIT.md／AUDIT-REVIEWS.md 不需更新
