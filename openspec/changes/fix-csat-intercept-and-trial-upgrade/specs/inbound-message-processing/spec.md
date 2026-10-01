## MODIFIED Requirements

### Requirement: Postback intercept behavior remains unchanged
The refactor SHALL preserve existing postback/text intercept behavior for CSAT, KB feedback, and handoff requests. For CSAT, the system SHALL record a score only when the case belongs to the receiving tenant and to the contact that sent the message.

#### Scenario: CSAT response intercepted
- **WHEN** inbound text or postback data matches `csat:<score>:<caseId>`, the score is 1 to 5, the case belongs to the receiving tenant, the case contact is the sending contact, and the case has no CSAT score yet
- **THEN** the system SHALL record the CSAT score on that case, send the follow-up message, and return without publishing `message.received`

#### Scenario: CSAT response for a case of another tenant
- **WHEN** inbound text or postback data matches `csat:<score>:<caseId>` and the case belongs to a tenant other than the receiving tenant
- **THEN** the system SHALL NOT change that case, SHALL NOT send any message on that case's conversation, SHALL NOT notify any agent, and SHALL return without publishing `message.received`

#### Scenario: CSAT response for a case of another contact
- **WHEN** inbound text or postback data matches `csat:<score>:<caseId>`, the case belongs to the receiving tenant, and the case contact is not the sending contact
- **THEN** the system SHALL NOT change that case, SHALL NOT send any message on that case's conversation, SHALL NOT notify any agent, and SHALL return without publishing `message.received`

#### Scenario: CSAT response for a case that does not exist
- **WHEN** inbound text or postback data matches `csat:<score>:<caseId>` and no case has that id
- **THEN** the system SHALL NOT change any case and SHALL return without publishing `message.received`

#### Scenario: KB feedback intercepted
- **WHEN** inbound text or postback data matches the existing KB feedback pattern
- **THEN** the system SHALL record KB feedback, send the thank-you reply when possible, and return without publishing `message.received`

#### Scenario: Handoff request intercepted
- **WHEN** inbound text or postback data matches `handoff_request`
- **THEN** the system SHALL preserve the current idempotent handoff behavior, including botConfig handoff message lookup, conversation status transition when applicable, system message emission, `conversation.handoff` publication, and no `message.received` publication
