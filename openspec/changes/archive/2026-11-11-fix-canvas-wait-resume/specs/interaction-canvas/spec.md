## MODIFIED Requirements

### Requirement: 節點執行引擎 (Node Execution Engine)
系統 SHALL 具備一套能解析 JSON 節點並按順序執行的引擎。引擎必須支援「等待 (Wait)」節點，且能處理非同步事件。

流程走到等待節點時 SHALL 暫停，狀態改為 `WAITING` 並記下 `resumeAt`，`currentNodeId` 停在這個等待節點。`resumeAt` 到期後喚醒時，引擎 SHALL 從這個等待節點的下一個節點繼續，MUST NOT 再執行同一個等待節點；等待節點沒有下一個節點時，流程 SHALL 完成。

#### Scenario: 執行簡單的訊息發送流
- **WHEN** 聯繫人觸發流程且當前節點為「發送訊息」
- **THEN** 系統必須呼叫對應通路的 API 發送訊息，並將聯繫人狀態更新至下一個節點

#### Scenario: 喚醒後從等待節點的下一個節點繼續
- **WHEN** 流程 `TRIGGER → WAIT → MESSAGE` 停在等待節點，`resumeAt` 到期後排程喚醒
- **THEN** 系統送出 `MESSAGE` 節點的訊息，execution 狀態變成 `COMPLETED`；等待節點只排程一次（只有一筆 `wait_scheduled` 紀錄）

#### Scenario: 等待節點是最後一個節點
- **WHEN** 流程 `TRIGGER → WAIT` 停在等待節點，`resumeAt` 到期後排程喚醒
- **THEN** execution 狀態變成 `COMPLETED`，不會從 `TRIGGER` 重新開始

#### Scenario: 連續兩個等待節點
- **WHEN** 流程 `TRIGGER → WAIT → WAIT → MESSAGE` 第一次喚醒
- **THEN** execution 停在第二個等待節點，狀態是 `WAITING`，還沒有送出訊息；第二次喚醒後送出訊息並完成

## ADDED Requirements

### Requirement: 同一次等待只喚醒一次
喚醒排程 SHALL 只恢復 `status` 為 `WAITING` 而且 `resumeAt` 已到期的 execution。排程 SHALL 在 execution 所屬租戶的交易內以條件更新把它改成 `RUNNING`，只有更新成功的那一次 SHALL 恢復執行。兩次喚醒同時處理同一筆 execution 時，系統 SHALL 只恢復一次。

#### Scenario: 兩次喚醒同時執行
- **WHEN** 兩次喚醒排程同時查到同一筆到期的 `WAITING` execution，並同時認領
- **THEN** 流程引擎只以這筆 execution 開始執行一次；execution 狀態是 `RUNNING`，`resumeAt` 是空值

#### Scenario: 已被另一次喚醒認領
- **WHEN** 排程查到一筆到期的 execution，認領之前它已被改成 `RUNNING`
- **THEN** 這次排程不恢復這筆 execution

#### Scenario: 時間還沒到
- **WHEN** `WAITING` execution 的 `resumeAt` 在未來，喚醒排程執行
- **THEN** 這筆 execution 不恢復，狀態仍是 `WAITING`
