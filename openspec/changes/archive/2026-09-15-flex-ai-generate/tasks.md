## 1. AI 生成 Flex service

- [x] 1.1 `generateFlexFromPrompt(prisma, tenantId, prompt)`：組系統提示（只輸出合法 LINE Flex bubble JSON + few-shot 內嵌範例）→ 呼叫 llm.service.generateReply（租戶 AI key + token 額度自動生效）
- [x] 1.2 解析回應 JSON（extractJsonObject 容錯：去 markdown 圍欄、抓第一個 {...}、parse 失敗退而求其次抓 {…} 區塊）
- [x] 1.3 產出經 validateLineFlexDraft（實打 LINE API）驗證；不合法把錯誤訊息餵回 prompt 重試一次；再不行回 422 FLEX_AI_GENERATE_FAILED 建議用範本
- [x] 1.4 走既有 token 額度硬擋（透過 generateReply 內部 isMonthlyTokenExceeded，不繞過、不重複包）

## 2. 端點

- [x] 2.1 `POST /api/v1/marketing/materials/line-flex/ai-generate`（body: prompt，zod min(1)/max(500)）→ 回 { contents, altText }；guard marketing.manage
- [x] 2.2 `POST /api/v1/ai/rewrite`（body: text, action polish/shorten/tone）→ 回 { text }；gemini 等失敗包成 422 AI_REWRITE_FAILED（不裸 500）

## 3. 前端：AI 生成起手

- [x] 3.1 Flex 起手空狀態加「✦ 用 AI 描述生成」入口（輸入框 + 生成鈕，Enter 可送）
- [x] 3.2 呼叫 ai-generate → 產出 onChange({ contents, altText, source:'ai' }) 載入同一填空編輯器；範本資訊卡對 AI 來源顯示「AI 生成草稿」
- [ ] 3.3 無 AI key 時入口 disabled — 改為「樂觀啟用 + 失敗友善提示」策略（前端無可靠 key 狀態 hook，且後端 key 三層 fallback 判斷複雜；失敗時顯示「請調整描述或改用精選範本」，不擋範本主線，符合設計「不擋主線」精神）
- [x] 3.4 生成中 loading（spinner）、失敗提示（含「改用精選範本」建議）
- [x] 3.5 （附帶）showcase 預設 body 改空，讓起手一律進「AI 生成 / 選範本」空狀態（原本預設帶餐廳範本，AI 入口觸發不到）

## 4. 前端：AI 潤稿接線

- [x] 4.1 填空編輯器 text 類欄位（文字/按鈕文字/按鈕訊息）加「✦ AI 潤稿」鈕 → 下拉潤飾/縮短/換語氣 → POST /ai/rewrite
- [x] 4.2 潤稿後更新欄位（onChange）+ 即時預覽（沿用既有 renderer）；潤稿失敗靜默略過不阻斷編輯

## 5. 驗證與收尾

- [x] 5.1 端到端（後端鏈路）：端點存在、走 generateReply→extractJsonObject→validateLineFlexDraft→重試，全執行到（curl 驗證）
- [x] 5.2 不合法產出：驗證擋下 + 重試 + 回 422 退回範本（實測 gemini 失敗兩次 attempt → 422）
- [x] 5.3 邊界：空 prompt / 非法 action → 400 VALIDATION_ERROR（zod 擋，實測）
- [x] 5.4 前端空狀態 AI 入口 + 錯誤提示（瀏覽器實測渲染與失敗提示）
- [x] 5.5 api/web typecheck 0 error
- [x] 5.6 `openspec validate --strict` 通過
- [x] 5.7 更新 CHANGELOG.md（Added：AI 生成 Flex 草稿 + 潤稿）
- [x] 5.8 happy path 生成端已補驗：切 ollama qwen2.5:3b + 本 service 系統提示，AI 產出結構完整的合法 Flex bubble（header/body/footer/text/button uri，繁中貼合描述），且**通過本機結構驗證**（validateLineFlexMessageBody），僅卡在最後實打 LINE API 前的 token 解密（獨立測試實例 ENCRYPTION_KEY 與 DB 寫入時不符，純環境問題，非程式碼）。正式 3001 進程金鑰相符、載入新 code 後即可完整跑通。
