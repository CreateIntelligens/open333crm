## 1. 型號守門只攔截知識庫型號格式的型號

- [x] 1.1 測試 `apps/api/tests/unit/modules/ai/model-matcher.test.ts`：「型號偵測不命中一般英文詞」（`Wi-Fi`、`e-mail`、`T-shirt`、大寫英文詞、`tac-11p` 不命中；真實型號各命中一個）與 `hasKnownPrefix`。在現有程式上一般英文詞與小寫詞的案例斷言失敗（偵測到 `WI-FI`、`E-MAIL`…），真實型號案例通過
- [x] 1.2 測試 `apps/api/tests/unit/modules/ai/kb-model-guard.test.ts`（經 workers `message.received`，真的 `attemptKbAutoReply`，LLM 與檢索換假的）：「一般英文詞不當成型號」「小寫的型號格式不當成型號」「知識庫沒有型號文章時不守門」「前綴不在白名單的編號不守門」在現有程式上斷言失敗（回覆類型為 `model_not_found`）；「查無的型號仍引導選型號」寫好就通過（既有行為）
- [x] 1.3 `model-matcher.ts`：正規式拿掉 `i` 旗標、排除常見英文詞（清單沿用 `packages/kb-ingest` 的停用詞，加 `T-SHIRT`）、新增 `hasKnownPrefix()`；`checkModelGuard()` 略過前綴不在白名單的型號
- [x] 1.4 突變驗證：拿掉 `checkModelGuard()` 的 `hasKnownPrefix` 判斷時，「知識庫沒有型號文章時不守門」「前綴不在白名單的編號不守門」失敗；「查無的型號仍引導選型號」在 1.3 之後仍通過

## 2. 型號守門回覆計入追問次數

- [x] 2.1 測試 `kb-model-guard.test.ts`：「型號守門回覆累加追問次數」「型號守門時追問次數已用完」「客人一直提到查無的型號」在現有程式上斷言失敗（追問次數不變、命中守門時不轉接）
- [x] 2.2 `kb-autoreply.service.ts`：追問次數在守門前算好；守門回覆寫 `clarifyAttempts + 1`；命中守門且次數已用完時走既有的 `clarify_handoff` 路徑（`clarifyExhaustedReason()`、`persistAndDeliver` 的 `handOffConversation()`），不另寫轉接
- [x] 2.3 突變驗證：守門回覆不寫 `clarifyAttempts` 時「型號守門回覆累加追問次數」「客人一直提到查無的型號」失敗；用完時仍走守門（拿掉 `!clarifyExhausted`）時「型號守門時追問次數已用完」「客人一直提到查無的型號」失敗
- [x] 2.4 既有 `kb-clarify-handoff.test.ts`（#419 的追問用完轉接）照常通過

## 3. 完成定義

- [x] 3.1 受影響的 unit 測試（`tests/unit/modules/ai`、`automation`、`knowledge`）與 `tsc --noEmit`（api）
- [x] 3.2 feature 測試 `handoff-flow.test.ts` 以獨立測試庫（`TEST_DATABASE_NAME=open333crm_test_p4_420`）執行
- [x] 3.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 皆 `--strict` 通過
- [x] 3.4 更新 `docs/ref/system/AUDIT.md` KB-02、`AUDIT-REVIEWS.md`、`docs/ref/features/health/KNOWLEDGE.md`、`docs/ref/features/tenant/KNOWLEDGE.md`、`.claude/skills/feature-knowledge/SKILL.md` 回歸清單、`CHANGELOG.md`
