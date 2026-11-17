## Context

這個 change 只改規格。對應的程式改動是 #337 階段 4 第七批（commit `248010df`）：通知路由改成入口開交易，API 行程寫入的通知改成在租戶交易內寫入，commit 之後才推播。

**審查基準：** 達到 Laravel 在 `DB::transaction()` 內寫入通知、commit 之後才 broadcast（`afterCommit`）的水準：通知與同一個交易的資料一起 commit 或一起 rollback；推播最多一次，推播遺失時由前端每 60 秒的輪詢補上。下列情況 Laravel 專案也會有，記在「Risks / Trade-offs」，不另外處理：寫入的當下收件成員剛好被停用、同一毫秒有兩個排程寫入同一則通知。

## Decisions

### D1. API 行程寫入通知只有一個入口

`notification/notification-effects.ts` 的 `createAndDispatch(scope, io, input)` 是 API 行程寫入站內通知的唯一入口。寫入用 `createNotificationForActiveAgent()` 的條件寫入（#484），推播用 `notifyAgent()` 登記在 commit 之後。csat 還沒搬遷，手上沒有交易，暫時用 `createAndDispatchWithoutTransaction()`，搬遷 csat 時刪除。

## Risks / Trade-offs

（review-loop 分類為「記錄就好」的項目寫在這裡。）
