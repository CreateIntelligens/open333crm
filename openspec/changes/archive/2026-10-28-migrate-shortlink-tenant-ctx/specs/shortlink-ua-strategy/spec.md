## MODIFIED Requirements

### Requirement: Tracking endpoint records the single authoritative click
The system SHALL expose `POST /s/track` accepting `{ slug, cid?, lineUid? }` (parsing both `sendBeacon` `text/plain` and `fetch` JSON bodies) and SHALL allow CORS from the web origin without credentials. For an active link it SHALL apply `tagOnClick`, publish `link.clicked`, emit `link.stats.updated` via Socket.IO, and return the resolved target URL (with UTM) as `{ targetUrl }`. For an inactive or expired link it SHALL NOT record a click and SHALL NOT return a target URL.

#### Scenario: Tracking an expired link records nothing
- **WHEN** `POST /s/track` is called for an inactive or expired link
- **THEN** no `ClickLog` is created, counters are unchanged, and no target URL is returned

### Requirement: OG snapshot captured on create and update
The system SHALL store `ogTitle`, `ogDescription`, and `ogImage` on `ShortLink`. When a link is created or its `targetUrl` updated without explicit OG values, the system SHALL fetch the target URL in the background after the transaction that writes the link commits, and store the OG snapshot in a new transaction, at most once; explicitly provided OG values SHALL take precedence. This SHALL also apply to material short links that broadcasts create.

#### Scenario: Create without manual OG triggers a scrape
- **WHEN** a short link is created with a `targetUrl` and no OG fields
- **THEN** the system fetches the target URL and stores the scraped `og:title` / `og:description` / `og:image` snapshot

#### Scenario: Manual OG values are not overwritten
- **WHEN** a short link is created with an explicit `ogTitle`
- **THEN** the stored `ogTitle` is the provided value and is not replaced by the scraped one

#### Scenario: Material short link created inside a transaction gets its snapshot
- **WHEN** a coupon broadcast converts a material's external link into a new short link inside a tenant transaction
- **THEN** after the transaction commits, the system fetches the target URL and stores the OG snapshot on that short link

## ADDED Requirements

### Requirement: Click recording commits as one transaction
The system SHALL record a click in one transaction bound to the link's tenant: the `ClickLog`, the counters, the `tagOnClick` tag, and the outbox rows for `link.clicked` and `contact.tagged` (`event-delivery`). It SHALL emit `link.stats.updated` only after the commit. A failed `tagOnClick` SHALL NOT drop the click.

#### Scenario: Click events commit with the click
- **WHEN** `POST /s/track` records a click for contact C1 on an active link whose `tagOnClick` is T1
- **THEN** the outbox has `link.clicked` for the link and `contact.tagged` for C1 and T1, in the same transaction as the `ClickLog`, and `link.stats.updated` is emitted only after the commit

#### Scenario: A failed click tag does not drop the click
- **WHEN** `POST /s/track` records a click and applying `tagOnClick` fails
- **THEN** the `ClickLog` is created and `totalClicks` increments, and no tag is applied
