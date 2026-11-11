# Design

## Context

見 proposal.md「Why」。現況（2026-11-11，main `1ba773b2`）：

- automation worker 處理 `message.received`。Agent 沒有回覆時，worker 呼叫 `attemptKbAutoReply(prisma, llm, io, tenantId, conversationId, text, delivery, replyGuard, events)`，`prisma` 是 `prismaAdmin`。
- `attemptKbAutoReply()` 依序做這些事：
  1. `KB_AUTO_REPLY_ENABLED` 是關閉時略過。
  2. 讀 `BOT_HANDLED` 的對話，連同渠道設定與聯絡人的渠道身分。
  3. `hasMatchingKeywordRule()`：命中能回覆的關鍵字規則時讓步。
  4. 解析 `botConfig`。`botMode` 是 `off` 或 `keyword` 時略過。
  5. 讀 Chat 設定、對話歷史（`loadKbHistory()`）、其他渠道的內容（`loadOtherChannelContext()`）。
  6. 讀向量化設定與遮罩政策（`readEmbeddingInputs()`），呼叫 embedding 服務向量化客人的訊息。失敗時回 `failed`。
  7. 搜尋知識庫（`searchSimilarArticles()`）。
  8. 型號守門（`checkModelGuard()`）：訊息提到型號、相似度不夠高時，讀型號白名單（`getKnownModelKeys()`，處理程序內快取 10 分鐘）。
  9. 依型號守門、相似度與追問次數決定回覆種類，呼叫 LLM（`generateReply()`）。LLM 失敗時改用文章內容或轉接，規則見主規格 `bot-handoff-config`。
  10. `persistAndDeliver()`：
      - 檢查綁定代碼（`guardAiReplyForTenant()`，回覆含代碼時讀身分綁定設定，處理程序內快取）。
      - 再讀一次遮罩政策（`readAiPrivacyPolicy()`），遮罩回覆與轉接的系統訊息。
      - 在 `replyGuard.persist()` 的交易內認領 `bot_reply`、寫入機器人訊息、以 `conversation.update` 更新對話，需要轉接時呼叫 `handOffConversation()`。
      - commit 之後以 `emitToChannel()` 推播 `message.new`，再以 `deliverToChannel(prismaAdmin, …)` 送到渠道。
- 步驟 2～8 的查詢都經由 `prismaAdmin`，沒有交易，也沒有 RLS。
- embedding、LLM、去識別化服務原本就在交易外呼叫。`replyGuard.persist()` 的交易內只有資料庫寫入。
- 步驟 10 的 `conversation.update` 只以 `id` 為條件，不檢查狀態。只有轉接時，`handOffConversation()` 以條件更新檢查 `BOT_HANDLED`。
- worker 以 `ClaimTransactionError` 讓佇列重試；`attemptKbAutoReply()` 的其他錯誤當成 `failed`，轉接真人（#445）。

## Goals / Non-Goals

**Goals:**

- 知識庫自動回覆的每一次資料庫讀寫都在綁定租戶的短交易內，embedding、LLM、去識別化服務都在交易外呼叫。
- 寫入回覆時確認對話仍是 `BOT_HANDLED`，符合主規格「轉接後關鍵字規則照常回覆」。
- 其他可觀察的行為不變：回覆種類、文字、追問次數、轉接、推播與送出的時機。

**Non-Goals:**

- `conversation` 的 `deliverToChannel()` 與 `identity-binding` 的 `guardAiReplyForTenant()` 不搬，以過渡寫法呼叫。
- automation worker 在呼叫 Agent 之前，以 `prismaAdmin` 呼叫 `hasMatchingKeywordRule()`。這個呼叫不屬於 `kb-autoreply`，這次不改。
- `flex-ai.service.ts` 不改。

