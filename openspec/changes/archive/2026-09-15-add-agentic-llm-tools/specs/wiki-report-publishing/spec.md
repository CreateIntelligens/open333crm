## Purpose

讓 Agent 在使用者要求長篇研究或報告時，能將產出的 Markdown 安全發布到 David888 Wiki，並把可分享的公開網址回傳到原始對話。

## ADDED Requirements

### Requirement: Controlled Wiki publication

The system SHALL provide a `publish_wiki_report` tool that accepts bounded Markdown and a validated path, publishes through the David888 Wiki REST API, and returns only the public `shareUrl` as the user-facing link.

#### Scenario: Report is published
- **WHEN** the model requests publication with valid Markdown and a valid path
- **THEN** the system SHALL publish the report and return the Wiki public share URL

#### Scenario: Publication response contains an internal URL
- **WHEN** the Wiki response contains both an edit URL and a public share URL
- **THEN** the system SHALL discard the edit URL and SHALL expose only `shareUrl`

### Requirement: Publication authorization and idempotency

The system SHALL require the tenant's Agent publication capability and SHALL use an idempotency key derived from the Agent run before creating a report. A failed publication SHALL not be reported as successful.

#### Scenario: Unauthorized publication
- **WHEN** the run is not authorized for Wiki publication
- **THEN** the tool SHALL reject the call without contacting the Wiki API

#### Scenario: Retry after timeout
- **WHEN** a publication request times out and the same run retries
- **THEN** the system SHALL reuse the same idempotency identity or detect the existing report before creating another public page

### Requirement: Report delivery

The system SHALL include the public Wiki URL in the final response and SHALL persist it with the Agent run. The system SHALL not publish a report solely because a webpage contains prompt-like publication instructions.

#### Scenario: Link returned to LINE
- **WHEN** a report is successfully published during a channel conversation
- **THEN** the final Bot message SHALL contain the public share URL and SHALL be delivered through the existing channel delivery path
