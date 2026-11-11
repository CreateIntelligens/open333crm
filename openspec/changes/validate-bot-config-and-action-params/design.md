## Context

`portal-settings.ts`（PR #404）的寫法：以 Zod 定義欄位的型別與範圍，入口驗證新值，service 以同一份定義讀取舊值，
不合法時採用安全的預設值。本 change 把同樣的寫法套到 `Channel.settings.botConfig`，並在自動化規則的契約驗證補上
參數型別。

## 前端實際送出的值（收緊前盤點）

### botConfig

只有 `apps/web/src/components/settings/BotConfigForm.tsx` 的 `handleSave()` 寫入 `botConfig`
（`PATCH /channels/:id`，`settings: { ...existingSettings, botConfig, liffConfig, firstContactGreeting }`），
每次送出完整的 8 個鍵：

| 鍵 | 前端的值 |
| -- | -------- |
| `botMode` | 下拉 4 選 1：`keyword_then_llm`、`llm`、`keyword`、`off` |
| `maxBotReplies` | `parseInt(輸入) \|\| 5`，輸入框 1～50（可手動輸入範圍外的值，路由已擋，G04） |
| `handoffKeywords` | 字串陣列，每個都 `trim()` 過且不空白、不重複；可以是空陣列 |
| `handoffMessage` | textarea 字串，**可以是空字串** |
| `offlineGreeting` | 非空字串，或 `undefined`（JSON 不送出這個鍵） |
| `handoffPromptEnabled` | 布林 |
| `handoffPromptStyle` | 下拉 4 選 1：`button`、`text`、`both`、`none` |
| `handoffButtonLabel` | `trim()` 過的字串，空白時改用 `'💬 轉接客服'`；輸入框 `maxLength={20}` |

其他會送出 `settings` 的地方：`DownstreamWebhookDialog.tsx` 把 `existingSettings`（含已存的 `botConfig`）原樣送回；
`ChannelFormDialog.tsx` 建立與編輯都不送 `settings`；`ChannelManagement.tsx` 的背景主題走 `/chatbox-theme`。
CLI 與 MCP 沒有寫 `botConfig` 的工具。

### 自動化動作參數

`apps/web/src/components/automation/ActionEditor.tsx` 的每個輸入都是 `e.target.value` 或下拉值（字串）；
`useKeywordReplies.ts` 送 `materialId`、`couponId`、`failureText`（字串），`useFollowGift.ts` 送 `couponId`、
`failureText`（字串）。本機資料庫既有規則的參數全部是字串（`add_tag.tagName`、`assign_agent.agentId`、
`create_case.title/priority`、`notify_supervisor.message`、`send_message.text`）。

## Decisions

### D1：botConfig 的定義放在 `@open333crm/automation`

`getBotConfig()` 已在這個套件，api 的自動化訂閱者、AI 失敗轉接共用。定義放在同一個檔案，入口（channel 模組）與讀取
共用。套件加上 `zod` 依賴（與 api 相同版本，使用 `zod/v3`）。web 也打包這個套件，`zod` 可在瀏覽器執行，
`browser-safe.test.ts` 的限制不受影響。

### D2：欄位規則

| 鍵 | 入口（有值時） | 讀取（不合法時） |
| -- | -------------- | ---------------- |
| `botMode` | 4 選 1 | 預設 `keyword_then_llm` |
| `maxBotReplies` | 1～50 的整數 | 預設 5 |
| `handoffKeywords` | 陣列，每個元素是不空白的字串 | 不是陣列：預設關鍵字；是陣列：只留下不空白的字串 |
| `handoffMessage` | 字串（可空白，前端會送） | 不是字串或空白：預設轉接訊息 |
| `offlineGreeting` | 字串 | 不是字串或空白：沒有 |
| `handoffPromptEnabled` | 布林 | 預設 true |
| `handoffPromptStyle` | 4 選 1 | 預設 `button` |
| `handoffButtonLabel` | 字串，最多 20 字（與前端 `maxLength` 相同） | 不是字串或空白：預設標籤 |

`botConfig` 本身必須是物件（`null` 視為沒有設定，允許）。其他鍵照舊接受、原樣存放（`.passthrough()`），
因為程式不讀它們，改成 strict 會讓存了其他鍵的既有渠道無法編輯。`handoffKeywords` 讀取時只過濾、不整個換成預設，
是為了保住管理員設定的其他關鍵字；空字串一定要去掉，否則每則訊息都會轉接。

