## Why

Issue #405：API 入口有多處以 `z.record(z.unknown())` 接收 JSON 欄位，只檢查「是物件」，裡面的欄位與型別都不檢查；
讀取的程式再以 `as` 轉型，執行時不擋任何值。這個 change 先處理兩個會造成錯誤結果的欄位：

1. **渠道的機器人設定 `settings.botConfig`**。入口只檢查 `maxBotReplies`，其他欄位任何值都存得進去，讀取時
   `getBotConfig()` 以 `{ ...DEFAULT_BOT_CONFIG, ...raw }` 合併、不檢查型別：
   - `handoffKeywords` 含空字串 `['']` 時，`'任何文字'.includes('')` 恆為 true，**每則訊息都自動轉接真人**；
     是字串 `"真人,客服"` 時以 `for...of` 逐字比對，含「真」「客」的訊息都會轉接；含數字時 `keyword.toLowerCase()`
     丟例外，整個 `message.received` 處理失敗。
   - `handoffPromptEnabled` 是字串 `"false"` 時被當成 true。
   - `maxBotReplies` 舊資料是 `null` 時，`botRepliesCount >= null` 恆為 true，第一則訊息就轉接。
   - `handoffMessage` 是物件或空字串時，轉接訊息送不出去。
2. **自動化規則動作的文字參數 `actions[].params`**。契約驗證只檢查必填與下拉選項，`send_message` 的 `text`
   是物件時，workers 以 `String(params.text)` 送出 `[object Object]` 給客人；`tagName`、`agentId` 是數字時，
   寫入或查詢失敗、只寫 log。

## What Changes

- 新增 `botConfigSchema`（`packages/automation/src/bot-config.ts`，Zod）定義 `botConfig` 每個欄位的型別與範圍；
  `getBotConfig()` 以同一份定義逐欄讀取，不合法的欄位改用預設值，不丟例外。
  `kb-autoreply.service.ts` 的 `resolveBotConfig()` 與 webhook 的 `getBotConfig()` 改用它，不再各自轉型。
- 建立渠道時，`settings.botConfig` 不符合 `botConfigSchema` 回 400 `VALIDATION_ERROR`。
- 更新渠道時，**只有送出的 `botConfig` 與已存的不同**才檢查，不符合時回 400 `VALIDATION_ERROR`，渠道不變。
  原因：Downstream Webhook 設定視窗會把整包 `settings` 原樣送回，舊資料不合法時不能擋住其他設定的修改
  （G04 之前已有存進 9999 的 `maxBotReplies`）。`maxBotReplies` 的檢查從路由移到同一個地方。
- 自動化規則契約驗證：`string`、`textarea`、`agent`、`material`、`coupon` 型別的參數有值時必須是字串，
  `number` 必須是數字、`boolean` 必須是布林，否則回 400。契約驗證也是 workers 判斷要不要執行規則的依據，
  所以舊規則有這種參數時 workers 改為略過（原本會送出 `[object Object]` 或失敗）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `channel-management`：修改「Bot 最大回覆次數的範圍」（更新時只在 botConfig 改變時檢查）；
  新增「機器人設定欄位的型別與範圍」。
- `bot-handoff-config`：新增「讀取機器人設定時不合法的值改用預設值」。
- `automation-contract-composer`：修改「Contract Compatibility Validation」（文字參數必須是字串）。

## Platform layer

本 change 只收緊既有欄位的輸入驗證與讀取，沒有新增權限碼、功能模組、方案上限、AI 呼叫、渠道類型、租戶設定、
平台稽核動作、佇列或租戶與平台之間的申請，AGENTS.md 表格的各列都不適用。

## 不在本 change 的範圍

issue #405 其餘位置另開 change 處理（canvas 節點 `config`、素材 `body`、訪客訊息 `payload`、MCP 工具 `content`、
渠道 `credentials`、自動化測試用的 `facts`、WebAuthn `clientExtensionResults`）。原因見 design.md「範圍」。

## Impact

- `packages/automation/src/bot-config.ts`、`packages/automation/src/contracts/validation.ts`、`packages/automation/package.json`（加 `zod`）
- `apps/api/src/modules/channel/channel.routes.ts`、`channel.service.ts`
- `apps/api/src/modules/ai/kb-autoreply.service.ts`、`apps/api/src/modules/webhook/inbound-message.types.ts`
- 原本存得進去的值會回 400（API 呼叫端可見）；後台表單送出的值不受影響。
