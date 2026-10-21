# Spec Delta

## Purpose

定義副作用的認領紀錄：執行一個不能重複的副作用之前，先以認領鍵寫入一筆紀錄，讓同一個副作用在事件重送、job 重試或並行處理時最多執行一次。

## ADDED Requirements

### Requirement: 一個認領鍵只能認領一次

認領鍵由種類、來源 id 與子鍵組成。系統以一個認領鍵認領時，該鍵沒有紀錄就寫入並回報成功；已經有紀錄就回報失敗。認領失敗 MUST NOT 讓所在的交易失效，交易內之後的查詢 MUST 照常執行。

#### Scenario: 第一次認領

- **WHEN** 交易內以 `bot_reply`、入站訊息 M 認領，之前沒有這個鍵的紀錄
- **THEN** 認領 MUST 回報成功，交易 commit 之後 MUST 有一筆紀錄

#### Scenario: 已經認領過

- **WHEN** 交易內以 `bot_reply`、入站訊息 M 認領，這個鍵已經有紀錄
- **THEN** 認領 MUST 回報失敗，同一個交易內之後的查詢 MUST 成功

#### Scenario: 子鍵不同

- **WHEN** 已經有 `automation_action`、事件 E、子鍵 `R1#0` 的紀錄，交易內以子鍵 `R1#1` 認領
- **THEN** 認領 MUST 回報成功

#### Scenario: 兩個交易同時認領同一個鍵

- **WHEN** 兩個交易同時以同一個認領鍵認領，兩個交易都 commit
- **THEN** 只有一個交易的認領 MUST 回報成功

#### Scenario: 先認領的交易 rollback

- **WHEN** 交易 T1 認領鍵 K 之後 rollback，交易 T2 之後以 K 認領
- **THEN** T2 的認領 MUST 回報成功

### Requirement: 認領之後失敗不再執行

認領成功之後，副作用執行失敗或行程中斷時，系統 MUST NOT 還原認領紀錄。之後以同一個鍵認領 MUST 回報失敗，副作用 MUST NOT 再執行。

#### Scenario: 送出失敗後重試

- **WHEN** job 認領 `bot_reply`、入站訊息 M 成功，送出回覆時渠道回傳錯誤，BullMQ 重試這個 job
- **THEN** 重試時的認領 MUST 回報失敗，系統 MUST NOT 再送出回覆

### Requirement: 認領紀錄受租戶隔離並保存 30 天

認領紀錄 MUST 受 RLS 約束，每筆都屬於一個租戶。系統 MUST 每天刪除建立超過 30 天的認領紀錄。

#### Scenario: 建立 31 天的紀錄

- **WHEN** 清理排程執行時，一筆認領紀錄已建立 31 天
- **THEN** 該紀錄 MUST 被刪除

#### Scenario: 建立 29 天的紀錄

- **WHEN** 清理排程執行時，一筆認領紀錄已建立 29 天
- **THEN** 該紀錄 MUST NOT 被刪除
