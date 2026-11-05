## ADDED Requirements

### Requirement: 評分後收件匣的問卷卡片顯示分數

系統記錄一張工單的滿意度分數時（客人回覆或客服代評），SHALL 在這張工單的每則問卷訊息（`contentType` 是 `csat`、`metadata.caseId` 是這張工單、所在對話屬於同一租戶並連結這張工單）的 `metadata` 寫入 `csatScore`（分數）與 `csatRatedBy`（客人回覆是 `customer`，客服代評是 `agent`），保留原有的 `metadata` 欄位，並對每則更新的問卷訊息推送一次帶有新 `metadata` 的 `message.new`。收件匣的問卷卡片有分數時 SHALL 唯讀，顯示分數與評分者（「客人評 N 分」或「客服代評 N 分」）。

#### Scenario: 客人評分後問卷卡片顯示分數

- **WHEN** 工單有一則問卷訊息，客人回覆 2 分
- **THEN** 問卷訊息的 `metadata.csatScore` 是 2、`metadata.csatRatedBy` 是 `customer`、原有的 `metadata.caseId` 保留，系統推送一次 `message.new`，訊息 ID 是這則問卷訊息、`metadata.csatScore` 是 2

#### Scenario: 客服代評後問卷卡片標明客服代評

- **WHEN** 客服以 `POST /cases/:id/csat` 替一張有問卷訊息的工單評 4 分
- **THEN** 問卷訊息的 `metadata.csatScore` 是 4、`metadata.csatRatedBy` 是 `agent`

#### Scenario: 有分數的問卷卡片唯讀

- **WHEN** 收件匣顯示一則 `metadata.csatScore` 是 2、`metadata.csatRatedBy` 是 `customer` 的問卷訊息
- **THEN** 卡片顯示「客人評 2 分」，五顆星都不能點

### Requirement: 評分寫入工單時間軸

系統記錄滿意度分數時 SHALL 在工單時間軸寫入一筆 `eventType` 為 `csat_rated` 的事件，`payload.score` 是分數、`payload.source` 是 `customer` 或 `agent`；客人回覆時 `actorType` 是 `contact`，客服代評時 `actorType` 是 `agent`、`actorId` 是評分的客服。評分後系統自動關閉工單時，若工單原本不是 `CLOSED`，SHALL 再寫入一筆 `eventType` 為 `status_changed` 的事件，`actorType` 是 `system`，`payload.from` 是原狀態、`payload.to` 是 `CLOSED`、`payload.reason` 是 `csat_rated`。工單時間軸 SHALL 以中文顯示這兩筆事件，標明客人評分或客服代評；工單詳情頁 SHALL 顯示滿意度分數。

#### Scenario: 客人評分後時間軸有評分與自動關閉紀錄

- **WHEN** 狀態是 `RESOLVED` 的工單，客人回覆 2 分
- **THEN** 工單多一筆 `csat_rated` 事件（`actorType` 是 `contact`、`payload.score` 是 2、`payload.source` 是 `customer`），以及一筆 `status_changed` 事件（`actorType` 是 `system`、`from` 是 `RESOLVED`、`to` 是 `CLOSED`、`reason` 是 `csat_rated`）

#### Scenario: 客服代評的時間軸紀錄標明客服

- **WHEN** 客服替一張工單評 4 分
- **THEN** `csat_rated` 事件的 `actorType` 是 `agent`、`actorId` 是這位客服、`payload.source` 是 `agent`

#### Scenario: 時間軸以中文顯示評分與自動關閉

- **WHEN** 工單時間軸有一筆 `payload.source` 是 `customer`、`payload.score` 是 2 的 `csat_rated`，一筆 `payload.source` 是 `agent`、`payload.score` 是 4 的 `csat_rated`，以及一筆 `reason` 是 `csat_rated` 的 `status_changed`
- **THEN** 時間軸顯示「客人評分：2 分（不滿意）」、「客服代評滿意度：4 分（滿意）」與「狀態：已解決 → 已關閉（評分後自動關閉）」，不顯示 `csat_rated` 代碼

#### Scenario: 工單詳情頁顯示滿意度分數

- **WHEN** 工單詳情頁顯示一張 `csatScore` 是 2 的工單
- **THEN** 詳情頁的滿意度區塊顯示「2 分」與「不滿意」
