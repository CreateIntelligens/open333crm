# 平台層 Usage 統計與計費儀表板 — 設計

> 承接平台層設計。這裡規劃「平台方看每個租戶的使用狀況」：AI token 用量與換算金額、訊息量、以及所有可統計的站台資料。
> **依 codebase 實查撰寫**——最關鍵發現：**AI token 目前 100% 沒記錄**（provider 介面層就丟棄），必須先補記錄工程；其餘用量/健康度指標多數已有資料源、且有現成彙總骨架可複用。

---

## 1. 現況盤點結論（決定什麼能做、什麼要先補）

### 🔴 最重要缺口：AI / LLM token 完全沒記錄
- `ChatProvider.generate()`（`modules/ai/providers/types.ts:32`）回傳 `Promise<string>`——介面層就沒有 usage。
- Ollama（`ollama.provider.ts`）：`prompt_eval_count`/`eval_count` 沒解析。
- Gemini（`gemini.provider.ts`）：`usageMetadata` 只在報錯路徑讀，成功路徑丟棄。
- embedding、suggest-reply、summarize、classify、KB 自動回覆——**全都沒落地 token / model / latency**。
- 計價基礎（`license.ts`）全是 mock，**無 token 單價**，訊息單價只有 Telegram 一個假值。
→ **token 計費必須先做「補記錄」前置工程**（§4）。

### 🟡 schema 就緒但零資料
- `ChannelUsage`（schema:350，欄位 `messageCount/feeAmount/feeCurrency` 為計費而設）——**沒有任何程式碼寫入**，唯一提及處是 mock stub（`services/message.ts:66`，且無 caller）。要用得補寫入。

### 🟢 現在就撈得到（可直接統計）
訊息量、對話量、案件量、CSAT、聯絡人數、自動化執行、短連結點擊、KB 文章/feedback、broadcast 送達、webhook 投遞、粉絲觸及——皆有 tenantId(或可 JOIN)+ createdAt。**且 `DailyStat` + `analytics.aggregator` + `aggregateAllTenants`（掃全租戶）骨架現成，可複用延伸。**

---

## 2. 三類統計指標

### 2.1 計費類（Billing）— 直接關係成本/收費

| 指標 | 資料源 | 現狀 |
|---|---|---|
| **LLM token（prompt / completion / total，依 provider+model）** | 新表 `AiUsage` | 🔴 須先補記錄 |
| **AI 換算金額** | `AiUsage` × 單價表 `AiModelPricing` | 🔴 全新（單價表 + 換算） |
| **embedding token** | `AiUsage`（callType=embedding） | 🔴 須補 |
| **渠道訊息費**（LINE/FB 推播按則） | `ChannelUsage.feeAmount` | 🟡 schema 就緒，須補寫入 |
| **broadcast 則數**（對 maxBroadcast 額度） | `Broadcast.totalSent` | 🟢 撈得到 |

### 2.2 用量類（Usage）— 活躍度、方案是否用滿

| 指標 | 資料源 | 現狀 |
|---|---|---|
| inbound / outbound / BOT 訊息數 | `Message` JOIN `Conversation` | 🟢（analytics 已有 SQL） |
| 對話數 / bot vs human | `Conversation` | 🟢 |
| 案件數 / 解決率 | `Case` | 🟢 |
| 聯絡人數 | `Contact` | 🟢 |
| 自動化執行次數 | `AutomationExecution` | 🟢 |
| broadcast 發送/送達 | `Broadcast` / `BroadcastRecipient` | 🟢 |
| 短連結點擊 | `ShortLink.totalClicks` | 🟢 |
| KB 文章數 / 👎 feedback | `KmArticle` / `KbArticleFeedback` | 🟢 |
| **AI 呼叫次數（依 callType）** | `AiUsage` | 🔴 隨 token 一起補 |
| 活躍 agent 數 vs 方案上限 | `Agent` + entitlement limits | 🟢 |

### 2.3 健康度類（Health）— 服務品質、異常偵測

| 指標 | 資料源 | 現狀 |
|---|---|---|
| **AI 成功率 / 平均延遲** | `AiUsage.success/latencyMs` | 🔴 須補 |
| SLA 達成率 | `Case`（analytics 已算） | 🟢 |
| CSAT 分數 | `Case.csatScore` | 🟢 |
| webhook 投遞成功率 | `WebhookDelivery.success` | 🟢 |
| 自動化失敗率 | `AutomationActionResult.status` | 🟢 |
| KB 命中率 / 👎 率 | `KbArticleFeedback` | 🟢 |

---

## 3. 資料模型（新增）

### 3.1 `AiUsage`（AI 呼叫逐次記錄 — 計費與健康度的核心）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid FK + index | 租戶隔離、統計主鍵 |
| `conversationId` | uuid? | 關聯來源（可選） |
| `callType` | string | `reply` / `summarize` / `classify` / `sentiment` / `kb_autoreply` / `embedding` |
| `provider` | string | `ollama` / `gemini` … |
| `model` | string | 實際使用的模型名 |
| `promptTokens` | int | |
| `completionTokens` | int | |
| `totalTokens` | int | |
| `latencyMs` | int | 呼叫延遲 |
| `success` | boolean | |
| `errorCode` | string? | 失敗原因 |
| `createdAt` | datetime + index | `@@index([tenantId, createdAt])` |

> 一次 AI 呼叫寫一列。這是「token 用量 + 呼叫次數 + 成功率 + 延遲」的單一事實來源，取代目前散落的 logger.error 與遺漏。