**審查基準：** 達到 Laravel 在 queued job 內「讀資料 → 呼叫外部 API → 寫結果」的水準：讀與寫各自是短交易，不在 `DB::transaction()` 內等待外部 API；寫入時以條件更新確認狀態。兩個 job 在同一毫秒寫同一列這類巧合，Laravel 專案也會有，記在「Risks / Trade-offs」，不另外處理。

## Decisions

### D1. 新增 `kb-autoreply.flow.ts`，每一步的交易與保證

`attemptKbAutoReplyFlow(deps, input)` 取代 `attemptKbAutoReply()`。`deps` 是 `{ prisma, llm, io, replyGuard, events, deliverDb }`，`prisma` 是 `app_tenant` 的基礎連線。`input` 是 `{ tenantId, conversationId, messageText, delivery }`。回傳型別 `KbAutoReplyResult` 不變。

| 步驟 | 交易 | 保證 | 失敗時 |
| --- | --- | --- | --- |
| 1a. 讀對話、關鍵字讓步 | 交易 A1（只讀） | — | 丟錯，worker 當成 `failed` 轉接（原本的行為）；條件資料讀取失敗時不讓步（原本的行為） |
| 1b. `botConfig`、Chat 設定、歷史、其他渠道的內容、向量化設定與遮罩政策 | 交易 A2（只讀） | — | 丟錯，worker 當成 `failed` 轉接（原本的行為） |
| 2. 向量化客人的訊息 | 交易外 | 最多一次 | 回 `failed`（原本的行為） |
| 3. 搜尋知識庫；型號守門需要時讀型號白名單 | 交易 B（只讀） | — | 搜尋失敗時丟錯（原本的行為）；白名單讀取失敗時不守門（原本的行為） |
| 4. 呼叫 LLM（`generateReply()`，6a 的交易） | 交易外 | 每種回覆最多一次 | 改用文章內容或轉接（原本的行為） |
| 5. 檢查綁定代碼 | 交易 C（只讀，回覆含代碼時才查詢） | — | 丟錯（原本的行為） |
| 6. 遮罩回覆與轉接的系統訊息 | 交易外 | — | 丟錯（原本的行為） |
| 7. 認領、確認 `BOT_HANDLED`、寫入回覆、更新對話、轉接 | `replyGuard.persist()` | 每則進站訊息最多一則（原本的行為） | `ClaimTransactionError` 給佇列重試（原本的行為）；對話不是 `BOT_HANDLED` 時 rollback，回 `already_handled` |
| 8. 推播 `message.new`、送到渠道 | commit 之後 | 最多一次（原本的行為） | 原本的行為 |

步驟 1 分成兩個交易。`hasMatchingKeywordRule()` 讀取有條件規則的條件資料失敗時，catch 錯誤後當成不讓步；PostgreSQL 在查詢失敗後拒絕同一個交易的其他查詢，所以讓步判斷是交易 A1 的最後一步，之後的讀取放在交易 A2（review-loop 第 1 輪）。A1 失敗的查詢被 catch 之後，commit 這個交易不會丟錯（feature 測試「條件資料讀取失敗」）。關鍵字讓步或 `botMode` 略過時，提前回傳，不再讀之後的資料。

步驟 3 與步驟 1 分開：兩者之間要呼叫 embedding 服務。

替代方案：從步驟 1 到步驟 7 開一個長交易。不採用：違反結構規則 2，embedding 與 LLM 的呼叫會佔住連線好幾秒。

### D2. service 函式

`kb-autoreply.service.ts` 保留回覆內容的判斷（`buildKbContext()`、`buildKbReplyPayload()`、追問與轉接原因、`aiReplyFailedReason()`）。讀寫資料庫的部分改成收 `TenantCtx` 的函式：

- `checkKbReplyEligibility(ctx, conversationId, messageText)`：步驟 1a。回傳略過原因，或對話的渠道設定與 `metadata`。
- `readKbReplyContext(ctx, conversationId, eligible)`：步驟 1b。回傳略過原因，或回覆需要的資料。
- `searchKbArticles(ctx, embedding, settings, messageText)`：步驟 3，含型號守門。
- `loadKbHistory(ctx, conversationId)`：改收 `TenantCtx`。
- `writeKbReply(ctx, input)`：步驟 7 的寫入。

