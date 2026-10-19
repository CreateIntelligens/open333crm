## ADDED Requirements

### Requirement: Widget shows each message on the side of its sender
The widget SHALL show the messages that the visitor sends on the right side with the `o333-msg-out` style. This includes text, images, videos, and the placeholder that the widget shows while a file uploads. The widget SHALL show agent replies, bot replies and the greeting on the left side with the `o333-msg-in` style.

#### Scenario: Visitor message is on the visitor's side
- **WHEN** a visitor submits text
- **THEN** the widget shows the message with the `o333-msg-out` class and not the `o333-msg-in` class

#### Scenario: Agent and bot messages are on the other side
- **WHEN** the widget shows the greeting, or receives an `agent:message` event
- **THEN** the widget shows the message with the `o333-msg-in` class and not the `o333-msg-out` class

#### Scenario: Visitor media placeholder is on the visitor's side
- **WHEN** a visitor selects an image or a video and the upload has not finished
- **THEN** the placeholder message has the `o333-msg-out` class
