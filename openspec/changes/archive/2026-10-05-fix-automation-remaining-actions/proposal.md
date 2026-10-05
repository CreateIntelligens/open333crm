## Why

AUDIT AUTO-01（issue #197）：`remove_tag`、`assign_bot`、`kb_auto_reply`、`llm_reply` 列在契約裡，但 workers 沒有實作。#209 起這 4 種存不進新規則，既有規則執行時只略過它們。

#197 的決定（2026-10-05）：

- `remove_tag` 補上實作。
- `assign_bot`、`kb_auto_reply`、`llm_reply` 從契約拿掉。機器人在負責的對話裡已經會用知識庫與 AI 自動回覆（`kb-autoreply.service.ts`），規則再觸發一次可能讓客人收到兩則回覆；`kb_auto_reply`、`llm_reply` 也依賴向量化，在 LLM-04 解決前無法運作。之後真的需要「由規則決定何時讓 AI 回覆」，再開新的 change 設計。

做完後「尚未支援的動作」清單沒有成員，整套機制（`UNSUPPORTED_AUTOMATION_ACTION_TYPES`、`allowUnsupportedActions`、`findUnsupportedAutomationActions`、列表的「含未支援的動作」標示）一併移除，AUTO-01 結案。

## What Changes

- workers 的 `remove_tag`：刪除聯絡人身上、本租戶、`tagId` 或名稱相符的標籤，不限 scope（和 `add_tag` 對稱：`add_tag` 依名稱找標籤時不分 scope，它貼上的標籤要能移除）；找不到時什麼都不做，**不建立**標籤。
- 契約拿掉 `assign_bot`、`kb_auto_reply`、`llm_reply`；前端的舊選項清單與舊分支一併清掉。
- 移除「尚未支援的動作」機制。契約以 `RETIRED_AUTOMATION_ACTIONS` 保留這 3 種動作的中文名稱：存檔時以「第 N 個動作「LLM 智能回覆」已停用，請刪除」拒絕，編輯頁列出「LLM 智能回覆（已停用）」。
- **既有規則**：含這 3 種動作的規則，契約驗證會失敗、workers 整條略過（原本只略過這幾個動作）。為了不留空窗，以 Prisma 資料 migration `20261005100000_remove_retired_automation_actions` 在部署時一併清理：還有其他動作的規則移除這 3 種動作、繼續執行；只有這 3 種動作的規則停用、動作保留原樣。
- 主規格 `ai-usage-recording` 中「自動化動作呼叫 LLM」的情境改寫：自動化規則目前沒有呼叫 LLM 的動作。

## Capabilities

### Modified Capabilities

- `automation-engine`：Actions、Rule Editor Loads Only Contract Actions、Rule List Marks Rules The Workers Skip。
- `ai-usage-recording`：呼叫來源標記與租戶隔離。

## Impact

- `packages/automation`（需重新 build）、`apps/workers`、`apps/api`（腳本、測試）、`apps/web` 規則列表與編輯頁
- 新增資料 migration（只動 `automation_rules` 的 `actions`、`isActive`、`updatedAt`，可重複執行）。`automation_rules` 開了 FORCE RLS，migration 以 owner 執行（UAT 的 `MIGRATE_DATABASE_URL` 為 superuser，具 BYPASSRLS）。
- UAT 受影響的規則只有 2 條，都已刪除（清單見 PR 說明）。
