## Purpose

Equips the Open333CRM Agent runner with multimodal tools (`ocr_image` and `parse_document`) to extract text and structured data from customer screenshots, receipts, invoices, and office documents using 2md upstream engines.

## ADDED Requirements

### Requirement: `ocr_image` Tool Definition and Execution
The system SHALL provide an `ocr_image` tool in the Agent tool registry that accepts a public HTTP(S) image URL or image attachment identifier, sends it to the 2md OCR service (`POST /api/ocr`), and returns normalized Markdown containing detected text lines.

#### Scenario: Image OCR extraction succeeds
- **WHEN** the agent invokes `ocr_image` with a valid, accessible image URL (PNG, JPEG, WEBP)
- **THEN** the system calls the 2md OCR endpoint via the resilient client
- **AND** returns normalized Markdown text with extracted line content to the Agent runner

#### Scenario: Unsafe or invalid image URL
- **WHEN** the provided image URL fails SSRF safety checks or is not a valid HTTP(S) URL
- **THEN** the tool rejects the invocation before making any upstream call

#### Scenario: Oversized image payload
- **WHEN** the image exceeds the maximum supported size (10 MB)
- **THEN** the tool returns an explicit error indicating the image size limit was exceeded

### Requirement: `parse_document` Tool Definition and Execution
The system SHALL provide a `parse_document` tool in the Agent tool registry that accepts an accessible document URL (PDF, DOCX, XLSX, CSV, PPTX), calls the 2md AnyDoc endpoint, and returns clean Markdown representation bounded by the content character limit.

#### Scenario: Document parsed to Markdown
- **WHEN** the agent invokes `parse_document` with a supported document format URL
- **THEN** the tool converts the document into Markdown using the 2md AnyDoc engine
- **AND** returns the resulting Markdown text bounded by the agent content limit (e.g. 30,000 characters)

#### Scenario: Unsupported document type
- **WHEN** the agent submits a file type not supported by AnyDoc (e.g., executable binary or archive)
- **THEN** the tool rejects the operation with a descriptive error message
