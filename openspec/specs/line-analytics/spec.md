## Purpose
定義 LINE 官方帳號的數據：每日洞察數據同步、每次群發的送達統計，以及資料保存期限的保護。分眾名單與 Narrowcast 的送達進度見 `line-audience`。

## Requirements

### Requirement: Daily Insight sync
The system SHALL synchronize LINE Insight data daily into the local `InsightSnapshot` table.

#### Scenario: Daily follower sync
- **WHEN** the `worker-insight-sync` runs at 00:30 UTC
- **THEN** the system calls `GET /v2/bot/insight/followers?date=YYYYMMDD` for the previous day
- **THEN** the result (`followers`, `blocks`, `targetedReaches`) is persisted in `InsightSnapshot`

#### Scenario: Demographics sync
- **WHEN** the `worker-insight-sync` runs
- **THEN** the system calls `GET /v2/bot/insight/demographic` and persists gender, age, region, OS distribution

---

### Requirement: Per-broadcast delivery stats
The system SHALL fetch per-message delivery and interaction statistics for each sent Broadcast/Narrowcast.

#### Scenario: Fetch stats after send
- **WHEN** a Broadcast completes sending and has a `requestId`
- **THEN** the system calls `GET /v2/bot/insight/message/event?requestId=` after a 2-hour delay (LINE requires time to aggregate)
- **THEN** delivered, read, and clicked counts are written to `Broadcast.deliveryStats`

---

### Requirement: Data retention guard
The system SHALL retain Insight data indefinitely in local DB regardless of LINE's 14-day retention window.

#### Scenario: Data available after 14 days
- **WHEN** an administrator queries Insight data older than 14 days
- **THEN** the system returns records from local `InsightSnapshot` table, not LINE API
