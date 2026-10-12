## ADDED Requirements

### Requirement: Live sentiment result in the inbox conversation
After an inbound message receives an accepted sentiment result, the system SHALL publish that result to authorized clients viewing its conversation, and the inbox SHALL update the matching message's sentiment badge without a page reload.

#### Scenario: Sentiment result updates an open conversation
- **WHEN** sentiment analysis stores an accepted result for an inbound message whose conversation is open in an authorized inbox client
- **THEN** the API emits `message.sentiment.updated` with the conversation ID, message ID, sentiment, score, and confidence, and the client updates that message's badge immediately

#### Scenario: Sentiment result arrives for another conversation
- **WHEN** an inbox client receives `message.sentiment.updated` for a conversation it is not viewing
- **THEN** it does not change the currently displayed messages
