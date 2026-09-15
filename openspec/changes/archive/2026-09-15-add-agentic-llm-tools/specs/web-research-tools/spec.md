## Purpose

提供可由 Agent 自主呼叫的即時網頁搜尋與網頁閱讀工具，統一使用指定的 2md.aiurl.tw 主服務和兩層 fallback，讓回答可以引用最新外部資料。

## ADDED Requirements

### Requirement: Live web search

The system SHALL provide a `search_web` tool that accepts a non-empty query, calls `https://2md.aiurl.tw/` search endpoints first, then `https://2md.glsoft.ai/`, then `https://create360.ai`, and returns bounded, structured results including title, URL, and snippet where available.

#### Scenario: Primary search succeeds
- **WHEN** a valid query is submitted and the primary service returns usable content
- **THEN** the tool SHALL return normalized search results and SHALL record the primary service as the source

#### Scenario: Search fallback
- **WHEN** a service is unavailable, times out, or returns an invalid response
- **THEN** the tool SHALL try the next configured service and SHALL return an error only after all services fail

### Requirement: Safe web page reading

The system SHALL provide a `read_web_page` tool that accepts only an absolute HTTP(S) URL, rejects local/private/link-local/metadata network targets and embedded credentials, and returns bounded Markdown content with the final source URL.

#### Scenario: Page is read successfully
- **WHEN** a public HTTP(S) URL is supplied
- **THEN** the tool SHALL read it through the configured 2md fallback chain and return sanitized bounded Markdown

#### Scenario: Unsafe URL is rejected
- **WHEN** the URL targets localhost, a private IP, a link-local address, an unsupported scheme, or contains credentials
- **THEN** the tool SHALL reject it before making an outbound request

### Requirement: Untrusted external content

The system SHALL treat all search and page content as untrusted data, SHALL cap response size and request duration, and SHALL label tool output as reference material that cannot override system or safety instructions.

#### Scenario: Oversized response
- **WHEN** an upstream response exceeds the configured content limit
- **THEN** the tool SHALL truncate the returned content and record that truncation occurred
