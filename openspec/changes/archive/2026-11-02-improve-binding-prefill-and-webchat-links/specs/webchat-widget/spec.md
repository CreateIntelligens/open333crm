## ADDED Requirements

### Requirement: Web addresses in text messages are links
The embeddable widget and the `/chatbox` page SHALL show each `http://` or `https://` address in a text message from an agent, a bot or the greeting as a link that opens in a new tab with `rel="noopener noreferrer"`. Punctuation directly after the address SHALL NOT be part of the link. Other schemes and text that the visitor sends SHALL stay plain text. The clients SHALL NOT parse message text as HTML.

#### Scenario: Agent reply with an address
- **WHEN** the widget receives an `agent:message` with the text `請點 https://m.me/shop?ref=BIND-7K2M9QH4TX 完成綁定`
- **THEN** the message has one link with `href` `https://m.me/shop?ref=BIND-7K2M9QH4TX`, target `_blank`, and the text before and after the link stays plain text

#### Scenario: Chatbox message with an address
- **WHEN** the `/chatbox` page shows a text message `網址：https://example.com/a。`
- **THEN** the message has one link with `href` `https://example.com/a`, and `。` is not part of the link

#### Scenario: Other schemes stay text
- **WHEN** a text message contains `javascript:alert(1)` or `<a href="https://x.test">x</a>`
- **THEN** the widget and the `/chatbox` page create no link for `javascript:`, and show the HTML tag as text, not as an element

#### Scenario: Visitor's own address stays text
- **WHEN** a visitor sends the text `https://example.com/a`
- **THEN** the widget and the `/chatbox` page show the message with no link
