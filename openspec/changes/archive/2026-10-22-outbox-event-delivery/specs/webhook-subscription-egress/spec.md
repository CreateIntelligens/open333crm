# Spec Delta

## ADDED Requirements

### Requirement: 只轉送對外事件清單內的事件

系統 MUST 只把對外事件清單內的事件轉送給訂閱網址。不在清單內的事件，即使訂閱的事件名稱相符，也 MUST NOT 轉送。第一版清單包含目前所有業務事件名稱。

#### Scenario: 清單內的事件

- **WHEN** 租戶訂閱 `case.created`，系統發出 `case.created`
- **THEN** 訂閱網址 MUST 收到這個事件

#### Scenario: 不在清單內的名稱

- **WHEN** 租戶訂閱 `internal.test`，系統內部產生名為 `internal.test` 的事件
- **THEN** 訂閱網址 MUST NOT 收到這個事件

### Requirement: 送出的內容帶事件 id

每次送出的 JSON MUST 有 `id` 欄位，值是事件 id，header MUST 有 `X-Webhook-Event-Id`。同一個事件送給同一個訂閱網址時，重試與重送 MUST 帶相同的事件 id 與相同的 `X-Webhook-Delivery`，資料庫 MUST 只有一筆該事件與該訂閱的送出紀錄。

#### Scenario: 同一個事件送出兩次

- **WHEN** 事件 E 的 webhook job 因重試而送出兩次
- **THEN** 兩次的 `id` 與 `X-Webhook-Delivery` MUST 相同，送出紀錄 MUST 只有一筆，`attempts` 是 2

### Requirement: 每個訂閱網址各自重試

一個事件有多個訂閱網址時，每個網址 MUST 各自送出與重試。每個網址 MUST 最多送出 3 次，間隔 1 秒與 5 秒。重試 MUST 在 API 行程重新啟動之後繼續，MUST NOT 只存在記憶體。

#### Scenario: 一個網址失敗

- **WHEN** 事件 E 有訂閱網址 U1 與 U2，U1 回傳 500，U2 回傳 200
- **THEN** 系統 MUST 只重試 U1，U2 MUST 只收到一次

#### Scenario: 重試期間 API 重新啟動

- **WHEN** U1 第一次回傳 500，API 在重試之前重新啟動
- **THEN** API 啟動之後，系統 MUST 繼續送出 U1 的第二次

### Requirement: 測試送出只送一次

`POST /webhook-subscriptions/:id/test` MUST 在請求內送出一次，MUST NOT 重試，回應 MUST 帶這次送出的結果。送出的 JSON 的 `id` MUST 是新產生的事件 id，送出紀錄的事件 id MUST 是同一個值。

#### Scenario: 測試網址回傳 500

- **WHEN** 有 `webhook.manage` 的成員對一個訂閱送出測試，訂閱網址回傳 500
- **THEN** 回應結果的 `success` MUST 是 false，`statusCode` MUST 是 500；訂閱網址 MUST 只收到一次，送出紀錄的 `attempts` MUST 是 1