### D3：更新渠道只在 botConfig 改變時檢查

更新時在 `updateChannel()` 比較送出的 `botConfig` 與資料庫已存的（深度比較，與鍵的順序無關）。相同就不檢查，
不同才以 `botConfigSchema` 檢查。原因是 Downstream Webhook 設定視窗把整包 `settings` 送回，舊資料不合法時，
若在路由檢查，管理員改 Downstream Webhook 也會收到 400，錯誤卻指向機器人設定。建立渠道沒有舊值，仍在路由檢查。

錯誤回 `AppError('機器人設定有誤：…', 'VALIDATION_ERROR', 400, { issues: [{ path, message }] })`，
`details.issues` 的格式與路由的 Zod 錯誤相同（`path` 如 `settings.botConfig.handoffKeywords.0`）。

`maxBotReplies` 原本在路由以 `superRefine` 檢查，移到同一處；更新時舊值 9999 原樣送回不再被擋，改了任何
botConfig 欄位才檢查。這是放寬，不違反「Bot 最大回覆次數的範圍」的情境（新值仍被擋）。

### D4：所有讀 botConfig 的地方用同一個 `getBotConfig()`

- `kb-autoreply.service.ts` 的 `resolveBotConfig()` 刪除，改用 `getBotConfig()`（原本只修正了 `handoffPromptStyle`、
  `handoffButtonLabel` 兩個欄位）。
- webhook 的 `getBotConfig(ctx)`（`inbound-message.types.ts`）原本回傳未檢查的 `Record<string, unknown>`，
  改為回傳 `getBotConfig()` 的結果；呼叫端的 `as string` 與 `|| 預設值` 一併拿掉。
- `chatbox.service.ts`、`conversation.service.ts` 只比較 `botMode === 'off'`，任何型別都不會出錯，不改。

### D5：自動化參數型別放在契約驗證

契約（`AUTOMATION_ACTION_DEFINITIONS`）已經以 `param.type` 描述每個參數，型別檢查放在同一處的
`validateActionParams()`，入口（`automation.service.ts`）、workers（`automation.handler.ts`）、web 規則列表
（`rule-actions.ts`）都用它。契約沒有列出的參數（例如 `send_material` 的 `variables`）不檢查，照舊存放。

取捨：workers 對不合契約的規則整條略過並記 log，所以既有規則若有非字串的文字參數，改為略過。這種值只能由
API 直接寫入；原本的結果是送出 `[object Object]`、數字變字串送出，或寫入失敗。

## 範圍

issue #405 其餘位置暫不處理，原因：

| 位置 | 原因 |
| ---- | ---- |
| canvas 節點 `config`、`triggerConfig`、`vars` | 依 `nodeType` 有 7 種結構，要先盤點 Canvas 引擎每種節點讀哪些欄位；Canvas 引擎本身還有 AUDIT RLS-01 待處理 |
| 素材 `body` | 依版型有多種結構；LINE 版型存檔時已呼叫 LINE validate API，FB 版型有 `fb-material-validation.ts` |
| 送出訊息 `content` | 已有 `superRefine` 呼叫 `validateOutboundMessage()` |
| 訪客訊息 `payload`（chatbox、webchat） | 公開端點，`type` 已限制；要盤點 widget 每種訊息送出的鍵 |
| MCP 工具 `content` | 要盤點 MCP 工具的呼叫端 |
| 渠道 `credentials`（WEBCHAT） | 加密後存放，LINE／FB／IG 已有 schema；WEBCHAT 不讀憑證 |
| 自動化 `facts` | 只用於試跑，不存放 |
| WebAuthn `clientExtensionResults` | 由瀏覽器依規格產生，交給 `@simplewebauthn/server` 驗證 |

## Risks

- UAT 可能已有不合法的 `botConfig`：讀取改用預設值（不丟例外）；更新時原樣送回不擋（D3）。部署前可用
  `SELECT id, settings->'botConfig' FROM channels WHERE settings ? 'botConfig'` 查看。
- 本機資料庫沒有任何渠道存了 `botConfig`，無法以本機資料確認 UAT 的舊值。
