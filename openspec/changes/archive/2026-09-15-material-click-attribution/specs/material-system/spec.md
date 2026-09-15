## ADDED Requirements

### Requirement: Material-Level Click Attribution

The system SHALL attribute short-link clicks back to the material that produced them, via a `materialId` reference on short links. `getMaterialStats` SHALL report click count and click-through rate for a material, derived from `ClickLog` records whose short link carries that material's id. When a material has no attributable click data (no material-tagged short links, or zero sends), the click-through rate SHALL be `null` (displayed as "暫無資料"), never a fabricated `0`.

#### Scenario: Clicks attributed to a material

- **WHEN** a broadcast built from material M sends a message whose URL was converted to a material-tagged short link, and a recipient clicks it
- **THEN** material M's stats reflect the click count

#### Scenario: Click-through rate computed from sends

- **WHEN** material M has 100 sends and 24 attributed clicks
- **THEN** its click-through rate is reported as 24%

#### Scenario: No attributable clicks returns null

- **WHEN** material M has no material-tagged short links or zero sends
- **THEN** click-through rate is `null`, shown as "暫無資料", not 0

### Requirement: Send-Time URL-to-Short-Link Conversion

When a broadcast sends a material, the system SHALL convert external action URLs in the material body into short links carrying the material's id, so clicks are attributable. Conversion SHALL be at the material level (one short link per material+URL, shared across recipients), SHALL reuse an existing short link for the same material+target URL rather than creating a new one each broadcast, and SHALL skip URLs that are already this system's short links (no double-wrapping). Materials without external URLs SHALL be unaffected.

#### Scenario: URL converted to material short link on broadcast

- **WHEN** a broadcast sends a material whose button action points to an external URL
- **THEN** the sent message's URL is a short link tagged with the material's id

#### Scenario: Existing short link reused

- **WHEN** the same material+target URL already has a short link
- **THEN** the broadcast reuses it rather than creating a duplicate

#### Scenario: Already-short URL not double-wrapped

- **WHEN** a material URL is already this system's short link
- **THEN** it is sent as-is, not wrapped again
