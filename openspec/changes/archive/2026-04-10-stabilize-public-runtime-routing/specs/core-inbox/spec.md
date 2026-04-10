## ADDED Requirements

### Requirement: Inbox message input respects IME composition
The inbox message input SHALL NOT submit a message when the Enter key is pressed while IME composition is active. Enter submission SHALL only occur after composition ends, while Shift+Enter continues to insert a newline.

#### Scenario: Agent is choosing a Chinese candidate
- **WHEN** the agent presses Enter to confirm an IME candidate in the inbox textarea
- **THEN** the message is not sent and the textarea remains editable

#### Scenario: Agent inserts a newline
- **WHEN** the agent presses Shift+Enter in the inbox textarea
- **THEN** the textarea inserts a newline instead of sending the message

#### Scenario: Agent sends after composition completes
- **WHEN** IME composition has ended and the agent presses Enter without Shift
- **THEN** the current message is submitted once
