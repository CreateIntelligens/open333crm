## MODIFIED Requirements

### Requirement: Embeddable widget bundle
The web public runtime SHALL serve the compiled widget JS bundle at `GET /webchat/widget.js` as a static file. The embed code generator SHALL produce a `<script>` tag pointing to this URL, using `WEB_BASE_URL` when configured and otherwise deriving the public widget origin from the API base URL. The embed bootstrap SHALL populate `window.Open333CRM.apiBaseUrl`, and the widget SHALL attach a launcher button to the host page without conflicting with the page's own JS.

#### Scenario: Customer installs embed code
- **WHEN** the embed `<script>` tag is added to a webpage
- **THEN** the widget JS loads from the configured public widget origin, a chat launcher button appears in the bottom-right corner, and no JS errors are thrown on the host page

#### Scenario: Widget bundle served correctly
- **WHEN** `GET /webchat/widget.js` is requested from the public origin
- **THEN** the web runtime responds with JavaScript bundle content for the embeddable widget

### Requirement: Widget message submission respects IME composition
The widget SHALL NOT submit a message when the Enter key is pressed while IME composition is active. Enter submission SHALL only occur after composition ends.

#### Scenario: Visitor is choosing a Chinese candidate
- **WHEN** the visitor presses Enter to confirm an IME candidate in the widget input
- **THEN** the widget does not send the message and keeps the input focused for continued editing

#### Scenario: Visitor sends after composition completes
- **WHEN** IME composition has ended and the visitor presses Enter without Shift
- **THEN** the widget sends the current text message once
