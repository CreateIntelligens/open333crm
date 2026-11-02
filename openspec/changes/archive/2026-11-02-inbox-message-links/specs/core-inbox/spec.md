## ADDED Requirements

### Requirement: Inbox text messages show web addresses as links
The inbox SHALL show each `http://` or `https://` address in a text message as a link that opens in a new tab with `rel="noopener noreferrer"`. This applies to messages from the customer, an agent and the bot. Punctuation directly after the address SHALL NOT be part of the link. Other schemes SHALL stay plain text, and the inbox SHALL NOT parse message text as HTML. System notices SHALL stay plain text.

#### Scenario: Customer message with an address
- **WHEN** the inbox shows an inbound text message `我看 https://example.com/p/1 這頁`
- **THEN** the message has one link with `href` `https://example.com/p/1`, target `_blank` and `rel` `noopener noreferrer`, and the text before and after the link stays plain text

#### Scenario: Bot reply with an address
- **WHEN** the inbox shows a bot text message `請看 https://example.com/manual—有問題再問我`
- **THEN** the message has one link with `href` `https://example.com/manual`, and `—有問題再問我` is not part of the link

#### Scenario: Other schemes and HTML stay text
- **WHEN** the inbox shows a text message `javascript:alert(1) <a href="https://x.test">x</a>`
- **THEN** the message has no link for `javascript:`, and shows the HTML tag as text, not as an element

#### Scenario: System notice stays text
- **WHEN** the inbox shows a system message `請看 https://example.com`
- **THEN** the message has no link
