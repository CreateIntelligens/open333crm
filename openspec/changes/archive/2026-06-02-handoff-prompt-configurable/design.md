## Context

`apps/api/src/modules/ai/kb-autoreply.service.ts:28` 有一個寫死的常數：
```ts
const HANDOFF_PROMPT = '需要真人客服協助嗎？請輸入「真人」或「客服」即可轉接。';
```

當 KB 比對到中等信心（similarity 0.5 ~ 0.8）的文章時（line 148/157），系統會把這段文字接在 LLM 生成回答的尾巴：
```ts
replyText = `${llmReply}\n\n${HANDOFF_PROMPT}`;
```

目前的「真人轉接」全靠關鍵字（`handoffKeywords` 預設 `['真人', '人工', '客服', '轉接']`），在 `apps/api/src/modules/automation/automation.worker.ts` 的 `checkAutoHandoff` 偵測使用者訊息字串。如果用戶不打這些字，就沒辦法轉接 — 文字提示本質上是「告訴用戶該打什麼」。

對老人家、長輩使用者來說，打字困難。從這次 LINE 對話截圖看到的問題：
1. KB 回答尾巴每句都有「請輸入...真人」一大段，視覺很冗
2. 有時 LLM 自己模仿（system prompt 內也提到「真人」），加 code 又串一份，同句出現兩次
3. 後台改不了 — 要改文案、要關掉、要按頻道差異化都得改 code

`Channel.settings.botConfig` 已存在類似可設定欄位（`handoffMessage`、`handoffKeywords`、`offlineGreeting`、`maxBotReplies`、`botMode`），這次直接擴充同一個 JSON、不動 schema。`BotConfigForm.tsx` 已有對應前端 UI，加 3 個欄位即可。

另一個既有設計範本：「👎 沒幫到我」回報按鈕（PR #125 剛完成）也是 quick reply postback + webhook 攔截 + 不觸發 automation 的模式，本次新功能完全可仿照。

## Goals / Non-Goals

**Goals:**
- 把 KB 回答尾巴的「需要真人客服協助嗎...」從寫死常數改為 `Channel.settings.botConfig` 內可設定
- 預設改用 quick reply 按鈕（一鍵點），減少老人家打字負擔
- 後台 `BotConfigForm` 可開關/換樣式/改按鈕文字
- 與既有「👎 沒幫到我」postback 機制保持一致（同樣的 webhook 攔截模式）
- 保留既有 `handoffKeywords` 路徑（用戶打字仍可轉接，舊有 muscle memory 不壞）

**Non-Goals:**
- 不改 LLM system prompt 內容（如果 LLM 自己生成「請輸入真人」、本 change 不負責修，是 prompt tuning 議題）
- 不改 `handoffMessage` 預設值（轉接成功後 bot 回的訊息）
- 不做「按 contact tier 動態決定 prompt 樣式」（一律走 channel 級設定）
- 不對 FB / WEBCHAT 做特殊處理（這次焦點是 LINE，但設計保留通用性 — quick reply 在 LINE 是按鈕、其他 channel 可能用 quick_reply contentType）
- 不改 prisma schema（沿用 Channel.settings JSON）

## Decisions

### 1. 設定存哪裡：`Channel.settings.botConfig` JSON
**選**：擴充既有 `botConfig` JSON、加 3 個欄位
**沒選**：新建 prisma 表 / 加 Channel 欄位

**理由**：
- botConfig 本來就是「bot 行為設定」的集中地（已有 botMode / handoffKeywords / handoffMessage / offlineGreeting / maxBotReplies），新欄位語意完全相容
- 無 migration、向後相容（既有 channel 缺欄位就走預設）
- 後台 BotConfigForm 已存在，加 UI 即可

### 2. 預設樣式：`button`（quick reply 按鈕）
**選**：預設 `handoffPromptStyle = 'button'`
**沒選**：預設 `'text'`（維持現狀）

**理由**：
- 老人家打字難、按鈕點一下就轉接是更好的 UX
- quick reply 已有現成 payload 結構（PR #125 quick reply preset / kb_feedback 都用同樣機制）
- 預設改變雖然是 behavioral change，但老的「請輸入真人」幫助不大、改了就改了

**取捨**：對已習慣「打真人」轉接的老用戶可能有一瞬不適應，但 `handoffKeywords` 仍存在 → 打字也仍會轉接。

