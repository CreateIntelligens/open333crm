# Spec Delta

## MODIFIED Requirements

### Requirement: Worker-Owned Automation Triggering
The automation engine SHALL evaluate event-triggered rules on the BullMQ worker path. For an event that matches an automation trigger, the automation subscriber job SHALL enqueue a job on the `automation` queue with the event name, the event id and the entity context. The job id SHALL be the event id, so a redelivered event does not enqueue a second evaluation. The API process SHALL NOT call `triggerAutomation()` inline from event subscribers.

#### Scenario: Automation event enqueued by API
- **WHEN** the automation subscriber job receives an event matching an automation trigger
- **THEN** it enqueues an `automation:evaluate` job whose id is the event id and does not execute automation actions inline

#### Scenario: Standalone worker is down when job is enqueued
- **WHEN** the `automation` queue worker process is not running
- **THEN** the job remains in the BullMQ queue until the worker restarts and processes it

#### Scenario: Same event delivered twice
- **WHEN** the automation subscriber job processes event E twice
- **THEN** the `automation` queue holds one `automation:evaluate` job for E

### Requirement: Unified Contact Tagging Emits contact.tagged

All contact-tagging write paths — manual tagging, short-link click auto-tag, and automation `add_tag` — SHALL result in a `contact.tagged` event being emitted, so that automation rules triggered by tagging fire consistently regardless of which path added the tag. Tagging SHALL remain idempotent (adding an existing tag SHALL NOT duplicate). The `contact.tagged` event SHALL carry a `source` field ('agent' | 'system' | 'automation') indicating which path added it.

#### Scenario: Short-link click auto-tag emits event

- **WHEN** a contact clicks a short link with `tagOnClick` set
- **THEN** the tag is added (idempotently) and a `contact.tagged` event with source 'system' is emitted

#### Scenario: Automation add_tag emits event

- **WHEN** an automation `add_tag` action tags a contact
- **THEN** a `contact.tagged` event with source 'automation' is written to the outbox in the same transaction as the tag

#### Scenario: Manual tagging still emits event

- **WHEN** an agent manually tags a contact
- **THEN** a `contact.tagged` event with source 'agent' is emitted (existing behaviour preserved)

## ADDED Requirements

### Requirement: 每則入站訊息最多一則機器人回覆

agent 回覆、KB 自動回覆與自動轉接的轉接訊息，都是對同一則入站訊息的機器人回覆。系統 MUST 在送出之前以「`bot_reply` + 入站訊息 id」認領，認領失敗時 MUST NOT 送出。認領 MUST 與寫入回覆訊息在同一個交易。

#### Scenario: 同一則訊息處理兩次

- **WHEN** `message.received` 事件被處理兩次，第一次已送出 agent 回覆
- **THEN** 客人 MUST 只收到一則回覆，對話 MUST 只有一則機器人回覆訊息

#### Scenario: agent 失敗改由 KB 回覆

- **WHEN** agent 產生回覆時丟出錯誤，系統改用 KB 自動回覆
- **THEN** KB 的認領 MUST 成功，客人 MUST 收到 KB 的回覆

#### Scenario: 已認領就不呼叫 LLM

- **WHEN** 處理 `message.received` 時，這則入站訊息已經有 `bot_reply` 認領紀錄
- **THEN** 系統 MUST NOT 呼叫 agent 或 KB 的 LLM

### Requirement: 規則動作每個事件最多執行一次

workers 執行 `automation:evaluate` job 的每個規則動作之前，MUST 以「`automation_action` + 事件 id + `<規則 id>#<動作序號>`」認領，認領失敗時 MUST NOT 執行該動作。SLA 規則的動作不在此限，由「SLA Outcome Recorded Once Per Deadline」保證。

#### Scenario: 同一個事件評估兩次

- **WHEN** 事件 E 的 `automation:evaluate` job 執行兩次，規則 R 的動作是 `send_message`
- **THEN** 客人 MUST 只收到一則訊息

#### Scenario: 升級工單不重複升級

- **WHEN** 事件 E 的 `automation:evaluate` job 執行兩次，規則 R 的動作是沒有指定優先度的 `escalate_case`，工單原本是 `LOW`
- **THEN** 工單的優先度 MUST 是 `MEDIUM`

