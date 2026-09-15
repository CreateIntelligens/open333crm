## Purpose

Define public shortlink resolution, user-agent routing, and administration behavior for open333CRM.

## Requirements

### Requirement: Public shortlinks resolve on the public origin
Public shortlinks SHALL be reachable at `/s/:slug` on the same public origin exposed to browsers, while the reverse proxy forwards those requests to the API redirect handler. The API handler SHALL return a **User-Agent–appropriate HTTP 200 HTML response** (a bot OG preview, or a human zero-click redirect page) instead of an HTTP 301/302 redirect; navigation to the target URL happens client-side via JavaScript.

#### Scenario: Public shortlink request arrives through the edge proxy
- **WHEN** a browser requests `https://crm.example.com/s/promo-123`
- **THEN** the public proxy forwards `/s/promo-123` to the API runtime and the API returns the UA-appropriate HTTP 200 HTML response (no 301/302)

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

### Requirement: Short Link Material Association

A short link SHALL optionally carry a `materialId` referencing the material that produced it. When the referenced material is deleted, the short link's `materialId` SHALL be set to null (the short link and its click history are retained). Short link creation SHALL accept an optional `materialId`; clicks continue to be recorded in `ClickLog` as before, and material attribution is derived by joining `ClickLog → ShortLink.materialId`.

#### Scenario: Create short link with material id

- **WHEN** a short link is created with a `materialId`
- **THEN** the short link stores the material association and clicks on it are attributable to that material

#### Scenario: Material deletion nulls the association

- **WHEN** a material referenced by short links is deleted
- **THEN** those short links' `materialId` becomes null and the short links (with click history) are retained

#### Scenario: Short link without material id still works

- **WHEN** a short link is created without a `materialId` (manual short link)
- **THEN** it behaves exactly as before, with no material attribution