### 3. Postback 命名：`handoff_request`
**選**：`handoff_request`（無 articleId / 無 conversationId）
**沒選**：`handoff:{conversationId}` 之類帶 ID

**理由**：
- 從 webhook 進來時已有 `conversation` 變數可用（PR #125 kb_feedback 攔截已驗證），不需從 postback data 反查
- 簡單、容易在 regex 一行 match：`/^handoff_request$/`
- 與 `kb_feedback:bad:...` / `csat:N:UUID` 同樣 prefix-based 風格

### 4. 轉接後行為：直接設 AGENT_HANDLED + 通知 SUPERVISOR
**選**：webhook 攔截 → `prisma.conversation.update({ status: 'AGENT_HANDLED' })` + bot 回 `handoffMessage` + 透過 eventBus 發 `conversation.handoff` 事件給 supervisor
**沒選**：把人工接手延後到第一個 supervisor 真的看到/接

**理由**：
- 與既有「使用者打『真人』關鍵字」的處理對齊（`checkAutoHandoff` 已做這事）
- 直接改狀態 = bot 停止介入、客服收到通知後可主動回覆
- 既有 `conversation.handoff` event 已有 notification.worker 訂閱者通知 supervisor

### 5. 提示樣式 4 選項：text / button / both / none
**選**：四值列舉
**沒選**：只兩值（on / off）

**理由**：
- `text`：保留舊行為（給已習慣的客戶）
- `button`：新預設（推薦）
- `both`：過渡期可用（文字 + 按鈕雙保險）
- `none`：完全關掉提示（用戶要轉接得自己打關鍵字）

### 6. 不動 LLM system prompt
**範圍切割**：本 change 只負責「code 串接的提示文字」這部分。LLM 自己生成的「請輸入真人」是 prompt engineering 議題（chat-settings 內可改），不在這次範圍。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| 預設改 `button` 是 behavioral change，老用戶 LINE 端突然看到按鈕可能困惑 | 按鈕文字明確「💬 轉接客服」即可。且 `handoffKeywords` 仍生效、打字仍會轉接 |
| LLM 自己生成「請輸入真人」造成重複（不在本 change 範圍） | 文件註明 follow-up，建議改 chat-settings 預設 prompt 加 「不要主動建議用戶打真人/客服」 |
| `handoff_request` postback 與 `csat:` / `kb_feedback:` 同樣靠 webhook 攔截，新 prefix 要避免與既有衝突 | `handoff_request` 全字嚴格匹配 `/^handoff_request$/`，前綴不撞 |
| `none` 模式下，使用者只能靠 `handoffKeywords`，老人家可能找不到轉接方式 | `none` 是進階選項、不是預設；後台 UI 提示「關閉後使用者需主動打『真人』才能轉接」 |
| Channel.settings JSON 加欄位無型別保護 — 寫錯欄位名 silent fallback 到預設 | `BotConfigForm` 是唯一寫入入口、UI 控制欄位名；BotConfig TS interface 集中定義 |
| `handoffPromptEnabled=false` 但 `handoffPromptStyle` 仍設值 → 行為以哪個為準？ | code 內 `enabled=false` 短路、不看 style |

## Migration Plan

**部署步驟**：純 application code 改動
1. Merge PR 到 main
2. Louis 部署 UAT：`git pull` + `docker compose up -d --build`（rebuild containers）
3. **不需** `prisma migrate deploy`（無 schema 變更）
4. **不需** 對既有 Channel 資料做 backfill — 缺欄位 fallback 預設

**Rollback**：直接 revert PR 即可。Channel.settings 內多出來的欄位無害（被忽略）。

**驗證**（部署後）：
- 後台 BotConfigForm 應出現「轉接真人提示」3 個新設定
- LINE 對話：KB 中等信心回答後應出現「💬 轉接客服」quick reply 按鈕
- 點按鈕 → bot 回 handoffMessage（例如「稍等，正在為您轉接客服人員」）→ DB conversation status 變 AGENT_HANDLED → SUPERVISOR 收到通知
- 改 botConfig 設 `handoffPromptStyle: 'none'` → 後續 KB 回答不再有提示

## Open Questions

- LLM system prompt 是否也要改？（建議另開 follow-up，非本 change 範圍）
- `both` 模式（文字 + 按鈕）是否實用？（保留選項，看後續使用率決定要不要砍）
