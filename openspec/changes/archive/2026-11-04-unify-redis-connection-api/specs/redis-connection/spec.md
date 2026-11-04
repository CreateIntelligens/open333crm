# Spec Delta

## Purpose

定義各行程建立 Redis 連線的規則：一般指令與 BullMQ／訂閱兩種用途的設定、一般指令在 Redis 故障時的等待上限，以及 API 行程的連線在什麼時候連上、什麼時候關閉。

## ADDED Requirements

### Requirement: 一般用途的 Redis 指令有等待上限

一般用途的連線用於快取、計數、短效代碼等一般指令。Redis 拒絕連線或沒有回應時，這種連線上的指令 MUST 在 1 秒內以錯誤結束，MUST NOT 一直等待。

#### Scenario: Redis 拒絕連線

- **WHEN** 一般用途的連線指向一個沒有程式監聽的 port，呼叫端執行 `GET`
- **THEN** 呼叫端在 1 秒內收到錯誤

#### Scenario: Redis 接受連線但不回應

- **WHEN** 一般用途的連線指向一個接受 TCP 連線、但不回傳任何資料的 server，呼叫端執行 `GET`
- **THEN** 呼叫端在 1 秒內收到錯誤

### Requirement: BullMQ 與訂閱用途的連線不限制指令的等待時間

BullMQ 與訂閱用途的連線 MUST 符合 BullMQ 對連線的要求：Redis 暫時沒有回應時，指令 MUST 等到 Redis 恢復，MUST NOT 因為等待時間而失敗。

#### Scenario: 交給 BullMQ 的 Worker

- **WHEN** 以 BullMQ 用途的連線建立 BullMQ 的 Worker
- **THEN** Worker 建立成功，BullMQ 不回報連線設定錯誤

#### Scenario: Redis 不回應時指令繼續等待

- **WHEN** BullMQ 用途的連線指向一個接受 TCP 連線、但不回傳任何資料的 server，呼叫端執行 `GET`，經過 1.5 秒
- **THEN** 指令仍在等待，沒有以錯誤結束

### Requirement: 建立 API 應用程式時不連 Redis

API 行程註冊一般用途的 Redis 連線時，MUST NOT 連線到 Redis。第一次執行 Redis 指令時，連線 MUST 才開始。Redis 無法使用時，API 應用程式 MUST 仍然能完成註冊。

#### Scenario: Redis 無法使用時建立 API 應用程式

- **WHEN** Redis 的位址沒有程式監聽，API 應用程式註冊 Redis 連線並完成所有 plugin 的載入
- **THEN** 載入成功，Redis 連線尚未開始連線

### Requirement: 關閉 API 應用程式時關閉一般用途的連線

API 應用程式關閉時，一般用途的 Redis 連線 MUST 一起關閉。關閉之後，這條連線上的指令 MUST 以錯誤結束。

#### Scenario: 關閉 API 應用程式

- **WHEN** API 應用程式註冊 Redis 連線後關閉
- **THEN** 這條連線的狀態是已關閉，之後執行的指令以錯誤結束