`hasMatchingKeywordRule()`、`getChatSettings()`、`loadOtherChannelContext()`、`readEmbeddingInputs()`、`searchSimilarArticles()`、`getKnownModelKeys()` 都已經收 `TenantCtx` 或 Prisma executor，改傳 `scope` 或 `scope.tx`，不必修改。

### D3. 寫入回覆時確認對話狀態

`writeKbReply()` 在 `replyGuard.persist()` 的交易內：

1. 讀這段對話最新的 `metadata`。
2. 以 `updateMany({ where: { id, tenantId, status: 'BOT_HANDLED' } })` 更新計數、`lastMessageAt` 與合併後的 `metadata`。更新 0 列時回傳 `null`，`replyGuard` rollback，不留下認領。
3. 寫入機器人訊息。需要轉接時呼叫 `handOffConversation()`。

做法與 Agent 的 `persistAndDeliverAgentReply()` 相同。`metadata` 改在交易內讀，原本以處理開始時讀到的值合併。

條件不成立時，結果是 `already_handled`。這與「已經有機器人回覆」共用同一個略過原因：worker 對兩者的處理相同，都不轉接。

### D4. 遮罩政策與推播

- 步驟 6 的遮罩沿用步驟 1b 由 `readEmbeddingInputs()` 讀到的政策，刪除 `persistAndDeliver()` 內的 `readAiPrivacyPolicy()`。`generateReply()` 經由 `prepareLlmCall()` 另外讀政策，這是 6a 的設計，不改。
- 推播改用 `replyGuard.persist()` 提供的 scope 呼叫 `notifyChannel()`。`notifyChannel()` 在 commit 之後送出，rollback 時不送出。送出的時機與原本「commit 之後呼叫 `emitToChannel()`」相同。

### D5. 呼叫還沒搬的模組

- `deliverToChannel()`（`conversation`）收 `TenantDb`。flow 以 `deps.deliverDb` 傳入，automation worker 傳 `prismaAdmin`，比照 6b-1 的 design D3。
- `guardAiReplyForTenant()`（`identity-binding`）收 `TenantDb`。flow 以交易 C 的 `scope.tx` 呼叫，比照 6b-1 的 design D6。

### D6. 呼叫端

automation worker 改呼叫 `attemptKbAutoReplyFlow({ prisma: tenantDeps.tenantPrisma, llm: tenantDeps.llm, io, replyGuard, events: tenantDeps.events, deliverDb: prisma }, { … })`。錯誤處理不變：`ClaimTransactionError` 往外丟，其他錯誤當成 `failed`。

## Risks / Trade-offs

- [兩則訊息同時處理同一段對話，追問次數的寫入仍可能互相覆蓋] → `metadata` 改在寫入的交易內讀，覆蓋的時間窗從幾秒縮到同一個交易內的幾毫秒。審查基準接受，不加列鎖。
- [客服在 commit 之後、送到渠道之前接手] → 回覆已經 commit，照樣送出。原本的行為，Agent 也相同。
- [處理開始時讀到的 `botConfig`、Chat 設定在處理期間被修改] → 這次處理用舊的設定。原本的行為。
- [`deliverToChannel()` 仍用 `prismaAdmin`] → 隨 `conversation` 搬遷。
- [embedding 與 LLM 的呼叫不收 `TenantCtx`，型別擋不住在交易內呼叫] → 同 6a、6b-1，由 code review 與規劃檔 5.2 的檢查清單把關。

## Migration Plan

沒有 schema 變更，沒有改路由。部署後不重跑規劃檔 6.2 的量測：這次沒有改 GET 端點，在規劃檔的變更紀錄寫明。回滾：revert 這次的 commit。
