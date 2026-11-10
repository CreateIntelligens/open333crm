# Spec Delta

## ADDED Requirements

### Requirement: Agent 執行不在交易內等待外部呼叫
Agent 執行時，系統 MUST NOT 在資料庫交易內呼叫 LLM、外部工具或去識別化服務。系統 SHALL 在第一次呼叫 LLM 之前建立執行紀錄 `agentRun`。每一次工具呼叫結束後，系統 SHALL 以一個交易寫入這次的工具紀錄，commit 之後才進行下一次呼叫。每一輪的 LLM 呼叫與每一次工具呼叫最多執行一次。工具紀錄或執行紀錄寫入失敗時，系統 SHALL 把執行紀錄標成 `FAILED`，不再呼叫 LLM 或工具。

#### Scenario: A2A 任務執行超過 5 秒
- **WHEN** A2A bridge 送來一個文字任務，Agent 執行 6 秒後產生最終回答
- **THEN** bridge 收到這個回答，執行紀錄的狀態是 `COMPLETED`

#### Scenario: 執行到一半失敗時保留之前的工具紀錄
- **WHEN** Agent 第 1 輪呼叫工具並寫入工具紀錄，第 2 輪呼叫工具之後，寫入工具紀錄失敗
- **THEN** 執行紀錄的狀態是 `FAILED`
- **AND** 第 1 輪的工具紀錄仍然保存

#### Scenario: 工具紀錄寫入失敗
- **WHEN** 一次工具呼叫結束後，寫入工具紀錄的交易失敗
- **THEN** 系統不再呼叫 LLM，執行紀錄的狀態是 `FAILED`，呼叫端收到錯誤

#### Scenario: 呼叫外部服務之前交易已經結束
- **WHEN** Agent 呼叫 LLM 或工具
- **THEN** 這次呼叫開始之前，Agent 開過的交易都已經 commit
