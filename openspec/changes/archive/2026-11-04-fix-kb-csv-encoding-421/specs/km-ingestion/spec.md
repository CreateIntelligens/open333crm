## ADDED Requirements

### Requirement: CSV import decodes UTF-8 and Big5 text
When a tenant uploads a CSV file to the knowledge base (`POST /api/v1/knowledge/upload`), the system SHALL decode the file text before it parses the rows. A file that starts with a UTF-8 BOM SHALL be decoded as UTF-8 without the BOM. A file without a BOM SHALL be decoded as UTF-8 when its bytes are valid UTF-8, and otherwise as Big5. XLSX files SHALL be parsed as before.

#### Scenario: CSV import decodes UTF-8 without BOM
- **WHEN** a tenant uploads a UTF-8 CSV without a BOM whose header is `問題,答案` and whose row is `退貨要幾天,七天內可退貨`
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV import decodes UTF-8 with BOM
- **WHEN** a tenant uploads the same CSV with the bytes `EF BB BF` at the start
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV import decodes Big5 from Taiwan Excel
- **WHEN** a tenant uploads the same CSV encoded in Big5
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV import with English headers keeps Chinese content intact
- **WHEN** a tenant uploads a UTF-8 CSV without a BOM whose header is `question,answer` and whose row is `退貨要幾天,七天內可退貨`
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV without QA headers is imported as one article with readable Chinese
- **WHEN** a tenant uploads a UTF-8 CSV without a BOM whose header has no question or answer column
- **THEN** the system creates one draft article whose Markdown table contains the Chinese header and cell text unchanged

### Requirement: CSV import rejects text that cannot be decoded
When a knowledge-base CSV upload cannot be decoded as UTF-8 or Big5, or the decoded text contains the replacement character U+FFFD, the system SHALL write no article from that file. It SHALL report that file as failed with code `CSV_ENCODING_UNREADABLE` and a Traditional Chinese reason that tells the user to save the file as "CSV UTF-8". Other files in the same upload SHALL be processed as before.

#### Scenario: CSV that cannot be decoded is rejected and nothing is written
- **WHEN** a tenant uploads a CSV whose bytes are valid in neither UTF-8 nor Big5
- **THEN** the upload result for that file has `success: false`, `code: CSV_ENCODING_UNREADABLE` and a Chinese error that mentions UTF-8
- **AND** no article is created from that file

#### Scenario: CSV that already contains replacement characters is rejected
- **WHEN** a tenant uploads a UTF-8 CSV whose text contains U+FFFD
- **THEN** the file is rejected with code `CSV_ENCODING_UNREADABLE` and no article is created from that file
