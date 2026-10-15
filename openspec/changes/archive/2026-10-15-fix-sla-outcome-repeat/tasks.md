## 1. SLA 結果去重

- [x] 1.1 測試：Breached case is scanned again on a later day（`apps/workers/tests/unit/handlers/sla-outcome-once.test.ts`）
- [x] 1.2 測試：Resolution deadline changes after a breach
- [x] 1.3 測試：Customer keeps waiting after an agent reply
- [x] 1.4 實作：`dispatchSlaOutcome` 改以期限、警告時間點或上次客服回覆為去重起點，取代 24 小時視窗

## 2. 文案

- [x] 2.1 測試：SLA 預設通知標題為中文
- [x] 2.2 實作：五種 SLA 預設通知標題與內容改中文；自動化通知動作的預設標題改中文

## 3. 收尾

- [x] 3.1 `CHANGELOG.md` 新增條目
- [x] 3.2 `node scripts/validate-openspec.mjs fix-sla-outcome-repeat` 通過