#### Scenario: 不同事件各自執行

- **WHEN** 事件 E1 與 E2 都觸發規則 R 的 `send_message`
- **THEN** 客人 MUST 收到兩則訊息

### Requirement: 關鍵字規則在處理收到的訊息時比對

workers 處理 `message.received` 的規則評估時，MUST 一併比對啟用中的 `keyword.matched` 規則，並以 `keyword.matched` 作為這些規則的觸發事件執行。系統 MUST NOT 另外發出內部的 `keyword.matched` 事件來觸發規則評估。

#### Scenario: 訊息命中關鍵字規則

- **WHEN** 收到文字「營業時間」，啟用中的 `keyword.matched` 規則 R 的關鍵字是「營業時間」，動作是 `send_message`
- **THEN** workers MUST 執行 R 的 `send_message`，LINE 渠道在回覆期限內 MUST 用 reply 送出

#### Scenario: 訊息沒有命中

- **WHEN** 收到文字「你好」，沒有規則的關鍵字出現在這則訊息
- **THEN** workers MUST NOT 執行任何 `keyword.matched` 規則

### Requirement: 關鍵字的比對結果一致

決定 AI 是否讓步與 workers 執行關鍵字規則時，MUST 用同一套比對規則，對同一則訊息得出相同的命中結果。空白或非字串的關鍵字 MUST NOT 命中任何訊息。

#### Scenario: 舊資料含空白關鍵字

- **WHEN** 規則 R 的關鍵字是 `['']`（加上存檔驗證之前的資料），收到文字「你好」
- **THEN** workers MUST NOT 執行 R，系統 MUST 照常嘗試 AI 回覆

### Requirement: keyword.matched 每則訊息每條規則最多發出一次

關鍵字規則命中時，系統 MUST 發出 `keyword.matched` 事件，供對外 webhook 使用。發出之前 MUST 以「`keyword_matched` + 入站訊息 id + 規則 id」認領，認領失敗時 MUST NOT 發出。

#### Scenario: 同一則訊息評估兩次

- **WHEN** 訊息 M 命中規則 R，M 的規則評估執行兩次
- **THEN** 系統 MUST 只發出一個 R 的 `keyword.matched`

#### Scenario: Keyword event write fails

- **WHEN** 訊息 M 命中規則 R，認領或寫入 `keyword.matched` 的交易失敗
- **THEN** M 的規則評估 job MUST 失敗，由佇列重試

### Requirement: 情緒分析每則訊息最多一次

系統 MUST 以「`sentiment` + 入站訊息 id」認領，認領成功才寫入情緒結果；結果是負面且信心值至少 0.6 時，在同一個交易發出 `sentiment.negative`。呼叫 LLM 之前，這則訊息已經有認領紀錄時，系統 MUST NOT 呼叫 LLM。LLM 失敗時，系統 MUST 改用關鍵字判斷的結果，照常寫入並認領；查認領紀錄或交易失敗時，處理 MUST 失敗並由佇列重試。

#### Scenario: 同一則訊息處理兩次

- **WHEN** 訊息 M 的情緒是負面、信心值 0.8，`message.received` 被處理兩次
- **THEN** 系統 MUST 只發出一個 `sentiment.negative`，第二次 MUST NOT 呼叫 LLM

#### Scenario: 兩次處理同時進行

- **WHEN** 訊息 M 的兩次處理同時通過 LLM 前的檢查，都呼叫了 LLM
- **THEN** 只有一次 MUST 寫入結果並發出 `sentiment.negative`

#### Scenario: Claim check fails

- **WHEN** 呼叫 LLM 之前，查訊息 M 的 `sentiment` 認領紀錄失敗
- **THEN** 處理 MUST 失敗並由佇列重試，系統 MUST NOT 呼叫 LLM

#### Scenario: Sentiment LLM fails

- **WHEN** 分析訊息「服務太差」的情緒時，LLM 回傳錯誤
- **THEN** 系統 MUST 寫入關鍵字判斷的結果（負面、信心值 0.5）並認領，處理照常完成；信心值低於 0.6，MUST NOT 發出 `sentiment.negative`
