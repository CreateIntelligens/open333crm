## 1. 預設值

- [x] 1.1 測試先寫（`apps/api/tests/unit/config/env-agentic-llm.test.ts`）：「沒有設定 AGENTIC_LLM_ENABLED 時 Agent 關閉」「AGENTIC_LLM_ENABLED=true 時 Agent 開啟」。修改前第一個測試失敗在斷言上（`true !== false`）。
- [x] 1.2 實作：`env.ts` 的預設值改成 `false`；`.env.api.example` 改成 `false`；`deploy.yml` 每次部署把 UAT 的值設成 `false`。

## 2. 文件

- [x] 2.1 `docs/ref/features/tenant/KNOWLEDGE.md`、`docs/ref/features/tenant/INBOX.md` 寫明預設關閉與原因；`.claude/skills/feature-knowledge/SKILL.md` 同步。
- [x] 2.2 `docs/ref/system/AUDIT.md` 新增一項：Agent 沒有知識庫搜尋工具，開啟時知識庫回覆不執行。
- [x] 2.3 `CHANGELOG.md` 在 `## [2026-11-20]` 新增條目。

## 3. 完成定義

- [ ] 3.1 `pnpm test`、`pnpm --filter @open333crm/api test:feature` 中與 Agent、知識庫回覆有關的測試通過。
- [ ] 3.2 `node scripts/validate-openspec.mjs disable-agent-by-default`、`node scripts/check-doc-history.mjs --strict` 通過。
- [ ] 3.3 部署後在 UAT 確認 `open333crm-api` 容器的 `AGENTIC_LLM_ENABLED=false`，Demo WebChat 重跑 15 題。
- [ ] 3.4 3.3 完成後，以 `pnpm exec openspec archive` 歸檔。
