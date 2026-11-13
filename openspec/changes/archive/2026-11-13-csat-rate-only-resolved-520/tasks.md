## 1. 客人只能替已解決的工單評分（csat-survey）

- [x] 1.1 測試 `apps/api/tests/feature/modules/csat/csat-record-scope.test.ts`：「工單重開後客人點舊問卷」「逾時結案後客人點舊問卷」，在現有程式上斷言失敗（`recorded`：`true !== false`）
- [x] 1.2 `recordCsatScore()`：客人評分（不帶 `agentId`）時讀取與條件更新都要求 `status: 'RESOLVED'`
- [x] 1.3 測試「客服代評不限工單狀態」寫好就通過；mutation：條件更新對客服代評也要求 `RESOLVED` 時失敗，已還原
- [x] 1.4 CHANGELOG、`pnpm test`、`pnpm test:feature`、兩支 `--strict`、`validate-openspec`、`pnpm build`
