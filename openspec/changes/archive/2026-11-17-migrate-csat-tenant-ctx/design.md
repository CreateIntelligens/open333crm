# Design

## Context

csat 有三條流程，入口與目前用的連線如下：

| 流程 | 入口 | 目前的連線 |
| --- | --- | --- |
| 寄問卷 | 排程 `csat-send`（每 60 秒） | `prismaAdmin`，逐句執行 |
| 問卷逾時結案 | 排程 `csat-auto-close`（每 60 秒） | `prismaAdmin`，逐句執行 |
| 記分 | webhook 進站的 postback 攔截、`POST /api/v1/cases/:id/csat` | 進站用 `prismaAdmin`；路由用 `request.tenantPrisma`（每個查詢各自一個交易） |

三條流程都呼叫還沒搬遷的 `conversation` 模組：`deliverToChannel()` 送感謝訊息，`closeConversationsForCase()` 關閉對話。`closeConversationsForCase()` 自己推播、以 `eventBus.publish()` 發 `conversation.closed`，不能放進交易。

**審查基準：** 達到 Laravel 在 queued job 內「讀資料 → 寫入（`DB::transaction()`）→ commit 之後呼叫外部 API 與 broadcast」的水準。交易內不呼叫外部服務；寫入以條件更新認領。commit 之後、外部呼叫之前行程中斷，Laravel 專案也會遇到，記在「Risks / Trade-offs」，不另外處理。

## Goals / Non-Goals

**Goals:**

- 三條流程都由入口以 `inTenant()` 開交易，`csat.service.ts` 只收 `TenantCtx`。
- 同一個業務動作的寫入一起 commit 或一起 rollback（使用者 2026-11-17 決定）。
- 推播在 commit 之後送出；`case.closed` 改經 outbox。
- 刪除第七批留下的 `createAndDispatchWithoutTransaction()`。

**Non-Goals:**

- 不搬 `conversation`：`deliverToChannel()`、`closeConversationsForCase()` 照舊呼叫，簽名不變。
- 不改問卷的內容、寄送時間（30 分鐘）、逾時（72 小時）、收件人規則。
- 不處理「commit 之後、送 LINE 之前行程中斷」（見 Risks）。

## Decisions

### D1. 寄問卷：認領與建立問卷訊息在同一個交易

| 步驟 | 交易 | 保證 | 失敗時 |
| --- | --- | --- | --- |
| 1. 排程以 `prismaAdmin` 跨租戶找出候選工單（只取 id 與 tenantId） | 無 | — | 這一期結束，下一期再找 |
| 2. 讀遮罩政策 | 交易外 | — | `readAiPrivacyPolicy()` 丟出 503 `AI_PRIVACY_POLICY_UNAVAILABLE`，這張工單沒有寫入，下一期重試 |
| 3. 認領 `csatSentAt`、建立問卷訊息、更新 `lastMessageAt`、讀出渠道與客人在該渠道的帳號，登記 `message.new` 推播 | 交易 A | 一起 commit 或一起 rollback | rollback：`csatSentAt` 維持空值，下一期重試（MODIFIED scenario） |
| 4. 以步驟 3 讀出的渠道與帳號送 LINE | 交易外 | 最多一次 | 送不出時進入步驟 5 |
| 5. 送不出時：問卷訊息標 `deliveryFailed`、時間軸寫 `csat_send_failed`，登記第二次 `message.new` | 交易 B | — | 寫入失敗只記 log；問卷不重寄 |

**替代方案：** 認領單獨 commit（原本的規格）。缺點是建立訊息遇到暫時的資料庫錯誤時，問卷永遠不寄。使用者選擇合併。

### D2. 問卷逾時結案：認領與 `case.closed` 在同一個交易

| 步驟 | 交易 | 保證 | 失敗時 |
| --- | --- | --- | --- |
| 1. 以 `prismaAdmin` 找出逾時的工單 | 無 | — | 下一期再找 |
| 2. 條件更新改成 `CLOSED`、`publishEvent(case.closed)`、登記 `case.updated` 推播 | 交易（每張工單一個） | 一起 commit；`case.closed` 至少一次 | rollback：工單維持 `RESOLVED`，下一期重試 |
| 3. `closeConversationsForCase()` | commit 之後，交易外 | 最多一次（原本的行為） | 只記 log |

### D3. 記分：分數到 `case.closed` 在同一個交易，低分通知另開交易

