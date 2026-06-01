## Why

目前 LINE bot KB 自動回覆會在「中等信心」（KB similarity 0.5 ~ 0.8）的回答尾巴硬接一段文字：「需要真人客服協助嗎？請輸入「真人」或「客服」即可轉接。」（`HANDOFF_PROMPT` 常數，寫死在 `apps/api/src/modules/ai/kb-autoreply.service.ts:28`）。實際使用上有三個問題：

1. **不可由後台設定**：要改文案、要關掉、要換 channel 設定都得改 code 重部署
2. **使用者體驗差**：每句訊息結尾都有這段「請輸入...」很冗長，老人家根本不會打字觸發
3. **常被 LLM 重複生成**：system prompt 也提到「需要真人客服...」，LLM 學樣回覆，加上 code 又串一份，同句出現兩次

合理改進：把這段提示變成可設定（文字 / 快速回覆按鈕 / 關閉），預設改用 quick reply 按鈕（用戶一鍵點即可），與既有「👎 沒幫到我」回報按鈕同模式。

## What Changes

- 在 `Channel.settings.botConfig` 加 3 個欄位（後台可改、無需 schema migration）：
  - `handoffPromptEnabled` (boolean, 預設 `true`)：是否在 KB 回答附 handoff 提示
  - `handoffPromptStyle` (`'text' | 'button' | 'both' | 'none'`, 預設 `'button'`)：提示形式
  - `handoffButtonLabel` (string, 預設 `'💬 轉接客服'`)：按鈕文字
- `kb-autoreply.service.ts` 讀 `botConfig` 決定要不要串文字 / 加 quick reply 按鈕，**移除硬寫的 `HANDOFF_PROMPT`**（改成 botConfig 預設值）
- `webhook.service.ts` 攔截新 postback `handoff_request` → 設 conversation `AGENT_HANDLED` + 回確認訊息 + 通知所有 SUPERVISOR/ADMIN（仿照既有 `kb_feedback` 攔截模式）
- `BotConfigForm.tsx` 加對應 UI（開關 + style 選項 + 按鈕文字 input）
- 既有的關鍵字轉接（`handoffKeywords`）路徑**保留不變**（使用者打「真人」「客服」「轉接」仍可手動觸發）

## Capabilities

### New Capabilities
- `bot-handoff-config`: bot 自動回覆轉接真人客服的提示設定（什麼時候提示、用什麼形式提示、按鈕點擊後的處理流程）

### Modified Capabilities
（無 — 既有 spec 中沒有定義過 KB auto-reply 的 handoff prompt 行為，這是新增 capability）

## Impact

**程式碼**
- 後端：`apps/api/src/modules/ai/kb-autoreply.service.ts`（移除硬寫常數、讀 botConfig）、`apps/api/src/modules/webhook/webhook.service.ts`（加新 postback 攔截）、`apps/api/src/modules/automation/automation.worker.ts`（BotConfig interface 加 3 欄位 + DEFAULT_BOT_CONFIG）
- 前端：`apps/web/src/components/settings/BotConfigForm.tsx`（加 3 個設定 UI）

**資料庫**：無 schema 變更（沿用 `Channel.settings` JSON 欄位、向後相容）

**API**：無新 endpoint（沿用既有 channel settings 更新路徑）

**外部依賴**：無

**部署影響**：純 application code 改動，部署只需 rebuild containers、不需跑 migration。既有 channel 若無設定值，會 fallback 到新預設（`button` 模式 + `💬 轉接客服` 文字），行為改變但不會壞。

**相容性**：保留既有 `handoffKeywords` 觸發路徑，使用者打「真人」「客服」仍會轉接；只是視覺上多/少了 KB 回答後面的提示。
