## Context

WebChat 沒有平台端的主動推送：訪客畫面上的訊息由 API 推到 `visitor:<channelId>:<uid>` 房間，只有收件匣回覆與
`deliverToChannel()` 做這一步。群發與附券廣播直接呼叫外掛 `sendMessage()`，WebChat 外掛只寫 log 就回成功。

## Decisions

### D1：能不能主動推送由共用常數判斷

`@open333crm/shared` 的 `PROACTIVE_PUSH_CHANNEL_TYPES` 與 `supportsProactivePush()` 是唯一的清單。後端的群發、附券廣播與
前端的群發頁、券詳情批次發券都讀它，不在各處寫 `channelType === 'WEBCHAT'`（AGENTS.md 結構規則 5）。
前端不能讀外掛 registry，所以不用外掛屬性；新增能推送的渠道時改這份清單。

### D2：檢查放在 service，不改排程器

- `createBroadcast()`：REST、MCP 與 `createBatchIssue()` 都經過這裡。
- `executeBroadcast()`：在搶占之後、呼叫外掛之前檢查，錯誤由既有的 catch 標失敗並寫 `failureReason`，排程與手動送出都涵蓋。
- `queueCouponBroadcast()`：附券廣播送出時不排入發送。
- `claimCouponBroadcast()`：搶占後回 `INVALID`，`runCouponBroadcast()` 以既有的 `fail()` 寫 `failureCode`／`failureReason`。
  排程與 `coupon-broadcast` job 都經過這裡。

`broadcast.scheduler.ts` 不改。

### D3：WebChat 外掛 `sendMessage()` 維持回成功

呼叫端與影響：

| 呼叫端 | 渠道為 WebChat 時 | 改成回失敗的影響 |
| --- | --- | --- |
| `conversation.service.ts` 收件匣回覆（`sendMessage` 路徑） | 呼叫外掛後自己推訪客房間 | 訊息被標 `deliveryFailed`，客服看到送出失敗，但訪客其實收到 |
| `conversation.service.ts` `deliverToChannel()`（AI 回覆、CSAT 文字問卷、其他內部回覆） | 呼叫外掛後推訪客房間 | 拋 `CHANNEL_DELIVERY_FAILED`，不推訪客房間，訪客收不到 |
| `marketing.service.ts` `executeBroadcast()` | 本 change 起先被擋下 | 無 |
| `broadcast-coupon.flow.ts` `sendToRecipient()` | 本 change 起先被擋下 | 無 |
| `canvas.worker.ts` | 沒有推訪客房間（另一個假成功） | 不寫外送訊息；訪客仍收不到 |
| `csat.service.ts` | 只對 LINE 呼叫外掛 | 無 |
| `services/message.ts` | 沒有接線的原型 | 無 |
| workers `channel-delivery.ts` | workers 沒有註冊 WebChat 外掛 | 無 |

改成回失敗會打壞前兩條真正送得到訪客的路徑，所以不改。長期做法（issue #415 修正方向）是把訪客推送移進外掛或共用送出函式。

## Risks

- 修正前建立的 WebChat 群發草稿或排程會在送出或到期時失敗。失敗原因寫在廣播上，後台看得到。
