## Purpose

規定分析報表 API 的共用規則，例如日期區間，讓報表不會因為參數錯誤而回傳看似正常的空資料。

## ADDED Requirements

### Requirement: Analytics Date Range Must Be Ordered
Every analytics endpoint that accepts `from` and `to` SHALL respond 400 naming the `from` field when `from` is later than `to`.

#### Scenario: Reversed date range
- **WHEN** a user requests `GET /api/v1/analytics/overview?from=2026-12-31&to=2020-01-01`
- **THEN** the system SHALL respond 400 and `error.details.issues` SHALL contain the path `from`

#### Scenario: Same day
- **WHEN** a user requests the overview with `from` and `to` on the same instant
- **THEN** the system SHALL return the report
