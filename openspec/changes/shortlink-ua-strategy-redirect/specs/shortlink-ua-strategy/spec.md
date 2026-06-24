## ADDED Requirements

### Requirement: Source detection by User-Agent selects a redirect strategy
The system SHALL classify each `GET /s/:slug` request into a `SourceType` (`BOT`, `EXTERNAL_BROWSER`, `LINE_WEBVIEW`, or `FB_WEBVIEW`) by inspecting the `User-Agent`, and dispatch to the matching redirect strategy. Detection SHALL evaluate `BOT` first, then `LINE_WEBVIEW`, then `FB_WEBVIEW`, defaulting to `EXTERNAL_BROWSER`. The bot match list SHALL be a configurable array defaulting to at least `line-poker` and `facebookexternalhit` plus common social crawlers (`Twitterbot`, `Slackbot`, `Discordbot`, `TelegramBot`, `WhatsApp`, `Googlebot`, `bingbot`).

#### Scenario: Social crawler is classified as BOT
- **WHEN** a request arrives with a User-Agent containing `facebookexternalhit` or `line-poker`
- **THEN** the source is classified `BOT` and the bot strategy handles it

#### Scenario: LINE in-app browser is classified as LINE_WEBVIEW (not BOT)
- **WHEN** a request arrives with a User-Agent containing `Line/13.5.0` (the LINE in-app webview)
- **THEN** the source is classified `LINE_WEBVIEW` and NOT `BOT`, because BOT tokens are matched first and `Line/` is only matched after no bot token is found

#### Scenario: Ordinary browser defaults to EXTERNAL_BROWSER
- **WHEN** a request arrives with a desktop/mobile browser User-Agent matching no bot token and no in-app webview token
- **THEN** the source is classified `EXTERNAL_BROWSER`

### Requirement: Dev-only source override for testing
The `GET /s/:slug` handler SHALL accept a `?ua_simulator=` query parameter that overrides UA detection (`bot`, `line`/`line_webview`, `fb`/`fb_webview`, `external`/`external_browser`), enabling each branch to be exercised from a normal browser/curl. The override SHALL be honored only when not in production (`NODE_ENV !== 'production'`) or when explicitly opted in via `SHORTLINK_UA_SIMULATOR=1`. The handler SHALL also set an `X-Shortlink-Source` response header with the chosen source for inspection.

#### Scenario: Override forces the LINE branch in a browser
- **WHEN** a request hits `/s/:slug?ua_simulator=line_webview` in a non-production environment
- **THEN** the handler renders the LINE webview strategy (LIFF redirect when the link is bound) and sets `X-Shortlink-Source: LINE_WEBVIEW`

#### Scenario: Override is ignored in production
- **WHEN** a request hits `/s/:slug?ua_simulator=bot` with `NODE_ENV=production` and no opt-in flag
- **THEN** the override is ignored and the real User-Agent determines the source

### Requirement: Bot requests receive an OG preview without tracking
For a `BOT` source on an active link, the system SHALL return HTTP 200 with a static HTML document containing only Open Graph meta tags (`og:title`, `og:description`, `og:image`) sourced from the ShortLink's stored OG snapshot (falling back to `title` when a field is empty). The system SHALL NOT create a `ClickLog`, SHALL NOT increment counters, and SHALL NOT call the tracking endpoint. The response SHALL set `Cache-Control: no-store`.

#### Scenario: Bot previews an active link
- **WHEN** a crawler requests `/s/:slug` for an active link
- **THEN** the system returns 200 HTML with the link's `og:*` meta tags
- **AND** no `ClickLog` row is created and `totalClicks` / `uniqueClicks` are unchanged

#### Scenario: Bot requests an expired or inactive link
- **WHEN** a crawler requests `/s/:slug` for a link that is inactive or past `expiresAt`
- **THEN** the system returns 404 and renders no OG preview

