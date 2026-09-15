## Purpose

控制 Agent 暫存上下文與工具資料的生命週期，讓執行資料和未發布草稿在建立後三天自動失效，同時保留正式 CRM 對話及已發布 Wiki 內容。

## ADDED Requirements

### Requirement: Three-day expiry

The system SHALL assign an expiry time exactly three days after creation to Agent runs, tool-call traces, and unpublished report drafts. An expired run SHALL not be resumed or execute additional tools.

#### Scenario: Expired run cannot resume
- **WHEN** a client attempts to resume a run after its expiry time
- **THEN** the system SHALL return an expired status and SHALL not call the model or any external tool

#### Scenario: Unpublished draft expires
- **WHEN** an unpublished report draft reaches its expiry time
- **THEN** the system SHALL mark it expired and SHALL remove its temporary Markdown payload

### Requirement: Scheduled cleanup

The system SHALL periodically mark expired Agent data and delete only temporary payloads and traces covered by the retention policy. It SHALL not delete CRM messages, conversations, contacts, or already published Wiki content.

#### Scenario: Cleanup is rerun
- **WHEN** cleanup runs more than once for the same expired data
- **THEN** the result SHALL be idempotent and SHALL not fail because the data was already cleaned
