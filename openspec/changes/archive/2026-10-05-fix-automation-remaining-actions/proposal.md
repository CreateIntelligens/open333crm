## Why

AUDIT AUTO-01（issue #197）：`remove_tag`、`assign_bot`、`kb_auto_reply`、`llm_reply` 列在契約裡，但 workers 沒有實作。#209 起這 4 種存不進新規則，既有規則執行時只略過它們。

#197 的決定（2026-10-05）：

- `remove_tag` 補上實作。
- `assign_bot`、`kb_auto_reply`、`llm_reply` 從契約拿掉。機器人在負責的對話裡已經會用知識庫與 AI 自動回覆（`kb-autoreply.service.ts`），規則再觸發一次可能讓客人收到兩則回覆；`kb_auto_reply`、`llm_reply` 也依賴向量化，在 LLM-04 解決前無法運作。之後真的需要「由規則決定何時讓 AI 回覆」，再開新的 change 設計。

做完後「尚未支援的動作」清單沒有成員，整套機制（`UNSUPPORTED_AUTOMATION_ACTION_TYPES`、`allowUnsupportedActions`、`findUnsupportedAutomationActions`、列表的「含未支援的動作」標示）一併移除，AUTO-01 結案。

## What Changes

- workers 的 `remove_tag`：依 `tagId` 或名稱找本租戶 `CONTACT` scope 的標籤，移除聯絡人的這個標籤；找不到標籤時略過，**不建立**。
- 契約拿掉 `assign_bot`、`kb_auto_reply`、`llm_reply`；前端的舊選項清單與舊分支一併清掉。
- 移除「尚未支援的動作」機制。契約沒有定義的動作，存檔時以「不是系統提供的動作」拒絕。
- **行為改變（既有規則）**：含這 3 種動作的既有規則，workers 驗證失敗、**整條規則略過**（原本只略過這幾個動作），規則列表會標示「規則不會執行」。提供清理腳本 `apps/api/src/scripts/remove-retired-automation-actions.ts`（預設 dry-run，`--apply` 才寫入），把既有規則裡的這 3 種動作移除。
- 主規格 `ai-usage-recording` 中「自動化動作呼叫 LLM」的情境改寫：自動化規則目前沒有呼叫 LLM 的動作。

## Capabilities

### Modified Capabilities

- `automation-engine`：Actions、Rule Editor Loads Only Contract Actions、Rule List Marks Rules The Workers Skip。
- `ai-usage-recording`：呼叫來源標記與租戶隔離。

## Impact

- `packages/automation`（需重新 build）、`apps/workers`、`apps/api`（腳本、測試）、`apps/web` 規則列表與編輯頁
- 不需要 migration。
- 部署後在 UAT 先以 dry-run 執行清理腳本確認範圍，再決定是否 `--apply`（UAT 受影響的規則清單見 PR 說明）。
