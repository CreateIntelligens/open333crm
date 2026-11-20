## Why

UAT 設定 `AGENTIC_LLM_ENABLED=true`。這個開關是 `true` 時，`automation.worker.ts` 先把每則客人的文字訊息交給 Agent。Agent 產生任何文字就算處理完成，系統不再呼叫知識庫回覆。Agent 的工具（網路搜尋、讀網頁、天氣、OCR、文件解析、Wiki）沒有知識庫搜尋，所以 Agent 只能回「查不到」、轉接，或者自己編造操作步驟。

2026-11-20 的 UAT 唯讀查詢：
- 全平台 `ai_usages` 的 `kb-autoreply` 筆數：2026-09 有 70 筆，2026-10 有 1 筆，2026-11 有 4 筆。`agent` 筆數：2026-10 有 141 筆。
- 創造智能最近 30 天：`agent` 68 筆，`kb-autoreply` 0 筆。
- Demo 租戶 WebChat 15 題實測：只有 3 題走到知識庫，3 題都是 Agent 呼叫失敗（`provider_error`）後才退回。其餘 12 題由 Agent 回答，其中 4 題編造了不存在的選單與步驟。

Agent 預設開啟是 commit `45dc9d766`（2026-09-15）加入的：`env.ts` 的預設值改成 `true`，`deploy.yml` 每次部署都把 UAT 的 `.env.api` 改成 `true`。

## What Changes

- `apps/api/src/config/env.ts`：`AGENTIC_LLM_ENABLED` 沒有設定時是 `false`。
- `.env.api.example`：`AGENTIC_LLM_ENABLED=false`，註解說明開啟後知識庫回覆不執行。
- `.github/workflows/deploy.yml`：每次部署把 UAT 的 `AGENTIC_LLM_ENABLED` 設成 `false`。原本這一步設成 `true`。
- 文件：`docs/ref/features/tenant/KNOWLEDGE.md`、`docs/ref/features/tenant/INBOX.md` 寫明預設關閉與原因。`docs/ref/system/AUDIT.md` 新增一項：Agent 沒有知識庫搜尋工具，開啟時知識庫回覆不執行。

Agent 的程式不改。`POST /ai/agent/run` 在開關關閉時回錯誤，這是現有的行為。A2A bridge 由 `A2A_BRIDGE_ENABLED` 控制，不受影響。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `agentic-llm-orchestration`：新增「Agent 預設關閉」需求。

## Platform layer

這個 change 不新增權限、功能區、方案上限、渠道類型、平台稽核動作或佇列，也不新增 AI 呼叫：它讓客人訊息回到現有的知識庫回覆，知識庫回覆已經記錄用量、檢查月額度與隱私政策。開關仍是部署層級的環境變數，不新增平台頁面。

## Impact

- 部署後所有租戶的機器人回到知識庫回覆，包括創造智能的正式客戶。知識庫查不到時，回覆照各租戶的 prompt 設定（例如請客人留下聯絡方式，或轉接真人）。
- 回復方式：把 `deploy.yml` 的這一步改回 `true`。
