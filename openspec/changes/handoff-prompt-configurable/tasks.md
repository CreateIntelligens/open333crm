## 1. Backend — BotConfig 擴充

- [ ] 1.1 在 `apps/api/src/modules/automation/automation.worker.ts` 的 `BotConfig` interface 加 3 個欄位（`handoffPromptEnabled: boolean`、`handoffPromptStyle: 'text' | 'button' | 'both' | 'none'`、`handoffButtonLabel: string`）
- [ ] 1.2 `DEFAULT_BOT_CONFIG` 加對應預設值（`true` / `'button'` / `'💬 轉接客服'`）+ 新增 `DEFAULT_HANDOFF_PROMPT_TEXT` 常數（保留現有「需要真人客服協助嗎？...」文字當預設）
- [ ] 1.3 export `DEFAULT_HANDOFF_PROMPT_TEXT` 與 `BotConfig` type 供 kb-autoreply 使用

## 2. Backend — kb-autoreply 讀 botConfig

- [ ] 2.1 `apps/api/src/modules/ai/kb-autoreply.service.ts` 移除 `HANDOFF_PROMPT` 常數
- [ ] 2.2 在 `attemptKbAutoReply` 內取出 `conversation.channel.settings.botConfig`、合併預設後得到完整 `botConfig`
- [ ] 2.3 改寫 line 148 / 157 區段：依 `botConfig.handoffPromptEnabled` + `handoffPromptStyle` 決定 replyText 是否串文字（`text` / `both`）以及是否要在 deliverToChannel 帶 quick reply（`button` / `both`，postbackData = `'handoff_request'`、label = `botConfig.handoffButtonLabel`）
- [ ] 2.4 `kb_high_confidence` 路徑明確不附 handoff prompt（即使 botConfig 開）
- [ ] 2.5 在 `kb_high_confidence` 與 `kb_with_handoff` 兩條路徑共用一個 helper（如 `buildKbReplyPayload`）避免重複邏輯
- [ ] 2.6 確認 deliverToChannel 傳遞時，與既有「👎 沒幫到我」quick reply 在同一則訊息時，quickReplies 陣列合併正確（兩個按鈕並存）

## 3. Backend — webhook 攔截 handoff_request postback

- [ ] 3.1 `apps/api/src/modules/webhook/webhook.service.ts` 在 CSAT (5.) 與 kb_feedback (5b.) 攔截後加新區塊 5c. 攔截 `postbackData === 'handoff_request'`
- [ ] 3.2 取 `conversation.channel.settings.botConfig.handoffMessage`（已存在）作為回覆訊息（無設定 fallback 預設 `'稍等，正在為您轉接客服人員'`）
- [ ] 3.3 若 conversation 已是 `AGENT_HANDLED`：只回 handoffMessage、不重複改狀態、不重發 event（冪等）
- [ ] 3.4 若 conversation 是 `BOT_HANDLED`：`prisma.conversation.update({ status: 'AGENT_HANDLED', handoffReason: 'user_requested_handoff' })`、deliverToChannel(handoffMessage)、eventBus publish `conversation.handoff`（payload 含 conversationId / reason / previousStatus）
- [ ] 3.5 `return` 跳過 message.received（仿照 CSAT / kb_feedback 模式）

## 4. Frontend — BotConfigForm UI

- [ ] 4.1 `apps/web/src/components/settings/BotConfigForm.tsx` 加 state：`handoffPromptEnabled`、`handoffPromptStyle`、`handoffButtonLabel`
- [ ] 4.2 表單從 channel settings 載入時讀對應欄位（fallback 預設）、儲存時寫回 `botConfig.*`
- [ ] 4.3 新增 UI 區塊「轉接真人提示」：
  - Switch / checkbox：「在 KB 自動回覆下方提示可轉接真人」（綁 `handoffPromptEnabled`）
  - Radio group：「提示方式」（4 選項：純文字 / 快速回覆按鈕 / 兩者都要 / 關閉）（綁 `handoffPromptStyle`）
  - Text input：「按鈕文字」（綁 `handoffButtonLabel`，僅 `button`/`both` 時顯示）
- [ ] 4.4 `style === 'none'` 時 UI 顯示提示：「使用者仍可打『真人/客服』等關鍵字觸發轉接」

## 5. 驗證

- [ ] 5.1 typecheck：`pnpm --filter @open333crm/api exec tsc --noEmit && pnpm --filter @open333crm/web exec tsc --noEmit`
- [ ] 5.2 完整 build：`pnpm build`（12/12 packages 應全綠）
- [ ] 5.3 本機 dev 驗證：
  - 開 channel settings 看到 3 個新欄位、可儲存
  - 模擬 KB 中等信心回答（設定 `'button'` 模式 → 看到 quick reply、`'none'` → 沒提示、`'text'` → 文字、`'both'` → 兩者都有）
  - `handoffPromptEnabled: false` 時無論 style 為何都不附提示
- [ ] 5.4 LINE 端實測（部署 UAT 後）：
  - KB 命中 sim 0.5~0.8 訊息 → 看到「💬 轉接客服」quick reply
  - 點按鈕 → 收到 `botConfig.handoffMessage` → conversation 變 AGENT_HANDLED → supervisor 收到通知
  - 已是 AGENT_HANDLED 再點 → 不會重發 event（冪等）
  - 改 botConfig style: 'none' 後重新對話 → 回答後面不再有提示
  - 打「真人」關鍵字 → 仍正常轉接（既有 handoffKeywords 路徑保留）

## 6. 部署

- [ ] 6.1 commit + push feature branch + 開 PR
- [ ] 6.2 PR 描述含 BotConfig 新欄位列表與 migration notes（無 schema 變更、無 backfill 需求）
- [ ] 6.3 CI 過後 merge 到 main
- [ ] 6.4 Louis 部署 UAT（rebuild containers、不需 prisma migrate deploy）