| 步驟 | 交易 | 保證 | 失敗時 |
| --- | --- | --- | --- |
| 1. 讀遮罩政策 | 交易外 | — | 丟出 503 `AI_PRIVACY_POLICY_UNAVAILABLE`，沒有寫入任何東西：路由回 503，進站攔截往外丟 |
| 2. 條件更新寫入分數；問卷卡片寫入分數；時間軸 `csat_rated`；建立感謝訊息、更新 `lastMessageAt`；工單改成 `CLOSED` 與 `status_changed` 事件；`publishEvent(case.closed)`；登記 `message.new`、`case.updated` 推播 | 交易 A | 一起 commit 或一起 rollback | rollback 後丟出錯誤：路由回 500；進站攔截照舊往外丟（原本的行為）。工單維持原狀，客人可以再評分 |
| 3. 1～2 分時：查收件人、`createAndDispatch()` | 交易 B | 每位收件人最多一則（評分只處理一次） | 寫 `csat_low_score_notify_failed`（交易 C），分數不受影響（既有規格） |
| 4. `deliverToChannel()` 送感謝訊息 | 交易外 | 最多一次 | 只記 log（原本的行為） |
| 5. `closeConversationsForCase()` | 交易外 | 最多一次 | 只記 log（原本的行為） |

認領失敗（已評分、客人評分時工單不是 `RESOLVED`）時回傳沒有記錄，不執行步驟 3～5。

**為什麼結案放進交易 A：** 原本結案失敗只記 log，工單永遠停在「已解決、有分數」：逾時結案只處理 `csatRespondedAt` 是空值的工單，寄問卷只處理還沒寄的工單，兩個排程都不會再碰它。合併之後，失敗時客人或客服可以再評一次。

**為什麼低分通知另開交易：** 主規格「低分通知送不出時客服看得到」要求通知失敗時分數照常記錄。通知放進交易 A 的話，通知的資料庫錯誤會讓分數一起 rollback。

### D4. 連線與依賴注入

- 排程：`setupCsatScheduler(scheduler, { admin, prisma, io, events })`。`admin` 跨租戶掃描；`prisma` 是 `app_tenant` 連線，給 `inTenant()`。
- 路由：`fastify.prisma`、`fastify.io`、`createOutboxPublisher(fastify.prisma)`。
- 進站攔截：`ctx.options.tenantPrisma ?? ctx.prisma`，與留言收件、收件匣串接相同。沒有給 `tenantPrisma` 的入口（模擬器等）退回 webhook 的連線。
- `deliverToChannel()` 與 `closeConversationsForCase()` 屬於還沒搬遷的 `conversation`，在交易外呼叫，要傳一條綁定租戶或繞過 RLS 的連線。`app_tenant` 的基礎連線沒有綁定租戶，RLS 會讓這兩個函式查不到任何資料：感謝訊息不會送出，對話不會關閉，而且不會丟錯。所以 flow 另外收 `conversationDb`，型別寫成 `Parameters<typeof deliverToChannel>[0]`，與 `kb-autoreply.flow.ts` 的 `deliverDb` 相同：
  - 排程與進站攔截：傳 `admin`／`ctx.prisma`，與現在相同。
  - 路由：傳 `tenantScopedClient(fastify.prisma, tenantId)`，與現在的 `request.tenantPrisma` 相同。
  - `closeConversationsForCase()` 的參數型別是 `PrismaClient`，傳入時與現在一樣轉型。搬遷 `conversation` 時一起拿掉 `conversationDb`。

### D5. 刪除過渡函式

`notifyCsatLowScore()` 改收 `TenantScope`，呼叫 `createAndDispatch()`。`createAndDispatchWithoutTransaction()` 沒有其他呼叫端，刪除。

## Risks / Trade-offs

- [交易 A commit 之後、送 LINE 之前行程中斷] → 問卷卡片留在對話中，客人沒收到，也沒有「沒有送出」的紀錄。2026-11-17 使用者決定記錄就好：Laravel 的 queued job 有同樣的窗口。
- [記分的交易 A rollback] → 客人這次的點選沒有記錄，LINE 上看得到自己點的「我的評分：N 分」，但沒有感謝訊息。問卷卡片仍可再點。LINE 重送同一則 webhook 會被重複訊息檢查擋下，不會自動補記。
- [`case.closed` 改成至少一次] → 快路徑與補送同時送出時，BullMQ 以事件 id 組成的 job id 擋住重複，但只在 job 保留的 24 小時內有效。超過期限的重送，訂閱者要能承受重複，對客人發訊息的動作以 `side_effect_claims` 認領（`docs/ref/modules/EVENTS.md`「送達保證：outbox 與認領」）。`case` 模組在階段 3 已經以 outbox 發 `case.closed`，訂閱者已經面對相同的保證。
- [關閉對話仍在交易外] → commit 之後關閉對話失敗時，工單已結案但對話沒關。原本的行為，搬遷 `conversation` 時再處理。
