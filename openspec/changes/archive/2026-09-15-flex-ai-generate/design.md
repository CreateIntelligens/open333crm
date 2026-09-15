## Context

- 階段 1（flex-template-fill）已把 Flex 編輯做成「範本填空」，body 存 LINE Flex JSON，並在 text 欄位留了「AI 潤稿」stub。
- LLM 基建齊：`apps/api/src/modules/ai/llm.service.ts`、`providers/gemini.provider.ts`、租戶 AI key（`ai-key.service.ts`）、token 額度硬擋（platform 控制平面）。
- Flex 驗證：`POST /materials/line-flex/validate` 實打 LINE API。

## Goals / Non-Goals

**Goals:**
- 一句話 → AI 產合法 Flex bubble 草稿 → 進填空編輯器微調。
- 填空內 AI 潤稿（改語氣/縮短）接上階段 1 stub。
- 產出經 LINE validate 保證合法，不合法能自我修正或退回範本。

**Non-Goals:**
- AI 生圖、多輪對話式修改、carousel 多卡生成、進階視覺編輯。

## Decisions

### D1. generateFlexFromPrompt 走既有 llm.service
- 系統提示明確要求「只輸出一個合法的 LINE Flex bubble JSON、不要額外文字」，附 1-2 個 few-shot（用現有 showcase sample 當範例）。
- 解析回應的 JSON（容錯：抓第一個 `{...}` 區塊、JSON.parse 失敗則重試一次）。
- 走租戶 AI key + token 額度（比照既有 AI 功能，不繞過額度硬擋）。

### D2. 產出必經 LINE validate
- 產出的 Flex 經 `validateLineFlexMessageWithLineApi`（既有）驗證。
- 不合法：回一次「請 AI 依錯誤修正」的重試（把 LINE 錯誤訊息餵回 prompt）；再不行則回錯誤，建議使用者改用範本。
- 保證進到填空編輯器的一定是合法 Flex（避免 aitago 那種預覽/實際脫節）。

### D3. AI 產出進「同一個填空編輯器」
- 產出 body 結構與範本一致（`{ contents, altText }`，無 sampleId 或標 `source:'ai'`）。
- extractFields 對 AI 產的 contents 一樣掃出欄位 → 進階段 1 的業務分組填空。使用者微調體驗與範本一致。

### D4. AI 潤稿端點
- `POST /ai/rewrite`（body: text, action: 'polish'|'shorten'|'tone'）→ llm.service 回改寫後文字。填空編輯器 text 欄位的潤稿鈕呼叫它。
- 輕量、單次，不做多輪。

## Risks / Trade-offs

- **AI 產出不合法/怪異**：靠 D2 的 LINE validate + 一次重試把關；仍失敗退回範本，不硬塞壞 JSON。
- **token 成本**：生成/潤稿都耗 token，走既有額度硬擋；prompt 盡量精簡 + few-shot 控制長度。
- **AI 產的結構可能超出填空能處理的複雜度**（巢狀很深）：系統提示限制「單 bubble、結構簡單、對應常見版型」，降低微調困難。
- **依賴租戶有設 AI key**：無 key 時此入口 disabled + 提示去設定（範本填空仍可用，不擋主線）。
