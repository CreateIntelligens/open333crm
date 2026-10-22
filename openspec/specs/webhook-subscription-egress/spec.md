# webhook-subscription-egress Specification

## Purpose
定義租戶的 webhook 訂閱如何避免把請求送進內部網路：建立或更新訂閱時只接受公開的 HTTPS 網址，每次派送前重新檢查網址，而且不跟隨轉址。渠道的下游 webhook 轉發見 `line-downstream-webhook`。

## Requirements

### Requirement: 訂閱網址必須是公開的 HTTPS 位址

`POST /api/v1/webhook-subscriptions` 與 `PATCH /api/v1/webhook-subscriptions/:id` 帶有 `url` 時，API SHALL 先檢查網址，通過後才寫入資料庫。網址通過檢查的條件：

- 網址使用 `https`。
- 主機的 DNS 解析至少有一個結果，而且每個結果都不是內部位址。內部位址包含 loopback、私有網段、link-local（含雲端 metadata 位址 `169.254.169.254`）、CGNAT、多播與保留網段，以及 IPv6 的 loopback、unique-local 與 link-local。

DNS 解析失敗也視為不通過。不通過時，API 回 400，錯誤碼是 `INVALID_WEBHOOK_URL`，不建立也不更新訂閱。

#### Scenario: 建立時網址指向雲端 metadata
- **WHEN** 有 `webhook.manage` 的成員建立訂閱，`url` 是 `https://169.254.169.254/latest/meta-data/`
- **THEN** API 回 400 `INVALID_WEBHOOK_URL`，不建立訂閱

#### Scenario: 建立時網址不是 HTTPS
- **WHEN** 成員建立訂閱，`url` 是公開位址，但使用 `http`
- **THEN** API 回 400 `INVALID_WEBHOOK_URL`，不建立訂閱

#### Scenario: 建立時主機無法解析
- **WHEN** 成員建立訂閱，`url` 的主機 DNS 解析失敗
- **THEN** API 回 400 `INVALID_WEBHOOK_URL`，不建立訂閱

#### Scenario: 更新時網址指向內部位址
- **WHEN** 成員更新訂閱，`url` 是 `https://127.0.0.1/hook`
- **THEN** API 回 400 `INVALID_WEBHOOK_URL`，不更新訂閱

#### Scenario: 建立時網址是公開的 HTTPS 位址
- **WHEN** 成員建立訂閱，`url` 使用 `https`，主機解析到公開位址
- **THEN** API 回 201，建立訂閱

### Requirement: 派送前重新檢查網址，且不跟隨轉址

每次派送 webhook 之前，系統 SHALL 以「訂閱網址必須是公開的 HTTPS 位址」的條件重新檢查訂閱的網址。DNS 的結果可能在建立訂閱之後改變，資料庫裡也可能有這項檢查上線之前建立的訂閱。

- 網址不通過時，系統 SHALL NOT 送出請求。派送紀錄的 `attempts` 是 1，`success` 是 false，`errorMessage` 是 `Blocked webhook target`。
- 目的地回應轉址時，系統 SHALL NOT 跟隨轉址。這次嘗試記為失敗。系統之後重試時，仍然送往原本的網址。

#### Scenario: 派送時網址指向內部位址
- **WHEN** 系統派送 webhook，訂閱的網址是 `https://10.0.0.5/hook`
- **THEN** 系統不送出請求，派送紀錄的 `attempts` 是 1、`success` 是 false、`errorMessage` 是 `Blocked webhook target`

#### Scenario: 目的地回應轉址
- **WHEN** 系統派送 webhook，訂閱網址是公開的 HTTPS 位址，目的地回應轉址到其他網址
- **THEN** 系統不送出請求到轉址的網址，派送紀錄的 `success` 是 false

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