### Requirement: External browser requests receive a zero-click redirect page
For an `EXTERNAL_BROWSER` source on an active link, the system SHALL return HTTP 200 with a micro HTML document that inlines the resolved target URL (with UTM params) and runs a script which calls `navigator.sendBeacon('/s/track', ...)` and then `window.location.replace(targetUrl)`. The `GET /s/:slug` response SHALL NOT record a click. The response SHALL set `Cache-Control: no-store`.

#### Scenario: Human in an external browser opens the link
- **WHEN** a browser requests `/s/:slug?cid=C1` for an active link
- **THEN** the system returns 200 micro HTML+JS and records nothing on the GET
- **AND** the script sends a beacon to `/s/track` with `{ slug, cid: 'C1' }` then replaces the location with the target URL

#### Scenario: External browser opens an expired link
- **WHEN** a browser requests `/s/:slug` for an inactive or expired link
- **THEN** the system returns a friendly "link expired" HTML page instead of redirecting

### Requirement: LINE webview routes through LIFF when a channel is bound
For a `LINE_WEBVIEW` source, the system SHALL look up `ShortLink.lineChannelId` and the bound LINE channel's `settings.liffConfig.liffId`. When a `liffId` exists, the `GET /s/:slug` response SHALL be HTML that replaces the location to `https://liff.line.me/{liffId}?s={slug}&cid={cid}&lid={liffId}`. When the link has no `lineChannelId` or the channel has no `liffId`, the system SHALL fall back to the external browser behavior. The LIFF flow SHALL use two pages: an entry page that performs `liff.init` and login/forwarding but records no click, and a callback page that is the only place a click is recorded.

#### Scenario: LINE webview on a link bound to a LIFF-configured channel
- **WHEN** a LINE in-app webview requests `/s/:slug?cid=C1` and the link's bound LINE channel has `liffId = "1660-abc"`
- **THEN** the system returns HTML that replaces to `https://liff.line.me/1660-abc?s=<slug>&cid=C1&lid=1660-abc`

#### Scenario: LINE webview on a link with no LIFF binding falls back
- **WHEN** a LINE in-app webview requests `/s/:slug` for a link whose `lineChannelId` is null (or the channel has no `liffId`)
- **THEN** the system serves the external-browser zero-click page (no LIFF, no `lineUid` collection)

#### Scenario: LIFF entry page never counts and forwards to callback
- **WHEN** the LIFF entry page loads and the user is already logged in to the LIFF
- **THEN** the entry page records no click and replaces the location to the callback page carrying `s`/`cid`/`lid`

#### Scenario: LIFF callback page counts exactly once with lineUid
- **WHEN** the LIFF callback page loads after login, obtains `lineUid` via `liff.getProfile()`
- **THEN** it calls `POST /s/track` with `{ slug, cid, lineUid }` exactly once, receives `{ targetUrl }`, and replaces the location with the target URL

### Requirement: Tracking endpoint records the single authoritative click
The system SHALL expose `POST /s/track` accepting `{ slug, cid?, lineUid? }` (parsing both `sendBeacon` `text/plain` and `fetch` JSON bodies). For an active link it SHALL create a `ClickLog` (including `lineUid` when present), increment `totalClicks` on every click, and increment `uniqueClicks` by default on every click EXCEPT when a `lineUid` is present that has already been recorded for this link (a `lineUid` dedups across network changes; IP/contactId are NOT used for uniqueness). A click without a `lineUid` always counts as a new unique. It SHALL apply `tagOnClick`, publish `link.clicked` on the eventBus, emit `link.stats.updated` via Socket.IO, and return the resolved target URL (with UTM) as `{ targetUrl }`. The endpoint SHALL allow CORS from the web origin without credentials. For an inactive or expired link it SHALL NOT record a click and SHALL NOT return a target URL.

#### Scenario: Beacon from an external browser records one click
- **WHEN** `POST /s/track` receives `{ slug, cid: 'C1' }` (no `lineUid`) for an active link
- **THEN** a `ClickLog` is created with `contactId = C1`, and BOTH `totalClicks` and `uniqueClicks` increment by 1 (no `lineUid` → always a new unique), and `link.clicked` / `link.stats.updated` are emitted