### 3.2 `AiModelPricing`（token 單價 — 平台全域）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `provider` | string | |
| `model` | string | |
| `promptPricePer1k` | decimal | 每 1k prompt token 單價 |
| `completionPricePer1k` | decimal | 每 1k completion token 單價 |
| `currency` | string | USD/TWD |
| `effectiveFrom` | datetime | 單價可有版本（改價不影響歷史換算） |

> 平台層全域表（無 tenantId）。金額 = Σ(promptTokens/1000 × promptPrice + completionTokens/1000 × completionPrice)，用當時生效的單價。Ollama 自架可設 0 或內部成本估算。

### 3.3 複用 `DailyStat`（新增 statType）

既有 `DailyStat`（`tenantId + date + statType + Json`）新增兩個 statType：
- `ai_usage`：每租戶每日 token 總量、各 model 分布、呼叫次數、換算金額、成功率、平均延遲。
- `channel_cost`：每租戶每日各渠道訊息數與費用。

由 `analytics.aggregator` 每日彙總（`aggregateAllTenants` 已掃全租戶），平台儀表板讀 `DailyStat` 即可，不必即時掃原始表。

---

## 4. 前置工程：補 AI token 記錄（token 計費的必要條件）

**這是整個 usage 統計最大、且必須最優先的工程項。** 順序：

1. **改 provider 介面**：`ChatProvider.generate()` 回傳從 `Promise<string>` 改為 `Promise<{ text: string, usage: { promptTokens, completionTokens, totalTokens }, model }>`。
2. **各 provider 解析 usage**：
   - Ollama：讀 `prompt_eval_count` / `eval_count`。
   - Gemini：成功路徑也讀 `usageMetadata`（現在只在報錯時讀）。
   - embedding.service：讀 embed 回應 token。
3. **量測延遲**：呼叫前後 `Date.now()` 夾（scripts 不可用，但這是 runtime service 可用）。
4. **落地 `AiUsage`**：在 `llm.service.generateReply`、`ai.service`（suggest/summarize/classify/sentiment）、`kb-autoreply.persistAndDeliver` 各呼叫點寫一列 `AiUsage`（帶 tenantId、callType、usage、latency、success）。
5. **接既有 credits**：`license.ts` 的 `llmTokens` 額度改成「查 AiUsage 加總」而非 mock 記憶體數字（順帶讓額度變真實）。

> 這條前置工程獨立於平台後台 UI，可先做（純後端 + 一張表），做完 token 資料就開始累積，之後才有東西可統計。**建議與租戶開通/entitlement 分開排，優先度高但可平行。**

---

## 5. 平台儀表板 UI（`/admin` 內新增分頁）

平台後台除了既有的 tenant/plan 設定，新增 usage 分頁：

### 5.1 跨租戶總覽
- 所有租戶的本月 token 用量 / 換算金額排行、訊息量排行、AI 成功率異常租戶警示。
- 平台總成本（Σ 各租戶 AI 金額 + 渠道費）。

### 5.2 單一租戶鑽取
- 選租戶 → 時間區間（日/週/月）：
  - **AI**：token 趨勢（prompt/completion 疊圖）、各 model 分布、換算金額、呼叫次數、成功率、延遲。
  - **訊息**：inbound/outbound/BOT 趨勢、各渠道分布、broadcast 量。
  - **業務量**：對話/案件/聯絡人/自動化執行趨勢。
  - **健康度**：SLA、CSAT、webhook 成功率、KB 👎 率。
  - **額度對照**：用量 vs 方案 limits（token 額度用了幾 %、broadcast 額度、agent 數上限）——與 entitlement 串起來，超量可提示升級。

### 5.3 資料呈現原則（沿用 dataviz 慣例）
- 金額類用 tabular-nums、明確幣別；趨勢用面積圖 + 強調端點；異常/超量用語意色（warning/danger）獨立於品牌色。
- 匯出：CSV（比照 analytics 既有 `/export`）。

---

## 6. API（平台側，superuser guard）

| method | path | 說明 |
|---|---|---|
| GET | `/admin/usage/overview` | 跨租戶總覽（本月排行、總成本、異常） |
| GET | `/admin/tenants/:id/usage` | 單租戶用量（區間、各類指標，讀 DailyStat） |
| GET | `/admin/tenants/:id/usage/ai` | AI 明細（token/model/金額/成功率） |
| GET | `/admin/usage/export` | CSV 匯出 |
| GET | `/admin/pricing` / PUT | AI 單價表維護 |

- 全掛 `requirePlatformSuperuser()`；跨租戶查詢屬授權例外，需標示 + 稽核。

---

## 7. 待拍板

- **AI 金額換算基準**：Ollama 自架無外部帳單——用「內部成本估算單價」還是「純顯示 token 量不換金額」？（建議：Ollama 可設估算單價供成本分析，Gemini 等外部 API 用真實單價。）
- **即時 vs 每日彙總**：儀表板讀 `DailyStat`（T+1）即可，還是要即時？建議日彙總為主、當日數即時查 `AiUsage`。
- **AiUsage 資料量**：高流量下逐次一列會長很快，需定保留策略（如原始列保留 90 天、之後只留 DailyStat 彙總）。
- **token 記錄前置工程的排程**：是否先於平台後台 UI 做（建議是——先讓資料開始累積）。
- **是否對租戶自己也開放看用量**：租戶 admin 能否在自己站台看 token/訊息用量（透明度/自助），還是只有平台方看？
