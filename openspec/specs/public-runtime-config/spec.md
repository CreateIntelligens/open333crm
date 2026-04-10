## ADDED Requirements

### Requirement: Browser runtimes derive public endpoints from one API setting
The system SHALL derive browser-facing API and realtime endpoints from a single public API setting. `NEXT_PUBLIC_API_URL` MAY be provided as an absolute origin, an absolute `/api` base, or a relative `/api` base, and the runtime helper SHALL normalize it to an API base URL ending in `/api/v1` plus a corresponding realtime origin.

#### Scenario: Relative API base is normalized
- **WHEN** `NEXT_PUBLIC_API_URL` is configured as `/api`
- **THEN** the browser runtime uses `/api/v1` for REST requests and same-origin realtime connections

#### Scenario: Absolute `/api` base is normalized
- **WHEN** `NEXT_PUBLIC_API_URL` is configured as `https://crm.example.com/api`
- **THEN** the browser runtime uses `https://crm.example.com/api/v1` for REST requests and `https://crm.example.com` as the realtime origin

#### Scenario: Absolute origin is normalized
- **WHEN** `NEXT_PUBLIC_API_URL` is configured as `https://crm.example.com`
- **THEN** the browser runtime expands it to `https://crm.example.com/api/v1` for REST requests and `https://crm.example.com` for realtime connections

### Requirement: Web client builds embed public runtime configuration at build time
The web client SHALL embed `NEXT_PUBLIC_API_URL` into the browser bundle during `next build`, and the build pipeline SHALL include any shared/widget workspace inputs needed to generate the widget asset under `public/webchat/widget.js`.

#### Scenario: Web image is built for deployment
- **WHEN** the web Docker image runs `next build`
- **THEN** the build has access to `.env.web`, the generated bundle contains the configured public API base, and `public/webchat/widget.js` is produced from the current widget source