#### Scenario: LIFF callback records a click with lineUid and returns the target
- **WHEN** `POST /s/track` receives `{ slug, cid: 'C1', lineUid: 'U123' }` for an active link the first time
- **THEN** a `ClickLog` is created carrying `lineUid = U123`, `totalClicks` and `uniqueClicks` both increment by 1, and the response body is `{ targetUrl }` with UTM params applied

#### Scenario: Same lineUid clicks again (even from a different network/IP)
- **WHEN** `POST /s/track` receives a second `{ slug, lineUid: 'U123' }` for the same active link
- **THEN** `totalClicks` increments by 1 but `uniqueClicks` does NOT increment, regardless of a changed IP

#### Scenario: Tracking an expired link records nothing
- **WHEN** `POST /s/track` is called for an inactive or expired link
- **THEN** no `ClickLog` is created, counters are unchanged, and no target URL is returned

### Requirement: lineUid resolves to a contact via channel identity
When `POST /s/track` receives a `lineUid`, the system SHALL resolve the contact via `ChannelIdentity (channelId, uid)` where `channelId` comes from the link's `lineChannelId`. When a matching identity exists the `ClickLog.contactId` SHALL be set; when none exists the `ClickLog.contactId` SHALL be null while `lineUid` is still stored for later identity stitching.

#### Scenario: lineUid maps to an existing contact
- **WHEN** `lineUid = U123` matches a `ChannelIdentity` under the link's bound LINE channel
- **THEN** the `ClickLog.contactId` is set to that identity's contact

#### Scenario: lineUid has no existing identity
- **WHEN** `lineUid = U999` matches no `ChannelIdentity` in the tenant
- **THEN** the `ClickLog` is created with `contactId = null` and `lineUid = U999`, leaving the link to be stitched later by the identity engine

### Requirement: OG snapshot captured on create and update
The system SHALL store `ogTitle`, `ogDescription`, and `ogImage` on `ShortLink`. When a link is created or its `targetUrl` updated without explicit OG values, the system SHALL fetch the target URL in the background and store an OG snapshot; explicitly provided OG values SHALL take precedence. The fetcher SHALL restrict to `http`/`https`, apply a timeout and response-size limit, block private/loopback IPs (SSRF), resolve relative image URLs to absolute, and on failure leave the OG fields empty without blocking the create/update.

#### Scenario: Create without manual OG triggers a scrape
- **WHEN** a short link is created with a `targetUrl` and no OG fields
- **THEN** the system fetches the target URL and stores the scraped `og:title` / `og:description` / `og:image` snapshot

#### Scenario: Manual OG values are not overwritten
- **WHEN** a short link is created with an explicit `ogTitle`
- **THEN** the stored `ogTitle` is the provided value and is not replaced by the scraped one

#### Scenario: Scrape targets a private address
- **WHEN** the target URL resolves to a private or loopback IP
- **THEN** the fetcher refuses the request and the OG fields are left empty

### Requirement: Short links bind an optional LINE channel for LIFF
The system SHALL store an optional `ShortLink.lineChannelId` referencing a `channelType = LINE` channel; a null value means the link does not route through LIFF. The admin short-link form SHALL expose this as a LINE-channel selector. The bound LINE channel SHALL carry its `liffId` in `Channel.settings.liffConfig.liffId`. Many short links MAY share the same channel and therefore the same `liffId`.

#### Scenario: Admin binds a short link to a LINE channel
- **WHEN** an admin selects a LINE channel in the short-link form
- **THEN** the link's `lineChannelId` is set and LINE webview clicks route through that channel's `liffId`

#### Scenario: Admin leaves the LINE channel unselected
- **WHEN** an admin creates a short link without selecting a LINE channel
- **THEN** `lineChannelId` is null and LINE webview clicks fall back to external-browser behavior
