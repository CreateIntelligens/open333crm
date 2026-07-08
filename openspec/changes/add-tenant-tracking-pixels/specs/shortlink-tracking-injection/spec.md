## ADDED Requirements

### Requirement: External browser strategy injects GA4 script

When a shortlink is accessed by an external browser and the tenant has a `gaId` configured, the redirect micro-page SHALL include the Google Analytics 4 gtag.js script with `gtag('config', gaId)` and fire a `page_view` event.

#### Scenario: External browser with GA4 configured

- **WHEN** a user visits `GET /s/:slug` with a browser User-Agent and the tenant has `gaId = "G-ABC123"`
- **THEN** the returned HTML contains:
  - `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>`
  - Inline script calling `gtag('config', 'G-ABC123')` and `gtag('event', 'page_view')`

#### Scenario: External browser without GA4 configured

- **WHEN** a user visits `GET /s/:slug` with a browser User-Agent and the tenant has `gaId = null`
- **THEN** the returned HTML does NOT contain any GA4 script

### Requirement: External browser strategy injects Meta Pixel script

When a shortlink is accessed by an external browser and the tenant has a `metaPixelId` configured, the redirect micro-page SHALL include the Meta Pixel base code with `fbq('init', metaPixelId)` and fire a `PageView` event.

#### Scenario: External browser with Meta Pixel configured

- **WHEN** a user visits `GET /s/:slug` with a browser User-Agent and the tenant has `metaPixelId = "1234567890"`
- **THEN** the returned HTML contains:
  - The Meta Pixel base code snippet
  - `fbq('init', '1234567890')`
  - `fbq('track', 'PageView')`

#### Scenario: External browser without Meta Pixel configured

- **WHEN** a user visits `GET /s/:slug` with a browser User-Agent and the tenant has `metaPixelId = null`
- **THEN** the returned HTML does NOT contain any Meta Pixel script

### Requirement: FB WebView strategy injects tracking scripts

The FB WebView strategy (Facebook/Instagram in-app browser) SHALL inject the same tracking scripts as the external browser strategy.

#### Scenario: Facebook in-app browser with tracking configured

- **WHEN** a user visits `GET /s/:slug` from Facebook/Instagram in-app browser and the tenant has tracking IDs configured
- **THEN** the returned HTML contains both GA4 and Meta Pixel scripts (if configured)

### Requirement: LINE WebView strategy injects tracking scripts

The LINE WebView strategy SHALL inject tracking scripts into the micro-page that redirects to LIFF (before the LIFF redirect occurs).

#### Scenario: LINE in-app browser with LIFF and tracking

- **WHEN** a user visits `GET /s/:slug` from LINE in-app browser, the link has a bound LIFF channel, and the tenant has tracking IDs configured
- **THEN** the returned HTML contains both GA4 and Meta Pixel scripts before the LIFF redirect

#### Scenario: LINE in-app browser without LIFF

- **WHEN** a user visits `GET /s/:slug` from LINE in-app browser, the link has no LIFF channel, and the tenant has tracking IDs configured
- **THEN** the system falls back to external-browser strategy and injects tracking scripts

### Requirement: BOT strategy does NOT inject tracking scripts

The BOT strategy SHALL NOT include any tracking scripts, as crawlers do not execute JavaScript.

#### Scenario: Bot crawler visits shortlink

- **WHEN** a bot crawler (Googlebot, LINE Poker, etc.) visits `GET /s/:slug`
- **THEN** the returned HTML contains only OG meta tags and no tracking scripts, regardless of tenant tracking configuration

### Requirement: Tracking scripts do not block redirect

The injected tracking scripts SHALL be placed after `sendBeacon` and before `window.location.replace`, but SHALL NOT block the redirect.

#### Scenario: Tracking script execution order

- **WHEN** a browser renders the redirect micro-page
- **THEN** the execution order is:
  1. sendBeacon POST to /s/track (click recording)
  2. GA4 gtag.js loads async and fires page_view
  3. Meta Pixel base code fires PageView
  4. window.location.replace redirects to target URL

### Requirement: Cache headers prevent stale tracking

The redirect response SHALL include `Cache-Control: no-store` to ensure fresh tracking configuration is always served.

#### Scenario: Tracking response is not cached

- **WHEN** a browser receives the redirect micro-page
- **THEN** the response includes `Cache-Control: no-store, no-cache, must-revalidate`
