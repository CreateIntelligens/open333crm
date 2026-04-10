## ADDED Requirements

### Requirement: Public shortlinks resolve on the public origin
Public shortlinks SHALL be reachable at `/s/:slug` on the same public origin exposed to browsers, while the reverse proxy forwards those requests to the API redirect handler.

#### Scenario: Public shortlink request arrives through the edge proxy
- **WHEN** a browser requests `https://crm.example.com/s/promo-123`
- **THEN** the public proxy forwards `/s/promo-123` to the API runtime and the API returns the configured redirect response

#### Scenario: API generates a QR code URL
- **WHEN** the shortlink QR code endpoint generates the public URL for a slug
- **THEN** the URL uses `${API_BASE_URL}/s/:slug` rather than an internal service port

### Requirement: Admin UI copies the public shortlink URL
The shortlink admin UI SHALL copy the public `/s/:slug` URL from the current browser origin instead of inferring the API service port.

#### Scenario: Admin copies a shortlink in production
- **WHEN** the dashboard is opened at `https://crm.example.com`
- **THEN** copying a slug produces `https://crm.example.com/s/<slug>`

#### Scenario: Admin copies a shortlink on localhost web dev
- **WHEN** the dashboard is opened at `http://localhost:3000`
- **THEN** copying a slug produces `http://localhost/s/<slug>` so the request still flows through the local edge proxy
