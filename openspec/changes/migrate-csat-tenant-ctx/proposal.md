## Why

這是 #337 階段 4 第八批：把 `csat` 模組改成「入口以 `inTenant()` 開一個綁定租戶的交易，service 只收 `TenantCtx`」（AGENTS.md 結構規則 2）。

目前 csat 的三條流程都用 `prismaAdmin` 或 `request.tenantPrisma` 逐句執行，沒有交易包住：

- **寄問卷：** 認領之後，建立問卷訊息失敗時，問卷永遠不會再寄。
- **記分：** 寫入感謝訊息或結案失敗時，工單停在「已解決、有分數」。逾時結案與寄問卷的排程都不會再處理這張工單，客服也看不到任何紀錄。
- **推播與事件：** 系統在寫入的當下就送出推播，不等交易 commit。`case.closed` 由 `eventBus.publish()` 直接送出，不經 outbox，行程中斷時事件會遺失。

第七批搬完 `notification` 之後，csat 依賴的模組只剩還沒搬的 `conversation`。依「呼叫端先搬」的規則（#337 規劃 5.1），csat 現在就可以搬。第七批為 csat 留下的過渡函式 `createAndDispatchWithoutTransaction()` 也在這批刪除。

## What Changes

- **寄問卷（排程 `csat-send`）**：認領工單與建立問卷訊息在同一個交易內寫入，commit 之後才推播。送 LINE 在交易外執行。送不出時，失敗紀錄在另一個交易內寫入。建立問卷訊息失敗時，認領一起 rollback，下一期重試。這時還沒有送出任何東西，所以仍是最多一次。
- **問卷逾時結案（排程 `csat-auto-close`）**：認領、`case.closed`（改經 outbox）在同一個交易內寫入，commit 之後推播 `case.updated`。關閉對話仍呼叫 `conversation` 模組的 `closeConversationsForCase()`，在 commit 之後執行。
- **記分（webhook 進站與 `POST /api/v1/cases/:id/csat`）**：分數、問卷卡片的分數、時間軸、感謝訊息、工單結案、`case.closed`（經 outbox）在同一個交易內寫入，一起 commit 或一起 rollback。感謝訊息送渠道在 commit 之後執行。低分通知在另一個交易內寫入（`createAndDispatch()`），失敗時在第三個交易寫 `csat_low_score_notify_failed`。關閉對話在 commit 之後執行。
- 讀取 AI 個資遮罩政策移到交易之前（#337 規劃 5.2）。讀取失敗時 `readAiPrivacyPolicy()` 丟出 503，流程在寫入之前停止。
- 刪除 `notification-effects.ts` 的 `createAndDispatchWithoutTransaction()`。
- **可觀察的差異：**
  - 記分時資料庫出錯，這次評分不會留下任何寫入。原本可能留下「有分數、沒結案」的工單。客人可以再點一次問卷，客服可以再按一次。
  - 建立問卷訊息失敗時，下一期會重試。原本這份問卷永遠不寄。
  - `case.closed` 至少送出一次。原本最多一次，行程中斷時會遺失。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `csat-survey`：修改「每次解決最多寄出一份滿意度問卷」的「認領之後建立問卷訊息失敗」scenario；新增「記分的寫入一起成功或一起失敗」。

## Impact

- `apps/api/src/modules/csat/`：`csat.service.ts` 改收 `TenantCtx`，新增 `csat.flow.ts`，`csat.scheduler.ts` 改成每張工單開一個 `inTenant()`。
- `apps/api/src/modules/case/case.routes.ts` 的 `POST /:id/csat`：改呼叫 flow。
- `apps/api/src/modules/webhook/inbound-postback-interceptors.ts`：改呼叫 flow，以 `ctx.options.tenantPrisma` 開交易。
- `apps/api/src/modules/notification/notification-effects.ts`：刪除過渡函式。
- `apps/api/src/index.ts`：`setupCsatScheduler()` 多注入 `app.prisma` 與事件 publisher。
- 受影響的功能領域：工單（直接）、收件匣與對話、通知、LINE（間接）。

## Platform layer

沒有任何一項適用：這個 change 只改既有流程的交易邊界，沒有新增權限碼、功能模組、上限、AI 呼叫、渠道類型、平台設定、平台稽核動作、佇列或租戶與平台之間的請求。
