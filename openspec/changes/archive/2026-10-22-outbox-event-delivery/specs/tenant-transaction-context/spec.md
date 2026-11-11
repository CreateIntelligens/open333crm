# Spec Delta

## ADDED Requirements

### Requirement: 事件與佇列 job 至少送出一次

交易內登記的事件與佇列 job MUST 經 outbox 送出（見 `event-delivery`）。交易 commit 之後，行程在送出之前結束時，系統 MUST 補送。補送時，job 的 id MUST 與第一次送出相同。登記 job 時，選項 MUST 只能是 `attempts`、`backoff`、`delay`、`priority`、`removeOnComplete`、`removeOnFail`，其他選項 MUST 丟錯。其他選項可能讓佇列不建立這個 job，或不用 outbox 的 id 當 job id，例如 `jobId`、`deduplication`、`debounce`、`repeat`。

推播 MUST 維持最多一次：行程在推播送出之前結束時，系統 MUST NOT 補送推播。

#### Scenario: 行程在送出 job 之前結束

- **WHEN** 交易登記 job J 並 commit，API 行程在 J 送進佇列之前結束，之後補送排程執行
- **THEN** 佇列 MUST 收到 J，J 的 id MUST 等於它在 outbox 的 id

#### Scenario: job 選項不在白名單內

- **WHEN** 交易登記 job 時帶 `deduplication`、`debounce`、`repeat` 或 `jobId` 選項
- **THEN** 登記 MUST 丟錯，交易 MUST rollback

#### Scenario: 行程在推播之前結束

- **WHEN** 交易登記推播 P 並 commit，API 行程在 P 送出之前結束
- **THEN** 系統 MUST NOT 補送 P

## REMOVED Requirements

### Requirement: 事件與佇列 job 最多送出一次

**Reason**: 事件與佇列 job 改經 outbox 送出，保證從最多一次改成至少一次（#337 規劃 D3、3.1）。推播仍是最多一次，改寫在「事件與佇列 job 至少送出一次」。

**Migration**: 訂閱者與佇列的 worker 要能承受同一個事件或 job 處理兩次。對客人發訊息等不能重複的副作用，執行前先寫認領紀錄（見 `side-effect-claims`）。
