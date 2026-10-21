# Spec Delta

## Purpose

定義業務事件與佇列 job 的送達保證：事件與資料一起 commit，commit 之後送給各訂閱者，行程中斷時由系統補送，同一個事件不會讓同一個訂閱者建立兩個 job。

## ADDED Requirements

### Requirement: 事件與資料一起 commit

交易內登記的事件與佇列 job MUST 寫進 outbox，與交易內的業務資料一起 commit 或一起 rollback。每筆 outbox 資料列 MUST 有唯一的 id，這個 id 就是事件 id。

#### Scenario: commit 之後 outbox 有這個事件

- **WHEN** 綁定租戶 A 的交易內寫入一張工單，並登記事件 `case.created`，之後交易 commit
- **THEN** outbox MUST 有一筆租戶 A 的 `case.created`，而且尚未標記已送出

#### Scenario: rollback 時 outbox 沒有這個事件

- **WHEN** 交易內登記事件 `case.created`，之後交易內的程式丟出錯誤
- **THEN** outbox MUST NOT 有這個事件，訂閱者 MUST NOT 收到這個事件

### Requirement: commit 之後立即送給訂閱者

交易 commit 之後，系統 MUST 為每個訂閱了該事件名稱的訂閱者建立一個 job，job 的 id 是事件 id。所有訂閱者的 job 都建立成功之後，系統 MUST 把該事件標記為已送出。系統 MUST NOT 等這些步驟完成才回傳交易內程式的結果。

#### Scenario: 一般情況

- **WHEN** 交易登記事件 `message.received` 並 commit，佇列正常
- **THEN** 通知、自動化與 webhook 的佇列 MUST 各有一個 id 等於事件 id 的 job，該事件 MUST 標記為已送出

#### Scenario: 只送給訂閱了這個事件的訂閱者

- **WHEN** 交易登記事件 `case.resolved` 並 commit，只有 webhook 訂閱者訂閱 `case.resolved`
- **THEN** 只有 webhook 的佇列 MUST 有這個事件的 job

#### Scenario: 建立 job 失敗

- **WHEN** 交易 commit 之後，建立 job 時佇列回傳錯誤
- **THEN** 該事件 MUST 維持未送出，呼叫端 MUST 照常收到交易內程式的回傳值

### Requirement: 補送未送出的事件

系統 MUST 每分鐘找出建立超過 2 分鐘、仍未標記已送出的事件，為每個訂閱者以同一個事件 id 建立 job，再標記為已送出。

#### Scenario: 行程在送出前結束

- **WHEN** 交易 commit 之後、事件送給訂閱者之前，API 行程結束；3 分鐘後補送排程執行
- **THEN** 訂閱者的佇列 MUST 收到 id 等於事件 id 的 job，該事件 MUST 標記為已送出

#### Scenario: 寬限時間內不補送

- **WHEN** 補送排程執行時，一個未送出的事件建立了 30 秒
- **THEN** 補送排程 MUST NOT 送出這個事件

### Requirement: 同一個事件不重複建立 job

同一個訂閱者佇列裡，id 相同的 job 已經存在時，系統 MUST NOT 再建立一個 job。訂閱者佇列 MUST 保留已完成的 job 24 小時、失敗的 job 7 天。

#### Scenario: 快路徑與補送同時送出

- **WHEN** 快路徑已經為事件 E 建立 job、但還沒標記已送出，補送排程又為 E 建立 job
- **THEN** 每個訂閱者佇列 MUST 只有一個 E 的 job，訂閱者 MUST 只處理 E 一次

#### Scenario: job 已完成 1 小時後再送一次

- **WHEN** 訂閱者已完成事件 E 的 job 1 小時，系統又以 E 的 id 建立 job
- **THEN** 佇列 MUST NOT 新增 job，訂閱者 MUST NOT 再處理 E

### Requirement: 每個訂閱者各自處理

每個訂閱者 MUST 有自己的佇列。一個訂閱者的 job 失敗與重試，MUST NOT 讓其他訂閱者再處理同一個事件。

#### Scenario: webhook 失敗重試

- **WHEN** 事件 E 的 webhook job 失敗並重試，自動化 job 已經完成
- **THEN** 自動化訂閱者 MUST NOT 再處理 E

### Requirement: 舊寫法的事件也送給訂閱者

還沒搬遷的程式直接把事件交給 API 行程內的事件匯流排。系統 MUST 為這些事件產生事件 id，並送給同樣的訂閱者佇列。這些事件不寫進 outbox，保證是最多一次：行程在送出之前結束時，事件遺失。

#### Scenario: 舊寫法發出事件

- **WHEN** 未搬遷的程式把 `case.created` 交給事件匯流排
- **THEN** 訂閱了 `case.created` 的訂閱者佇列 MUST 各有一個 job，job 帶有事件 id

### Requirement: 清理已送出的事件

系統 MUST 每天刪除標記已送出超過 7 天的 outbox 資料列。系統 MUST NOT 刪除未送出的資料列。

#### Scenario: 已送出 8 天

- **WHEN** 清理排程執行時，一個事件已送出 8 天
- **THEN** 該事件 MUST 被刪除

#### Scenario: 未送出的事件

- **WHEN** 清理排程執行時，一個事件建立了 8 天但仍未送出
- **THEN** 該事件 MUST NOT 被刪除

### Requirement: outbox 受租戶隔離

outbox MUST 受 RLS 約束。綁定租戶 A 的交易 MUST 看不到也寫不進其他租戶的事件。補送與清理排程以不受 RLS 約束的連線跨租戶處理。

#### Scenario: 寫入別的租戶的事件

- **WHEN** 綁定租戶 A 的交易，以租戶 B 的 ID 寫入 outbox
- **THEN** 資料庫 MUST 拒絕這筆寫入

### Requirement: workers 的事件與資料一起 commit

workers 的自動化動作產生事件時（`create_case` 產生 `case.created`，`add_tag` 產生 `contact.tagged`），MUST 在寫入業務資料的同一個交易內寫入 outbox，每筆都帶該租戶的 ID。

#### Scenario: 建立工單與事件一起寫入

- **WHEN** 自動化規則的 `create_case` 建立工單並 commit
- **THEN** outbox MUST 有一筆同租戶的 `case.created`，`payload.caseId` 是新工單的 ID

#### Scenario: 建立工單失敗

- **WHEN** `create_case` 的交易因為對話已經關聯其他工單而 rollback
- **THEN** outbox MUST NOT 有這次的 `case.created`

#### Scenario: API 行程沒有在執行

- **WHEN** workers 執行 `add_tag` 時 API 行程沒有在執行，API 之後重新啟動
- **THEN** 訂閱了 `contact.tagged` 的訂閱者 MUST 收到這個事件
