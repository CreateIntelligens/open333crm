## Why

docs/ref/system/AUDIT.md AUTO-01（issue #197）：2026-05 自動化執行搬到 `apps/workers` 時，`create_case`、`remove_tag`、`assign_bot`、`kb_auto_reply`、`llm_reply` 五種動作沒有搬過去。規則可以存檔、條件也會命中，workers 卻只記一行 info log 就略過，租戶以為規則有效。UAT 有 6 條規則用到（全在 Demo Tenant），其中「一般問題自動開案」啟用中、從未真的開過工單。

與後端 RD 的共識（#197）：降為 P2，先在規則驗證時擋下，之後再視需要補實作。

## What Changes

- 契約 `UNSUPPORTED_AUTOMATION_ACTION_TYPES` 標出這 5 種動作：
  - 規則編輯器不再提供（composer 預設排除）。
  - 新增或修改規則時拒絕，訊息寫明是哪個動作「目前尚未支援自動執行」。
  - workers 執行既有規則時以 `allowUnsupportedActions` 照常通過驗證，其他動作照常執行，只跳過這幾個（log 由 info 改為 warn）。若沒有這個選項，含這些動作的既有規則會整條被跳過。
- 前端：規則列表在含這些動作的規則旁標示「含未支援的動作」；編輯頁說明哪些動作不會執行、儲存時會被移除。
- 更新規則時只有改到觸發、條件或動作才驗證契約（同 PR #124）：否則含這些動作的既有規則連停用都會被擋。
- 契約驗證錯誤訊息開頭改為中文。
- 編輯頁載入既有規則時直接濾掉這些動作（`lib/automation/rule-actions.ts`），儲存時不會被後端拒絕，與提示一致。
- 刪除 API 端沒有呼叫端的 `modules/automation/engine/action-executor.ts`。

## Capabilities

### Modified Capabilities

- `automation-engine`：拒絕 workers 尚未支援的動作。

## Impact

- `packages/automation`（需重新 build）、`apps/workers`、`apps/api/src/modules/automation`、`apps/web` 規則列表與編輯頁
- 不需要 migration；既有規則資料不變。
- 已知取捨：只改啟用狀態時不驗證契約，所以條件已不合現行契約的舊規則也能被重新啟用；workers 執行時會整條跳過並留 warn。換來的是管理員一定能停用不合規的規則。
- 另發現（不在本次範圍）：`notify` 只在有負責人時執行，訊息類事件常沒有負責人而被跳過，屬部分支援，另行追蹤。
