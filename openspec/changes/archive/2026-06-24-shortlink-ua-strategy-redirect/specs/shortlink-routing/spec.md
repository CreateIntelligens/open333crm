## MODIFIED Requirements

### Requirement: Public shortlinks resolve on the public origin
Public shortlinks SHALL be reachable at `/s/:slug` on the same public origin exposed to browsers, while the reverse proxy forwards those requests to the API redirect handler. The API handler SHALL return a **User-Agent–appropriate HTTP 200 HTML response** (a bot OG preview, or a human zero-click redirect page) instead of an HTTP 301/302 redirect; navigation to the target URL happens client-side via JavaScript.

#### Scenario: Public shortlink request arrives through the edge proxy
- **WHEN** a browser requests `https://crm.example.com/s/promo-123`
- **THEN** the public proxy forwards `/s/promo-123` to the API runtime and the API returns the UA-appropriate HTTP 200 HTML response (no 301/302)

#### Scenario: API generates a QR code URL
- **WHEN** the shortlink QR code endpoint generates the public URL for a slug
- **THEN** the URL uses `${API_BASE_URL}/s/:slug` rather than an internal service port
