## ADDED Requirements

### Requirement: Short Link Form Rejects Blank Target URL
The short link create and edit form SHALL keep its save button disabled while the target URL is empty after trimming whitespace.

#### Scenario: Whitespace-only target URL
- **WHEN** a user types only spaces into the target URL field
- **THEN** the save button SHALL be disabled and no request SHALL be sent
